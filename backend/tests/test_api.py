from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
from contextlib import asynccontextmanager
from collections.abc import Iterator
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import ValidationError
from sqlalchemy.exc import OperationalError

from app.core.admin_types import AdminContext
from app.core.config import Settings, database_url_for_asyncpg, get_settings
from app.core.database import get_db_session
from app.core.exceptions import ServiceUnavailableError
from app.core.responses import JSONResponse
from app.core.security import hash_password, verify_password
from app.cli import _legacy_image_path
from app.main import app, fastapi_app, lifespan
from app.services.image_service import (
    _process_image,
    add_external_image,
    add_uploaded_image,
    validate_collection_category,
)


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    async def no_database() -> Iterator[object]:
        yield object()

    @asynccontextmanager
    async def no_startup_database(_app):
        yield

    monkeypatch.setattr(fastapi_app.router, "lifespan_context", no_startup_database)
    fastapi_app.dependency_overrides[get_db_session] = no_database
    with TestClient(app, base_url="https://testserver") as test_client:
        yield test_client
    fastapi_app.dependency_overrides.clear()


def _image_bytes(image_format: str = "PNG") -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (4, 3), color=(18, 40, 90)).save(output, format=image_format)
    return output.getvalue()


def test_health_endpoint(client: TestClient) -> None:
    response = client.get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_api_health_endpoint(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_startup_continues_when_database_is_unreachable(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    import logging

    import app.main as main_module

    class UnreachableEngine:
        def connect(self) -> UnreachableEngine:
            return self

        async def __aenter__(self) -> UnreachableEngine:
            raise OperationalError("SELECT 1", {}, OSError("network unreachable"))

        async def __aexit__(self, *_args: object) -> None:
            return None

    async def noop() -> None:
        return None

    monkeypatch.setattr(main_module, "get_engine", lambda: UnreachableEngine())
    monkeypatch.setattr(main_module, "close_database", noop)
    monkeypatch.setattr(main_module.login_rate_limiter, "close", noop)

    async def start_application() -> None:
        async with lifespan(main_module.app):
            pass

    with caplog.at_level(logging.ERROR, logger="pns.backend"):
        asyncio.run(start_application())

    assert "API will start in degraded mode" in caplog.text


def test_database_dependency_returns_503_when_connection_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.core.database as database_module

    class UnreachableSessionFactory:
        async def __aenter__(self) -> object:
            raise OperationalError("SELECT 1", {}, OSError("network unreachable"))

        async def __aexit__(self, *_args: object) -> None:
            return None

    monkeypatch.setattr(
        database_module, "get_session_factory", lambda: UnreachableSessionFactory
    )

    async def get_session() -> None:
        await anext(database_module.get_db_session())

    with pytest.raises(ServiceUnavailableError, match="database is unavailable"):
        asyncio.run(get_session())


def test_cors_preflight_allows_configured_frontend_origin(client: TestClient) -> None:
    response = client.options(
        "/api/v1/admin/auth/login",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert response.headers["access-control-allow-credentials"] == "true"
    assert "authorization" in response.headers["access-control-allow-headers"].lower()


def test_cors_rejects_unconfigured_origin_and_allows_credentials_on_errors(
    client: TestClient,
) -> None:
    rejected = client.options(
        "/api/v1/admin/auth/login",
        headers={
            "Origin": "https://unconfigured.example",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert rejected.status_code == 400
    assert "access-control-allow-origin" not in rejected.headers

    error = client.get(
        "/api/v1/admin/users",
        headers={"Origin": "http://localhost:3000"},
    )
    assert error.status_code == 401
    assert error.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert error.headers["access-control-allow-credentials"] == "true"


def test_trusted_host_rejects_unconfigured_hostname(client: TestClient) -> None:
    response = client.get("/api/health", headers={"Host": "unconfigured.example"})
    assert response.status_code == 400


def test_cors_origins_parse_csv_and_reject_wildcard() -> None:
    settings = Settings(
        _env_file=None,
        cors_origins="https://pns.example, https://admin.pns.example",
    )
    assert settings.cors_origins == [
        "https://pns.example",
        "https://admin.pns.example",
    ]
    normalized = Settings(
        _env_file=None,
        frontend_url="https://pns.example/",
        cors_origins="https://pns.example/, http://localhost:3000/",
        allowed_hosts=" PNS.EXAMPLE., localhost ",
    )
    assert normalized.frontend_url == "https://pns.example"
    assert normalized.cors_origins == [
        "https://pns.example",
        "http://localhost:3000",
    ]
    assert normalized.allowed_hosts == ["pns.example", "localhost"]
    with pytest.raises(ValidationError, match="cannot include"):
        Settings(_env_file=None, cors_origins="*")
    with pytest.raises(ValidationError, match="exact hostnames"):
        Settings(_env_file=None, allowed_hosts="*.example.com")
    with pytest.raises(ValidationError, match="Origins"):
        Settings(_env_file=None, cors_origins="https://pns.example/path")
    with pytest.raises(ValidationError, match="hostnames only"):
        Settings(_env_file=None, allowed_hosts="https://pns.example")
    with pytest.raises(ValidationError, match="unspecified bind addresses"):
        Settings(_env_file=None, allowed_hosts="0.0.0.0")


def test_login_cookie_is_used_for_session_verification(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api.v1 import admin as admin_api
    from app.repositories import admin_repository

    async def not_limited(_client_key: str) -> bool:
        return False

    async def noop(_client_key: str) -> None:
        return None

    async def authenticate(*_args: object) -> tuple[str, dict[str, str]]:
        return "session-token", {
            "id": "admin-id",
            "email": "admin@example.com",
            "displayName": "Admin",
            "roleName": "Super Admin",
        }

    session_tokens: list[str | None] = []

    async def get_context(_db: object, token: str | None, *_args: object) -> AdminContext:
        session_tokens.append(token)
        return AdminContext(
            user={"id": "admin-id", "email": "admin@example.com"},
            permissions=frozenset({"users.read"}),
            request_id="test-request",
        )

    monkeypatch.setattr(admin_api.login_rate_limiter, "is_limited", not_limited)
    monkeypatch.setattr(admin_api.login_rate_limiter, "clear", noop)
    monkeypatch.setattr(admin_api, "authenticate_admin", authenticate)
    monkeypatch.setattr(admin_repository, "get_admin_context", get_context)

    login_response = client.post(
        "/api/v1/admin/auth/login",
        json={"email": "admin@example.com", "password": "valid-password"},
    )
    assert login_response.status_code == 200
    set_cookie = login_response.headers["set-cookie"]
    assert "pns_admin_session=" in set_cookie
    assert "HttpOnly" in set_cookie
    assert f"SameSite={get_settings().cookie_samesite}" in set_cookie
    if get_settings().secure_cookies:
        assert "Secure" in set_cookie

    session_response = client.get("/api/v1/admin/auth/me")
    assert session_response.status_code == 200
    assert session_response.json()["authenticated"] is True
    assert session_response.json()["permissions"] == ["users.read"]
    assert session_tokens == ["session-token"]


def test_production_cookie_configuration_requires_secure_for_cross_site(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api.v1 import admin as admin_api
    from fastapi import Response

    settings = Settings(
        _env_file=None,
        app_env="production",
        secure_cookies=True,
        cookie_samesite="none",
        cookie_domain=".pns.example",
    )
    monkeypatch.setattr(admin_api, "get_settings", lambda: settings)
    response = Response()
    admin_api._set_session_cookie(response, "session-token", remember=False)
    set_cookie = response.headers["set-cookie"]
    assert "Secure" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "SameSite=none" in set_cookie
    assert "Domain=.pns.example" in set_cookie

    with pytest.raises(ValidationError, match="requires PNS_SECURE_COOKIES=true"):
        Settings(_env_file=None, cookie_samesite="none")


def test_all_existing_api_contracts_are_registered() -> None:
    route_methods = {
        (path, method.upper())
        for path, path_item in fastapi_app.openapi()["paths"].items()
        for method in path_item
        if method in {"get", "post", "put", "patch", "delete"}
    }
    expected = {
        ("/api/v1/admin/auth/login", "POST"),
        ("/api/v1/admin/auth/logout", "POST"),
        ("/api/v1/admin/auth/me", "GET"),
        ("/api/v1/admin/users", "GET"),
        ("/api/v1/admin/users", "POST"),
        ("/api/v1/admin/users/{user_id}", "GET"),
        ("/api/v1/admin/users/{user_id}", "PATCH"),
        ("/api/v1/admin/super-admins", "POST"),
        ("/api/v1/admin/groups", "GET"),
        ("/api/v1/admin/groups", "POST"),
        ("/api/v1/admin/groups/{group_id}", "PATCH"),
        ("/api/v1/admin/groups/{group_id}", "DELETE"),
        ("/api/v1/admin/groups/{group_id}/members", "PUT"),
        ("/api/v1/admin/groups/{group_id}/permissions", "PUT"),
        ("/api/v1/admin/audit", "GET"),
        ("/api/v1/admin/room-images", "GET"),
        ("/api/v1/admin/room-images", "POST"),
        ("/api/v1/admin/room-images/{image_id}", "DELETE"),
        ("/api/v1/admin/dining-images", "GET"),
        ("/api/v1/admin/dining-images", "POST"),
        ("/api/v1/admin/dining-images/{image_id}", "DELETE"),
        ("/api/v1/admin/images/{image_id}", "PATCH"),
        ("/api/v1/images/{collection}", "GET"),
    }
    assert expected <= route_methods


@pytest.mark.parametrize(
    "path,method",
    [
        ("/api/v1/admin/users", "get"),
        ("/api/v1/admin/groups", "get"),
        ("/api/v1/admin/room-images?type=vajra", "get"),
        ("/api/v1/admin/dining-images?type=clinq", "get"),
    ],
)
def test_admin_routes_reject_missing_session_and_test_tokens(
    client: TestClient, path: str, method: str
) -> None:
    response = getattr(client, method)(
        path, headers={"Authorization": "Bearer test-token"}
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_password_hash_supports_bcrypt_and_legacy_scrypt() -> None:
    password = "Pns-T3st-Password"
    assert verify_password(password, hash_password(password))
    salt = b"legacy-pns-salt"
    derived = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=64)
    stored = "scrypt$16384$8$1${}${}".format(
        base64.urlsafe_b64encode(salt).decode().rstrip("="),
        base64.urlsafe_b64encode(derived).decode().rstrip("="),
    )
    assert verify_password(password, stored)
    assert not verify_password("wrong", stored)
    assert not verify_password(password, "unsupported$format")


def test_postgres_url_is_normalized_for_asyncpg_pooling() -> None:
    assert database_url_for_asyncpg(
        "postgresql://user:password@db.example:5432/postgres?sslmode=require&pgbouncer=true"
    ) == "postgresql+asyncpg://user:password@db.example:5432/postgres?ssl=require"


def test_json_responses_encode_postgres_uuid_and_timestamp_values() -> None:
    identifier = uuid4()
    created_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    response = JSONResponse({"id": identifier, "createdAt": created_at})
    payload = json.loads(response.body)
    assert payload == {
        "id": str(identifier),
        "createdAt": "2026-01-01T00:00:00+00:00",
    }


def test_image_validation_detects_content_and_converts_to_webp() -> None:
    output, stored_name, converted = _process_image(_image_bytes("PNG"), "front view.png")
    with Image.open(io.BytesIO(output)) as image:
        assert image.format == "WEBP"
        assert image.size == (4, 3)
    assert stored_name.endswith("-front-view.webp")
    assert converted is True


def test_image_validation_keeps_webp_content() -> None:
    source = _image_bytes("WEBP")
    output, stored_name, converted = _process_image(source, "room.webp")
    assert output == source
    assert stored_name.endswith("-room.webp")
    assert converted is False


def test_image_validation_rejects_non_image_and_oversized_input() -> None:
    with pytest.raises(Exception) as invalid:
        _process_image(b"not an image", "bad.png")
    assert getattr(invalid.value, "code", None) == "invalid_image"

    with pytest.raises(Exception) as oversized:
        _process_image(b"x" * (8 * 1024 * 1024 + 1), "large.png")
    assert getattr(oversized.value, "code", None) == "file_too_large"


def test_image_categories_are_limited_to_existing_frontend_categories() -> None:
    validate_collection_category("room", "vajra")
    validate_collection_category("dining", "clinq")
    with pytest.raises(Exception) as invalid:
        validate_collection_category("room", "banquet")
    assert getattr(invalid.value, "code", None) == "invalid_category"


def test_external_image_creation_returns_database_record(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def save_image(*args: object, **kwargs: object) -> dict[str, object]:
        return {"id": "image-id", "url": str(kwargs["url"])}

    async def create_image() -> dict[str, object]:
        return await add_external_image(
            object(), "room", "vajra", "https://images.example/room.webp", "admin-id"
        )

    monkeypatch.setattr("app.services.image_service.save_managed_image", save_image)
    image = asyncio.run(create_image())
    assert image == {"id": "image-id", "url": "https://images.example/room.webp"}


def test_uploaded_image_bytes_are_saved_in_database(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    settings = Settings(_env_file=None, image_storage_dir=str(tmp_path))
    monkeypatch.setattr("app.services.image_service.get_settings", lambda: settings)
    saved: dict[str, object] = {}

    async def save_image(*_args: object, **kwargs: object) -> dict[str, object]:
        saved.update(kwargs)
        return {
            "id": "image-id",
            "url": "/api/v1/images/content/image-id",
            "filename": str(kwargs["storage_path"]).rsplit("/", 1)[-1],
        }

    monkeypatch.setattr("app.services.image_service.save_managed_image", save_image)
    image = asyncio.run(
        add_uploaded_image(
            object(), "room", "vajra", "room.png", _image_bytes(), "admin-id"
        )
    )

    assert saved["source_type"] == "upload"
    assert saved["content_type"] == "image/webp"
    assert saved["image_data"]
    assert image["url"] == "/api/v1/images/content/image-id"
    assert not list(tmp_path.iterdir())


def test_legacy_image_migration_resolves_only_paths_inside_upload_root(tmp_path) -> None:
    path = _legacy_image_path(tmp_path, "uploads/room/vajra/image.webp")
    assert path == tmp_path.resolve() / "room/vajra/image.webp"
    with pytest.raises(RuntimeError, match="Unsafe legacy image path"):
        _legacy_image_path(tmp_path, "uploads/../../outside.webp")


def test_image_content_endpoint_serves_database_bytes(client: TestClient) -> None:
    image_data = b"database image bytes"

    class Result:
        def mappings(self):
            return self

        def first(self):
            return {"image_data": memoryview(image_data), "content_type": "image/webp"}

    class Session:
        async def execute(self, *_args: object, **_kwargs: object) -> Result:
            return Result()

    async def database_session() -> Iterator[object]:
        yield Session()

    fastapi_app.dependency_overrides[get_db_session] = database_session
    response = client.get("/api/v1/images/content/1b671a64-40d5-491e-99b0-da01ff1f3341")
    assert response.status_code == 200
    assert response.content == image_data
    assert response.headers["content-type"] == "image/webp"
    assert response.headers["x-content-type-options"] == "nosniff"
