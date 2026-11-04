from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
from collections.abc import Iterator
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import ValidationError

from app.core.admin_types import AdminContext
from app.core.config import Settings, database_url_for_asyncpg
from app.core.database import get_db_session
from app.core.responses import JSONResponse
from app.core.security import hash_password, verify_password
from app.main import app
from app.services.image_service import (
    ImageStorage,
    _process_image,
    add_external_image,
    validate_collection_category,
)


@pytest.fixture
def client() -> Iterator[TestClient]:
    async def no_database() -> Iterator[object]:
        yield object()

    app.dependency_overrides[get_db_session] = no_database
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def _image_bytes(image_format: str = "PNG") -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (4, 3), color=(18, 40, 90)).save(output, format=image_format)
    return output.getvalue()


def test_health_endpoint(client: TestClient) -> None:
    response = client.get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_cors_preflight_allows_configured_frontend_origin(client: TestClient) -> None:
    response = client.options(
        "/api/v1/admin/auth/login",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert response.headers["access-control-allow-credentials"] == "true"


def test_cors_origins_parse_csv_and_reject_wildcard() -> None:
    settings = Settings(
        _env_file=None,
        cors_origins="https://pns.example, https://admin.pns.example",
    )
    assert settings.cors_origins == [
        "https://pns.example",
        "https://admin.pns.example",
    ]
    with pytest.raises(ValidationError, match="cannot include"):
        Settings(_env_file=None, cors_origins="*")


def test_supabase_project_settings_accept_api_keys_and_jwks_url() -> None:
    settings = Settings(
        _env_file=None,
        supabase_url="https://project.example",
        supabase_publishable_key="publishable-test-key",
        supabase_secret_key="secret-test-key",
        supabase_jwks_url="https://project.example/auth/v1/.well-known/jwks.json",
    )
    assert settings.supabase_url == "https://project.example"
    assert settings.supabase_publishable_key == "publishable-test-key"
    assert settings.supabase_service_key == "secret-test-key"
    assert settings.supabase_jwks_url == "https://project.example/auth/v1/.well-known/jwks.json"


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

    async def get_context(*_args: object) -> AdminContext:
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
    assert "SameSite=lax" in set_cookie

    session_response = client.get("/api/v1/admin/auth/me")
    assert session_response.status_code == 200
    assert session_response.json()["authenticated"] is True
    assert session_response.json()["permissions"] == ["users.read"]


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
        for path, path_item in app.openapi()["paths"].items()
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


def test_supabase_storage_uses_private_service_role_header(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(
        database_url=None,
        redis_url=None,
        supabase_url="https://project.example",
        supabase_service_key="private-test-key",
        storage_bucket="hotel-images",
        image_storage_dir="/tmp/images",
        image_storage_backend="supabase",
        session_cookie_name="pns_admin_session",
        secure_cookies=True,
        api_docs_enabled=False,
        cors_origins=(),
        allowed_hosts=("testserver",),
        max_upload_bytes=8 * 1024 * 1024,
        max_image_pixels=64_000_000,
    )
    monkeypatch.setattr("app.services.image_service.get_settings", lambda: settings)
    headers = ImageStorage()._headers()
    assert headers["Authorization"] == "Bearer private-test-key"
    assert headers["apikey"] == "private-test-key"
