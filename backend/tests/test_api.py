from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import socket
from contextlib import asynccontextmanager
from collections.abc import Iterator
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi import Request
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import ValidationError
from sqlalchemy.exc import OperationalError

from app.core.admin_types import AdminContext
from app.core.config import Settings, database_url_for_asyncpg, get_settings
from app.core.database import get_db_session
from app.core.exceptions import ImageManagementError, ServiceUnavailableError
from app.core.responses import JSONResponse
from app.core.security import hash_password, verify_password
from app.cli import _legacy_image_path
from app.main import app, fastapi_app, lifespan
from app.repositories import image_repository
from app.services import image_service, image_storage
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
    assert response.json()["status"] == "ok"
    assert response.json()["application"] == "PNS Hotel API"
    assert response.json()["api"] == "available"
    assert "timestamp" in response.json()


def test_diagnostics_dashboard_is_served_by_fastapi(client: TestClient) -> None:
    response = client.get("/test")
    assert response.status_code == 200
    assert "PNS System Diagnostics" in response.text
    assert "Copy diagnostic report" in response.text


def test_readiness_endpoint_reports_database_unavailable_without_details(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.main as main_module

    monkeypatch.setattr(main_module, "get_engine", lambda: None)
    monkeypatch.setattr(
        main_module,
        "settings",
        Settings(_env_file=None, diagnostics_timeout_seconds=3),
    )

    async def no_redis() -> None:
        return None

    monkeypatch.setattr(main_module.login_rate_limiter, "health_check", no_redis)
    response = client.get("/api/health/ready")
    assert response.status_code == 503
    assert response.json() == {
        "status": "not_ready",
        "database": "not_configured",
        "redis": "not_configured",
    }


def test_diagnostics_routes_require_access_token(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.api.diagnostics as diagnostics

    monkeypatch.setattr(
        diagnostics,
        "get_settings",
        lambda: Settings(
            _env_file=None,
            diagnostics_token="diagnostics-test-token-123456789012345",
        ),
    )
    response = client.post("/api/v1/diagnostics/run")
    assert response.status_code == 403
    assert "not authorized" in response.json()["detail"]


def test_individual_diagnostic_runs_only_the_requested_backend_check(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.api.diagnostics as diagnostics

    monkeypatch.setattr(
        diagnostics,
        "get_settings",
        lambda: Settings(
            _env_file=None,
            diagnostics_token="diagnostics-test-token-123456789012345",
        ),
    )
    headers = {
        "X-PNS-Diagnostics-Token": "diagnostics-test-token-123456789012345"
    }
    response = client.post(
        "/api/v1/diagnostics/run?test_name=API%20routing", headers=headers
    )
    assert response.status_code == 200
    assert [item["name"] for item in response.json()["results"]] == ["API routing"]
    assert response.json()["results"][0]["status"] == "PASS"


def test_diagnostics_results_are_correlated_and_reject_arbitrary_targets(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.api.diagnostics as diagnostics

    settings = Settings(
        _env_file=None,
        diagnostics_token="diagnostics-test-token-123456789012345",
        backend_public_url="https://backend.example",
        frontend_url="https://frontend.example",
        cors_origins="https://frontend.example",
        allowed_hosts="backend.example",
    )
    monkeypatch.setattr(diagnostics, "get_settings", lambda: settings)

    async def backend_checks(
        _application: object, _test_name: str | None = None
    ) -> tuple[list[dict[str, object]], int]:
        return [
            {
                "name": "FastAPI application",
                "status": "PASS",
                "target": None,
                "duration_ms": 1,
                "http_status": None,
                "error_category": None,
                "message": "Application is running.",
                "suggested_action": None,
                "details": {},
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        ], 2

    monkeypatch.setattr(diagnostics, "run_backend_checks", backend_checks)
    diagnostics._browser_results.clear()
    headers = {
        "X-PNS-Diagnostics-Token": "diagnostics-test-token-123456789012345"
    }
    started = client.post("/api/v1/diagnostics/run", headers=headers)
    assert started.status_code == 200
    correlation_id = started.json()["correlation_id"]

    report = {
        "correlation_id": correlation_id,
        "test_type": "browser_to_backend",
        "target_url": "https://backend.example/api/health",
        "status": "PASS",
        "http_status": 200,
        "duration_ms": 12,
        "error_message": "Browser request succeeded.",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    recorded = client.post(
        "/api/v1/diagnostics/browser-result", headers=headers, json=report
    )
    assert recorded.status_code == 200
    credentialed_report = {
        **report,
        "test_type": "browser_credentialed_request",
        "credentials_included": True,
    }
    assert client.post(
        "/api/v1/diagnostics/browser-result",
        headers=headers,
        json=credentialed_report,
    ).status_code == 200
    results = client.get(
        "/api/v1/diagnostics/results",
        headers=headers,
        params={"correlation_id": correlation_id},
    )
    assert results.status_code == 200
    assert results.json()["correlation_id"] == correlation_id
    assert {item["name"] for item in results.json()["results"]} == {
        "FastAPI application",
        "Serverless execution",
        "Browser To Backend",
        "Browser Credentialed Request",
    }

    report["target_url"] = "https://attacker.example/"
    rejected = client.post(
        "/api/v1/diagnostics/browser-result", headers=headers, json=report
    )
    assert rejected.status_code == 400


def test_frontend_timeout_is_classified_without_exposing_exception(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import httpx

    from app.api import diagnostics

    class TimeoutClient:
        def __init__(self, **_kwargs: object) -> None:
            pass

        def stream(self, _method: str, _url: str) -> TimeoutClient:
            return self

        async def __aenter__(self) -> TimeoutClient:
            raise httpx.ConnectTimeout("private connection details")

        async def __aexit__(self, *_args: object) -> None:
            return None

    monkeypatch.setattr(diagnostics.httpx, "AsyncClient", TimeoutClient)

    async def check_frontend() -> dict[str, object]:
        return await diagnostics._check_frontend("https://frontend.example", 1)

    result = asyncio.run(check_frontend())
    assert result["status"] == "FAIL"
    assert result["error_category"] == "CONNECTION_TIMEOUT"
    assert "private connection details" not in str(result)


def test_frontend_redirect_is_reported_without_query_parameters(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from types import SimpleNamespace

    from app.api import diagnostics

    class ResponseContext:
        async def __aenter__(self) -> SimpleNamespace:
            return SimpleNamespace(
                status_code=302,
                headers={"location": "https://login.example/path?token=secret"},
            )

        async def __aexit__(self, *_args: object) -> None:
            return None

    class RedirectClient:
        def __init__(self, **_kwargs: object) -> None:
            pass

        async def __aenter__(self) -> RedirectClient:
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        def stream(self, _method: str, _url: str) -> ResponseContext:
            return ResponseContext()

    monkeypatch.setattr(diagnostics.httpx, "AsyncClient", RedirectClient)

    async def check_frontend() -> dict[str, object]:
        return await diagnostics._check_frontend("https://frontend.example", 1)

    result = asyncio.run(check_frontend())
    assert result["status"] == "WARNING"
    assert result["http_status"] == 302
    assert result["details"]["redirect_destination"] == "https://login.example"


def test_backend_checks_reuse_database_resources_and_skip_optional_redis(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from types import SimpleNamespace

    from app.api import diagnostics

    settings = Settings(
        _env_file=None,
        diagnostics_token="diagnostics-test-token-123456789012345",
        frontend_url="https://frontend.example",
        backend_public_url="https://backend.example",
        database_url="postgresql://user:password@database.example/db",
        cors_origins="https://frontend.example",
        allowed_hosts="backend.example",
    )
    monkeypatch.setattr(diagnostics, "get_settings", lambda: settings)

    class Connection:
        async def __aenter__(self) -> Connection:
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        async def execute(self, _query: object) -> None:
            return None

    class Engine:
        pool = SimpleNamespace(status=lambda: "pool healthy")

        def connect(self) -> Connection:
            return Connection()

    class Session:
        async def __aenter__(self) -> Session:
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        async def execute(self, _query: object) -> None:
            return None

    class SessionFactory:
        def __call__(self) -> Session:
            return Session()

    async def frontend(_url: str, _timeout: float) -> dict[str, object]:
        return diagnostics._result(
            "Backend to frontend", diagnostics.Status.PASS, http_status=200
        )

    monkeypatch.setattr(diagnostics, "get_engine", Engine)
    monkeypatch.setattr(diagnostics, "get_session_factory", SessionFactory)
    monkeypatch.setattr(diagnostics, "_check_frontend", frontend)

    results, _duration = asyncio.run(diagnostics.run_backend_checks(object()))
    by_name = {result["name"]: result for result in results}
    assert by_name["Deployment configuration"]["status"] == "PASS"
    assert by_name["Backend to frontend"]["status"] == "PASS"
    assert by_name["PostgreSQL connection and SELECT 1"]["status"] == "PASS"
    assert by_name["Database session availability"]["status"] == "PASS"
    assert by_name["Redis"]["status"] == "SKIPPED"
    assert by_name["Rate limiter"]["status"] == "WARNING"
    assert by_name["Image repository and storage"]["status"] == "SKIPPED"
    assert "password" not in str(results)


def test_configured_redis_failure_is_reported_safely(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from redis.exceptions import RedisError

    from app.api import diagnostics

    settings = Settings(
        _env_file=None,
        redis_url="redis://user:password@redis.example/0",
    )
    monkeypatch.setattr(diagnostics, "get_settings", lambda: settings)

    async def redis_unavailable() -> bool:
        raise RedisError("redis password and endpoint details")

    monkeypatch.setattr(diagnostics.login_rate_limiter, "health_check", redis_unavailable)

    results, _duration = asyncio.run(
        diagnostics.run_backend_checks(object(), "Redis")
    )
    assert results[0]["status"] == "FAIL"
    assert results[0]["error_category"] == "REDIS_ERROR"
    assert "password" not in str(results)


def test_diagnostics_settings_validate_public_urls_and_timeout() -> None:
    settings = Settings(
        _env_file=None,
        frontend_url="https://frontend.example/",
        backend_public_url="https://backend.example/",
        diagnostics_timeout_seconds=4,
    )
    assert settings.frontend_url == "https://frontend.example"
    assert settings.backend_public_url == "https://backend.example"
    with pytest.raises(ValidationError):
        Settings(_env_file=None, diagnostics_timeout_seconds=30)
    with pytest.raises(ValidationError):
        Settings(_env_file=None, diagnostics_token="short")


def test_database_url_for_asyncpg_supports_direct_supabase_settings() -> None:
    url = (
        "postgresql://postgres.abc:super-secret-pass@db.abc.supabase.co:5432/postgres"
        "?sslmode=require&pgbouncer=true&application_name=pns"
    )
    normalized = database_url_for_asyncpg(url)
    assert normalized.startswith("postgresql+asyncpg://postgres.abc:super-secret-pass@db.abc.supabase.co:5432/postgres")
    assert "ssl=require" in normalized
    assert "pgbouncer=" not in normalized
    assert "application_name=pns" in normalized
    assert "super-secret-pass" in normalized


def test_database_network_probe_sanitizes_dns_failures() -> None:
    from app.api import diagnostics

    probe = diagnostics._database_network_probe(
        "postgresql://postgres.abc:super-secret-pass@db.abc.supabase.co:5432/postgres?sslmode=require"
    )
    assert probe["status"] in {"dns_failed", "resolved", "invalid_url", "missing_host"}
    assert "super-secret-pass" not in str(probe)
    assert diagnostics._classify_database_error(socket.gaierror(11001, "getaddrinfo failed"))[0] == "DNS_ERROR"


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
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/test-database",
            "headers": [],
            "query_string": b"",
            "scheme": "https",
            "server": ("testserver", 443),
        }
    )

    async def get_session() -> None:
        await anext(database_module.get_db_session(request))

    with pytest.raises(ServiceUnavailableError, match="temporarily unavailable"):
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

    diagnostics_preflight = client.options(
        "/api/health",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "x-pns-diagnostic-probe",
        },
    )
    assert diagnostics_preflight.status_code == 200
    assert "x-pns-diagnostic-probe" in diagnostics_preflight.headers[
        "access-control-allow-headers"
    ].lower()


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


def test_frontend_and_cors_origins_normalize_protocolless_hosts() -> None:
    settings = Settings(
        _env_file=None,
        frontend_url="deza-pns.vercel.app/",
        cors_origins="deza-pns.vercel.app,localhost:3000",
    )
    assert settings.frontend_url == "https://deza-pns.vercel.app"
    assert settings.cors_origins == [
        "https://deza-pns.vercel.app",
        "http://localhost:3000",
    ]


def test_explicit_origin_schemes_and_trailing_slashes_are_preserved_and_normalized() -> None:
    settings = Settings(
        _env_file=None,
        frontend_url="https://deza-pns.vercel.app///",
        cors_origins="http://localhost:3000/,https://admin.example/",
    )
    assert settings.frontend_url == "https://deza-pns.vercel.app"
    assert settings.cors_origins == [
        "http://localhost:3000",
        "https://admin.example",
    ]
    localhost_settings = Settings(
        _env_file=None,
        frontend_url="http://localhost:3000/",
        cors_origins="http://localhost:3000/",
    )
    assert localhost_settings.frontend_url == "http://localhost:3000"
    assert localhost_settings.cors_origins == ["http://localhost:3000"]


@pytest.mark.parametrize(
    "frontend_url,cors_origins",
    [
        ("https://frontend.example/path", None),
        ("https://frontend.example?debug=true", None),
        ("https://frontend.example#section", None),
        (None, "https://frontend.example/path"),
        (None, "https://frontend.example?debug=true"),
        (None, "https://frontend.example#section"),
        ("ftp://frontend.example", None),
        (None, "ftp://frontend.example"),
    ],
)
def test_frontend_and_cors_origins_reject_non_origins(
    frontend_url: str | None,
    cors_origins: str | None,
) -> None:
    values: dict[str, object] = {}
    if frontend_url is not None:
        values["frontend_url"] = frontend_url
    if cors_origins is not None:
        values["cors_origins"] = cors_origins
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **values)


def test_cors_middleware_uses_normalized_settings() -> None:
    from app.main import app

    assert app.allow_origins == get_settings().cors_origins


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

    def unexpected_celery_publish(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("Admin login must not publish a Celery task.")

    from app.api.v1 import admin_jobs as admin_jobs_api

    monkeypatch.setattr(admin_jobs_api.celery_app, "send_task", unexpected_celery_publish)

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
        ("/api/v1/admin/jobs/diagnostics/celery", "POST"),
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
        ("/api/v1/admin/jobs/diagnostics/celery", "post"),
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


def test_celery_connectivity_test_requires_jobs_read_and_publishes_to_maintenance(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api.v1 import admin_jobs as admin_jobs_api
    from app.core.dependencies import optional_admin_context

    context = AdminContext(
        user={"id": "admin-id", "email": "admin@example.com"},
        permissions=frozenset({"jobs.read"}),
        request_id="request-test",
    )
    fastapi_app.dependency_overrides[optional_admin_context] = lambda: context
    monkeypatch.setattr(
        admin_jobs_api,
        "get_settings",
        lambda: Settings(_env_file=None, redis_url="rediss://broker.example.test"),
    )
    publications: list[tuple[str, dict[str, object]]] = []

    def send_task(task_name: str, **kwargs: object) -> SimpleNamespace:
        publications.append((task_name, kwargs))
        return SimpleNamespace(id=kwargs["task_id"])

    monkeypatch.setattr(admin_jobs_api.celery_app, "send_task", send_task)
    response = client.post("/api/v1/admin/jobs/diagnostics/celery")

    assert response.status_code == 202
    assert response.json()["success"] is True
    assert response.json()["queue"] == "pns-maintenance"
    assert publications[0][0] == "pns.tasks.celery_connectivity_test"
    assert publications[0][1]["queue"] == "pns-maintenance"
    assert publications[0][1]["headers"]["request_id"] == response.json()["requestId"]


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


@pytest.mark.parametrize("image_format", ["JPEG", "PNG", "WEBP", "GIF", "TIFF", "BMP", "AVIF"])
def test_supported_static_formats_produce_valid_webp(image_format: str) -> None:
    output, _, _ = _process_image(_image_bytes(image_format), f"source.{image_format.lower()}")
    with Image.open(io.BytesIO(output)) as image:
        assert image.format == "WEBP"


def test_transparent_png_keeps_alpha_after_webp_conversion() -> None:
    output = io.BytesIO()
    Image.new("RGBA", (4, 3), color=(18, 40, 90, 0)).save(output, format="PNG")
    converted, _, _ = _process_image(output.getvalue(), "transparent.png")
    with Image.open(io.BytesIO(converted)) as image:
        assert image.format == "WEBP"
        assert "A" in image.getbands()


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
            object(),
            "room",
            "vajra",
            "https://images.example/room.webp?token=abc%2F123&size=large",
            "admin-id",
        )

    monkeypatch.setattr("app.services.image_service.save_managed_image", save_image)
    image = asyncio.run(create_image())
    assert image == {
        "id": "image-id",
        "url": "https://images.example/room.webp?token=abc%2F123&size=large",
    }


def test_uploaded_image_is_saved_to_storage_and_only_metadata_is_saved_in_database(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    saved: dict[str, object] = {}
    stored: dict[str, object] = {}

    async def upload_object(path: str, data: bytes) -> str:
        stored.update(path=path, data=data)
        return "https://project.supabase.co/storage/v1/object/public/pns-images/" + path

    async def save_image(*_args: object, **kwargs: object) -> dict[str, object]:
        saved.update(kwargs)
        return {
            "id": "image-id",
            "url": str(kwargs["url"]),
            "filename": str(kwargs["storage_path"]).rsplit("/", 1)[-1],
        }

    monkeypatch.setattr(image_service, "upload_object", upload_object)
    monkeypatch.setattr(image_service, "save_managed_image", save_image)
    image = asyncio.run(
        add_uploaded_image(
            object(), "room", "vajra", "room.png", _image_bytes(), "admin-id"
        )
    )

    assert saved["source_type"] == "upload"
    assert saved["content_type"] == "image/webp"
    assert saved["image_data"] is None
    assert str(saved["storage_path"]).startswith("uploads/room/vajra/")
    assert stored["path"] == saved["storage_path"]
    with Image.open(io.BytesIO(stored["data"])) as stored_image:
        assert stored_image.format == "WEBP"
    assert image["url"].startswith("https://project.supabase.co/storage/")


def test_uploaded_image_rejects_empty_file() -> None:
    with pytest.raises(Exception) as empty:
        _process_image(b"", "empty.png")
    assert getattr(empty.value, "code", None) == "empty_file"


def test_storage_backed_image_content_is_read_from_storage(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def get_content(*_args: object, **_kwargs: object) -> dict[str, object]:
        return {
            "image_data": None,
            "content_type": None,
            "source_type": "upload",
            "storage_path": "uploads/room/vajra/room.webp",
            "public_url": "",
            "category_type": "room",
            "category_id": "vajra",
        }

    async def get_object(path: str) -> bytes:
        assert path == "uploads/room/vajra/room.webp"
        return b"stored webp bytes"

    monkeypatch.setattr(image_service, "get_managed_image_content", get_content)
    monkeypatch.setattr(image_service, "get_object", get_object)
    result = asyncio.run(image_service.image_content(object(), "image-id"))
    assert result is not None
    assert result["image_data"] == b"stored webp bytes"


def test_uploaded_image_urls_choose_database_or_storage_urls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    legacy = image_repository._image(
        {
            "id": "legacy-id",
            "category_id": "vajra",
            "source_type": "upload",
            "storage_path": "uploads/room/vajra/legacy.webp",
            "has_database_content": True,
        }
    )
    public = image_repository._image(
        {
            "id": "storage-id",
            "category_id": "vajra",
            "source_type": "upload",
            "storage_path": "uploads/room/vajra/storage.webp",
            "content_type": None,
            "has_database_content": False,
            "public_url": "https://project.supabase.co/storage/v1/object/public/pns-images/uploads/room/vajra/storage.webp",
        }
    )
    private = image_repository._image(
        {
            "id": "private-id",
            "category_id": "vajra",
            "source_type": "upload",
            "storage_path": "uploads/room/vajra/private.webp",
            "content_type": "image/webp",
            "has_database_content": False,
            "public_url": "",
        }
    )
    assert legacy["url"].startswith("/api/v1/images/content/legacy-id")
    assert public["url"] == ""
    assert private["url"] == ""

    async def resolve() -> None:
        async def resolve_url(path: str) -> str:
            return f"https://project.supabase.co/storage/v1/object/public/pns-images/{path}"

        monkeypatch.setattr(image_service, "resolve_object_url", resolve_url)
        await image_service._resolve_storage_image_urls(
            [legacy, public, private], "room", "vajra"
        )

    asyncio.run(resolve())
    assert legacy["url"].startswith("/api/v1/images/content/legacy-id")
    assert public["url"].endswith("uploads/room/vajra/storage.webp")
    assert private["url"].endswith("uploads/room/vajra/private.webp")


def test_external_url_is_returned_without_cache_query_changes() -> None:
    original_url = "https://images.example/file.jpg?token=abc%2F123&size=large"
    image = image_repository._image(
        {
            "id": "external-id",
            "category_id": "vajra",
            "source_type": "external",
            "public_url": original_url,
            "storage_path": None,
        }
    )
    assert image["url"] == original_url


def test_external_url_validation_rejects_credentials_and_bad_ports() -> None:
    for image_url in (
        "javascript:alert(1)",
        "https://user:pass@images.example/a.webp",
        "https://images.example:bad/a.webp",
    ):
        with pytest.raises(Exception) as invalid:
            asyncio.run(
                add_external_image(
                    object(), "room", "vajra", image_url, "admin-id"
                )
            )
        assert getattr(invalid.value, "code", None) == "invalid_url"


def test_storage_path_is_limited_to_expected_category_prefix() -> None:
    assert image_storage.managed_object_path(
        "room", "vajra", "uploads/room/vajra/file.webp"
    ) == "uploads/room/vajra/file.webp"
    for path in (
        "uploads/room/garuda/file.webp",
        "uploads/room/vajra/../file.webp",
        "uploads/room/vajra/subfolder/file.webp",
    ):
        with pytest.raises(Exception) as invalid:
            image_storage.managed_object_path("room", "vajra", path)
        assert getattr(invalid.value, "code", None) == "invalid_storage_path"


def test_storage_upload_verifies_bytes_and_public_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(
        _env_file=None,
        supabase_url="https://project.supabase.co",
        supabase_secret_key="test-secret",
        supabase_storage_bucket="pns-images",
        supabase_storage_public=True,
    )
    monkeypatch.setattr(image_storage, "get_settings", lambda: settings)
    requests: list[tuple[str, str, dict[str, str], bytes | None]] = []
    stored_bytes = b"verified webp data"

    async def request(
        method: str,
        url: str,
        *,
        headers: dict[str, str],
        content: bytes | None = None,
        json: dict | None = None,
    ) -> httpx.Response:
        requests.append((method, url, headers, content))
        if method == "POST":
            return httpx.Response(200)
        if method == "GET":
            return httpx.Response(
                200, headers={"content-type": "image/webp"}, content=stored_bytes
            )
        raise AssertionError(f"Unexpected method: {method}")

    monkeypatch.setattr(image_storage, "_request", request)
    url = asyncio.run(
        image_storage.upload_object("uploads/room/vajra/example.webp", stored_bytes)
    )

    assert url == "https://project.supabase.co/storage/v1/object/public/pns-images/uploads/room/vajra/example.webp"
    assert requests[0][0] == "POST"
    assert requests[0][2]["Content-Type"] == "image/webp"
    assert requests[0][2]["x-upsert"] == "false"
    assert requests[0][3] == stored_bytes
    assert requests[1][0] == "GET"
    assert requests[1][2]["Authorization"] == "Bearer test-secret"
    assert requests[2][0] == "GET" and requests[2][2] == {}


def test_private_storage_image_gets_a_signed_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(
        _env_file=None,
        supabase_url="https://project.supabase.co",
        supabase_secret_key="test-secret",
        supabase_storage_bucket="pns-images",
        supabase_storage_public=False,
    )
    monkeypatch.setattr(image_storage, "get_settings", lambda: settings)
    request_data: dict[str, object] = {}

    async def request(
        method: str,
        url: str,
        *,
        headers: dict[str, str],
        content: bytes | None = None,
        json: dict | None = None,
    ) -> httpx.Response:
        request_data.update(method=method, url=url, headers=headers, json=json)
        return httpx.Response(
            200,
            json={"signedURL": "/object/sign/pns-images/uploads/room/vajra/file.webp?token=short-lived"},
        )

    monkeypatch.setattr(image_storage, "_request", request)
    url = asyncio.run(image_storage.resolve_object_url("uploads/room/vajra/file.webp"))

    assert url == "https://project.supabase.co/storage/v1/object/sign/pns-images/uploads/room/vajra/file.webp?token=short-lived"
    assert request_data["method"] == "POST"
    assert request_data["json"] == {"expiresIn": 3600}
    assert request_data["headers"]["Authorization"] == "Bearer test-secret"


def test_storage_upload_fails_when_object_verification_differs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(
        _env_file=None,
        supabase_url="https://project.supabase.co",
        supabase_secret_key="test-secret",
        supabase_storage_bucket="pns-images",
    )
    monkeypatch.setattr(image_storage, "get_settings", lambda: settings)
    methods: list[str] = []

    async def request(
        method: str,
        _url: str,
        *,
        headers: dict[str, str],
        content: bytes | None = None,
        json: dict | None = None,
    ) -> httpx.Response:
        methods.append(method)
        return httpx.Response(200, content=b"different bytes" if method == "GET" else b"")

    monkeypatch.setattr(image_storage, "_request", request)
    with pytest.raises(Exception) as failed:
        asyncio.run(
            image_storage.upload_object(
                "uploads/room/vajra/example.webp", b"expected bytes"
            )
        )
    assert getattr(failed.value, "code", None) == "storage_verification_failed"
    assert methods == ["POST", "GET", "DELETE"]


def test_storage_requires_backend_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(image_storage, "get_settings", lambda: Settings(_env_file=None))
    with pytest.raises(Exception) as missing:
        image_storage._storage_settings()
    assert getattr(missing.value, "code", None) == "storage_not_configured"


def test_storage_image_delete_verifies_object_then_removes_database_record(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, object]] = []
    db = type(
        "FakeDatabase",
        (),
        {"flush": lambda self: asyncio.sleep(0)},
    )()
    row = {
        "source_type": "upload",
        "has_database_content": False,
        "content_type": "image/webp",
        "storage_path": "uploads/room/vajra/room.webp",
        "is_active": True,
    }

    async def get_image(*_args: object) -> dict[str, object] | None:
        calls.append(("lookup", "image-id"))
        return row if calls.count(("lookup", "image-id")) == 1 else None

    async def get_object(path: str) -> bytes | None:
        calls.append(("read", path))
        return b"stored image bytes" if calls.count(("read", path)) == 1 else None

    async def delete_image(*args: object) -> bool:
        calls.append(("delete_record", args))
        return True

    async def delete_object(path: str) -> None:
        calls.append(("delete", path))

    monkeypatch.setattr(image_service, "get_managed_image", get_image)
    monkeypatch.setattr(image_service, "get_object", get_object)
    monkeypatch.setattr(image_service, "delete_managed_image_record", delete_image)
    monkeypatch.setattr(image_service, "delete_object", delete_object)
    result = asyncio.run(
        image_service.delete_managed_image(
            db, "room", "vajra", "image-id"
        )
    )

    assert calls == [
        ("lookup", "image-id"),
        ("read", "uploads/room/vajra/room.webp"),
        ("delete", "uploads/room/vajra/room.webp"),
        ("read", "uploads/room/vajra/room.webp"),
        ("delete_record", (db, "image-id", "room", "vajra")),
        ("lookup", "image-id"),
    ]
    assert result == {
        "record_id": "image-id",
        "storage_path": "uploads/room/vajra/room.webp",
        "backup": b"stored image bytes",
    }


def test_storage_delete_failure_is_not_reported_as_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    row = {
        "source_type": "upload",
        "has_database_content": False,
        "content_type": "image/webp",
        "storage_path": "uploads/room/vajra/room.webp",
        "is_active": True,
    }

    async def get_image(*_args: object) -> dict[str, object]:
        return row

    async def get_object(_path: str) -> bytes:
        return b"stored image bytes"

    async def delete_image(*_args: object) -> bool:
        raise AssertionError("Database mapping must remain when Storage deletion fails.")

    async def delete_object(_path: str) -> None:
        raise ImageManagementError("storage_error", "Storage deletion failed.", 502)

    monkeypatch.setattr(image_service, "get_managed_image", get_image)
    monkeypatch.setattr(image_service, "get_object", get_object)
    monkeypatch.setattr(image_service, "delete_managed_image_record", delete_image)
    monkeypatch.setattr(image_service, "delete_object", delete_object)
    with pytest.raises(ImageManagementError) as failed:
        asyncio.run(
            image_service.delete_managed_image(
                object(), "room", "vajra", "image-id"
            )
        )
    assert failed.value.code == "storage_error"


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
