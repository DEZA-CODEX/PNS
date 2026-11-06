from __future__ import annotations

import asyncio
import hmac
import ipaddress
import logging
import socket
import ssl
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from enum import StrEnum
from typing import Annotated
from urllib.parse import urljoin, urlsplit, urlunsplit
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator
from sqlalchemy import text

from app.core.config import get_settings
from app.core.database import get_engine, get_session_factory
from app.core.rate_limit import login_rate_limiter

logger = logging.getLogger("pns.diagnostics")
router = APIRouter()


class Status(StrEnum):
    PASS = "PASS"
    FAIL = "FAIL"
    WARNING = "WARNING"
    SKIPPED = "SKIPPED"
    NOT_TESTED = "NOT_TESTED"


class BrowserResultPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    correlation_id: UUID
    test_identifier: UUID = Field(default_factory=uuid4)
    test_type: str = Field(pattern=r"^(browser_to_backend|browser_cors_preflight|browser_credentialed_request)$")
    target_url: HttpUrl = Field(max_length=2048)
    status: Status
    http_status: int | None = Field(default=None, ge=100, le=599)
    duration_ms: int = Field(ge=0, le=120_000)
    credentials_included: bool = False
    error_category: str | None = Field(default=None, max_length=40)
    error_message: str | None = Field(default=None, max_length=500)
    timestamp: datetime

    @field_validator("timestamp")
    @classmethod
    def require_aware_timestamp(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Timestamp must include a timezone.")
        return value

    @field_validator("error_category")
    @classmethod
    def validate_error_category(cls, value: str | None) -> str | None:
        allowed = {
            "CORS_ERROR",
            "CONNECTION_TIMEOUT",
            "HTTP_ERROR",
            "NETWORK_ERROR",
            "UNKNOWN_ERROR",
        }
        if value is not None and value not in allowed:
            raise ValueError("Unsupported browser error category.")
        return value


_browser_results: dict[str, dict[str, object]] = {}
_rate_buckets: dict[str, deque[float]] = defaultdict(deque)
_state_lock = asyncio.Lock()
_RESULT_TTL = timedelta(minutes=15)
_MAX_RESULTS = 100
_RATE_LIMIT = 30
_RATE_WINDOW_SECONDS = 60


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _result(
    name: str,
    status: Status,
    *,
    target: str | None = None,
    duration_ms: int = 0,
    http_status: int | None = None,
    error_category: str | None = None,
    message: str | None = None,
    action: str | None = None,
    details: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "name": name,
        "status": status.value,
        "target": target,
        "duration_ms": duration_ms,
        "http_status": http_status,
        "error_category": error_category,
        "message": message,
        "suggested_action": action,
        "details": details or {},
        "timestamp": _now().isoformat(),
    }


def _sanitize_url(value: str) -> str:
    try:
        parsed = urlsplit(value)
        host = parsed.hostname or ""
        port = parsed.port
    except ValueError:
        return "Invalid redirect URL"
    if not host or host.lower() == "localhost" or host.lower().endswith(".local"):
        return "Private redirect destination omitted"
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address and (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_reserved
        or address.is_unspecified
    ):
        return "Private redirect destination omitted"
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    if port:
        host = f"{host}:{port}"
    return urlunsplit((parsed.scheme, host, "", "", ""))


def _error_category(error: BaseException) -> tuple[str, str, str]:
    seen: set[int] = set()
    current: BaseException | None = error
    chain: list[BaseException] = []
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        chain.append(current)
        current = current.__cause__ or current.__context__
    if any(isinstance(item, ssl.SSLError) for item in chain):
        return "TLS_ERROR", "The TLS connection to the configured frontend failed.", "Verify the frontend TLS certificate and deployment URL."
    if any(isinstance(item, socket.gaierror) for item in chain):
        return "DNS_ERROR", "The configured frontend hostname could not be resolved.", "Verify the frontend URL and DNS records."
    if isinstance(error, httpx.TimeoutException):
        return "CONNECTION_TIMEOUT", "The frontend did not respond within the configured timeout.", "Verify frontend availability and network access."
    if any(
        isinstance(item, OSError) and getattr(item, "errno", None) in {111, 61, 10061}
        for item in chain
    ):
        return "CONNECTION_REFUSED", "The frontend refused the connection.", "Verify the frontend deployment is accepting HTTPS requests."
    if isinstance(error, httpx.ConnectError):
        return "CONNECTION_ERROR", "The backend could not establish a connection to the frontend.", "Verify the frontend URL, DNS, TLS and network access."
    return "UNKNOWN_ERROR", "The frontend connectivity check could not be completed.", "Review the configured frontend URL and deployment availability."


def _classify_database_error(error: BaseException) -> tuple[str, str, str]:
    seen: set[int] = set()
    current: BaseException | None = error
    chain: list[BaseException] = []
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        chain.append(current)
        current = current.__cause__ or current.__context__

    if any(isinstance(item, ssl.SSLError) for item in chain):
        return (
            "TLS_ERROR",
            "The PostgreSQL endpoint rejected or failed the TLS handshake.",
            "Verify that the direct Supabase host is configured with sslmode=require and the runtime can establish TLS to the endpoint.",
        )
    if any(isinstance(item, socket.gaierror) for item in chain):
        return (
            "DNS_ERROR",
            "The PostgreSQL hostname could not be resolved.",
            "Verify the direct Supabase hostname and the runtime's DNS resolution for the selected Vercel environment.",
        )
    if any(isinstance(item, TimeoutError) or isinstance(item, socket.timeout) for item in chain):
        return (
            "CONNECTION_TIMEOUT",
            "The PostgreSQL TCP connection timed out.",
            "Check direct-host connectivity, Vercel network restrictions, and whether IPv6 is available for the configured endpoint.",
        )
    if any(isinstance(item, OSError) and getattr(item, "errno", None) in {101, 111, 61, 10061} for item in chain):
        return (
            "CONNECTION_REFUSED",
            "The PostgreSQL server refused the network connection.",
            "Confirm the Supabase direct host, port, and network access rules for the deployment environment.",
        )
    if any(
        type(item).__name__ in {"InvalidPasswordError", "InvalidAuthorizationSpecificationError"}
        for item in chain
    ):
        return (
            "AUTH_ERROR",
            "The PostgreSQL credentials are rejected by the database server.",
            "Verify the direct connection username and password in the deployment environment without exposing stored secrets.",
        )
    return (
        "DATABASE_ERROR",
        "The PostgreSQL connection could not be established.",
        "Inspect the direct database hostname, TLS configuration, and deployment network access before retrying.",
    )


def _database_network_probe(raw_url: str | None) -> dict[str, object]:
    if not raw_url:
        return {"status": "not_configured", "dns": "not_configured", "ipv6": "not_configured", "ipv4": "not_configured"}

    try:
        parts = urlsplit(raw_url)
    except ValueError:
        return {"status": "invalid_url", "dns": "invalid_url", "ipv6": "invalid_url", "ipv4": "invalid_url"}

    host = parts.hostname
    port = parts.port or 5432
    if not host:
        return {"status": "missing_host", "dns": "missing_host", "ipv6": "missing_host", "ipv4": "missing_host"}

    try:
        addrinfo = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as error:
        return {
            "status": "dns_failed",
            "dns": "failed",
            "ipv6": "not_resolved",
            "ipv4": "not_resolved",
            "error_category": "DNS_ERROR",
            "message": "DNS resolution for the direct PostgreSQL hostname failed.",
            "sanitized_error": str(error).split(":", 1)[0] if str(error) else "DNS resolution failed",
        }

    families = {info[0] for info in addrinfo}
    probes: list[dict[str, object]] = []
    for family, family_name in ((socket.AF_INET6, "ipv6"), (socket.AF_INET, "ipv4")):
        if family not in families:
            probes.append({"family": family_name, "status": "unsupported"})
            continue

        address = next(info[4][0] for info in addrinfo if info[0] == family)
        try:
            with socket.create_connection((address, port), timeout=5):
                probes.append({"family": family_name, "status": "reachable"})
        except socket.timeout:
            probes.append({"family": family_name, "status": "timeout"})
        except OSError as error:
            probes.append({"family": family_name, "status": "refused", "error": getattr(error, "errno", None)})

    network = {"status": "resolved", "dns": "ok", "ipv6": "unsupported", "ipv4": "unsupported"}
    for probe in probes:
        family = str(probe["family"])
        network[family] = probe["status"]
    return network


async def _check_frontend(url: str, timeout_seconds: float) -> dict[str, object]:
    if not url:
        return _result(
            "Backend to frontend",
            Status.FAIL,
            error_category="CONFIGURATION_ERROR",
            message="FRONTEND_URL is not configured.",
            action="Set FRONTEND_URL to the deployed frontend origin.",
        )
    target = f"{url}/"
    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_seconds), follow_redirects=False
        ) as client:
            async with client.stream("GET", target) as response:
                response_status = response.status_code
                redirect = response.headers.get("location")
    except (httpx.HTTPError, OSError, ssl.SSLError) as error:
        category, message, action = _error_category(error)
        return _result(
            "Backend to frontend",
            Status.FAIL,
            target=target,
            duration_ms=round((time.perf_counter() - started) * 1000),
            error_category=category,
            message=message,
            action=action,
        )
    duration_ms = round((time.perf_counter() - started) * 1000)
    safe_redirect = _sanitize_url(urljoin(target, redirect)) if redirect else None
    status = Status.WARNING if response_status >= 500 or 300 <= response_status < 400 else Status.PASS
    return _result(
        "Backend to frontend",
        status,
        target=target,
        duration_ms=duration_ms,
        http_status=response_status,
        error_category="HTTP_ERROR" if response_status >= 500 else None,
        message=(
            "The frontend returned an HTTP error response."
            if response_status >= 500
            else "The frontend redirected the request; reachability is confirmed."
            if 300 <= response_status < 400
            else "The frontend returned an HTTP response."
        ),
        action="Review frontend server errors." if response_status >= 500 else None,
        details={"redirect_destination": safe_redirect},
    )


async def run_backend_checks(
    application: object, test_name: str | None = None
) -> tuple[list[dict[str, object]], int]:
    settings = get_settings()
    started = time.perf_counter()
    if test_name is None:
        names = [
            "FastAPI application",
            "API routing",
            "Deployment configuration",
            "Backend to frontend",
            "PostgreSQL connection and SELECT 1",
            "Database session availability",
            "Redis",
            "Rate limiter",
            "Image repository and storage",
            "Authentication and session repository",
        ]

        async def run_one(name: str) -> tuple[list[dict[str, object]], int]:
            try:
                return await run_backend_checks(application, name)
            except Exception:
                logger.warning("Diagnostic check %s failed unexpectedly.", name)
                return [
                    _result(
                        name,
                        Status.FAIL,
                        error_category="APPLICATION_ERROR",
                        message="The diagnostic check could not be completed.",
                        action="Review the backend service configuration and retry.",
                    )
                ], 0

        checks = await asyncio.gather(*(run_one(name) for name in names))
        return (
            [result for check_results, _ in checks for result in check_results],
            round((time.perf_counter() - started) * 1000),
        )

    results: list[dict[str, object]] = []

    def selected(name: str) -> bool:
        return test_name is None or test_name == name

    if selected("FastAPI application"):
        results.append(
            _result("FastAPI application", Status.PASS, message="The FastAPI application is running.")
        )

    if selected("API routing"):
        app_routes = getattr(application, "routes", [])
        active_path = (
            application if isinstance(application, str) else getattr(application, "path", "")
        )
        has_api_routes = any(
            getattr(route, "path", "").startswith("/api/v1/")
            for route in app_routes
        ) or active_path.startswith("/api/v1/")
        results.append(
            _result(
                "API routing",
                Status.PASS if has_api_routes else Status.FAIL,
                message="Versioned API routes are registered." if has_api_routes else "Versioned API routes are not registered.",
                error_category=None if has_api_routes else "ROUTING_ERROR",
                action=None if has_api_routes else "Check API router registration in the FastAPI application.",
            )
        )

    if selected("Deployment configuration"):
        frontend_ok = bool(settings.frontend_url)
        backend_ok = bool(settings.backend_public_url)
        database_configured = bool(settings.database_url)
        diagnostics_token_set = bool(settings.diagnostics_token)
        cors_ok = frontend_ok and settings.frontend_url in settings.cors_origins
        backend_host = urlsplit(settings.backend_public_url).hostname if backend_ok else None
        trusted_host_ok = bool(backend_host and backend_host in settings.allowed_hosts)
        config_status = (
            Status.PASS
            if frontend_ok
            and backend_ok
            and database_configured
            and diagnostics_token_set
            and cors_ok
            and trusted_host_ok
            else Status.WARNING
        )
        results.append(
            _result(
                "Deployment configuration",
                config_status,
                message=(
                    "Required URLs, database, diagnostics access, CORS and trusted host are configured."
                    if config_status == Status.PASS
                    else "One or more required URLs, credentials, CORS or trusted-host settings are missing or inconsistent."
                ),
                error_category=None if config_status == Status.PASS else "CONFIGURATION_ERROR",
                action=None if config_status == Status.PASS else "Configure FRONTEND_URL, BACKEND_PUBLIC_URL, DATABASE_URL, PNS_DIAGNOSTICS_TOKEN, CORS_ORIGINS and PNS_ALLOWED_HOSTS consistently.",
                details={
                    "frontend_url_configured": frontend_ok,
                    "backend_public_url_configured": backend_ok,
                    "database_configured": database_configured,
                    "diagnostics_token_configured": diagnostics_token_set,
                    "frontend_origin_allowed": bool(cors_ok),
                    "backend_host_trusted": trusted_host_ok,
                    "credentialed_cors": True,
                    "wildcard_origin_conflict": "*" in settings.cors_origins,
                },
            )
        )

    if selected("Backend to frontend"):
        results.append(
            await _check_frontend(
                settings.frontend_url, settings.diagnostics_timeout_seconds
            )
        )

    connection_name = "PostgreSQL connection and SELECT 1"
    session_name = "Database session availability"
    if selected(connection_name) or selected(session_name):
        database_started = time.perf_counter()
        try:
            engine = get_engine()
            session_factory = get_session_factory()
        except Exception:
            logger.warning("PostgreSQL diagnostic configuration could not be initialized.")
            engine = None
            session_factory = None

        if selected(connection_name):
            if engine is None:
                results.append(
                    _result(
                        connection_name,
                        Status.FAIL,
                        duration_ms=round((time.perf_counter() - database_started) * 1000),
                        error_category="CONFIGURATION_ERROR" if not settings.database_url else "DATABASE_ERROR",
                        message="The PostgreSQL engine is not available.",
                        action="Verify DATABASE_URL and PostgreSQL driver configuration.",
                    )
                )
            else:
                network_probe = _database_network_probe(settings.database_url)
                try:
                    async with asyncio.timeout(settings.diagnostics_timeout_seconds):
                        async with engine.connect() as connection:
                            await connection.execute(text("SELECT 1"))
                    results.append(
                        _result(
                            connection_name,
                            Status.PASS,
                            target="PostgreSQL (credentials hidden)",
                            duration_ms=round((time.perf_counter() - database_started) * 1000),
                            message="PostgreSQL connection and SELECT 1 succeeded.",
                            details={"connection_pool": engine.pool.status(), "network": network_probe},
                        )
                    )
                except Exception as error:
                    logger.warning("PostgreSQL diagnostic query failed.")
                    category, message, action = _classify_database_error(error)
                    results.append(
                        _result(
                            connection_name,
                            Status.FAIL,
                            target="PostgreSQL (credentials hidden)",
                            duration_ms=round((time.perf_counter() - database_started) * 1000),
                            error_category=category,
                            message=message,
                            action=action,
                            details={"network": network_probe},
                        )
                    )

        if selected(session_name):
            session_started = time.perf_counter()
            if session_factory is None:
                results.append(
                    _result(
                        session_name,
                        Status.FAIL,
                        error_category="DATABASE_ERROR",
                        message="No database session factory is available.",
                        action="Verify DATABASE_URL and SQLAlchemy session configuration.",
                    )
                )
            else:
                try:
                    async with asyncio.timeout(settings.diagnostics_timeout_seconds):
                        async with session_factory() as session:
                            await session.execute(text("SELECT 1"))
                    results.append(
                        _result(
                            session_name,
                            Status.PASS,
                            duration_ms=round((time.perf_counter() - session_started) * 1000),
                            message="A SQLAlchemy database session successfully executed SELECT 1.",
                        )
                    )
                except Exception:
                    logger.warning("Database session diagnostic failed.")
                    results.append(
                        _result(
                            session_name,
                            Status.FAIL,
                            duration_ms=round((time.perf_counter() - session_started) * 1000),
                            error_category="DATABASE_ERROR",
                            message="A SQLAlchemy database session could not execute SELECT 1.",
                            action="Verify the PostgreSQL connection pool and database availability.",
                        )
                    )

    if selected("Redis") or selected("Rate limiter"):
        redis_started = time.perf_counter()
        if not settings.redis_url:
            if selected("Redis"):
                results.append(
                    _result(
                        "Redis",
                        Status.SKIPPED,
                        message="Redis is not configured.",
                    )
                )
            if selected("Rate limiter"):
                results.append(
                    _result(
                        "Rate limiter",
                        Status.WARNING,
                        message="The in-memory rate limiter is instance-local and is not shared across serverless instances.",
                        action="Configure REDIS_URL for shared rate limiting in production.",
                    )
                )
        else:
            try:
                async with asyncio.timeout(settings.diagnostics_timeout_seconds):
                    redis_ok = await login_rate_limiter.health_check()
            except Exception:
                logger.warning("Redis diagnostic check failed.")
                redis_ok = False
            if selected("Redis"):
                results.append(
                    _result(
                        "Redis",
                        Status.PASS if redis_ok else Status.FAIL,
                        duration_ms=round((time.perf_counter() - redis_started) * 1000),
                        message="Redis responded to PING." if redis_ok else "Redis did not respond to PING.",
                        error_category=None if redis_ok else "REDIS_ERROR",
                        action=None if redis_ok else "Verify REDIS_URL and Redis availability.",
                    )
                )
            if selected("Rate limiter"):
                results.append(
                    _result(
                        "Rate limiter",
                        Status.PASS if redis_ok else Status.FAIL,
                        message="Redis-backed login rate limiting is available." if redis_ok else "The configured shared rate-limit store is unavailable.",
                        error_category=None if redis_ok else "REDIS_ERROR",
                    )
                )

    if selected("Image repository and storage"):
        results.append(
            _result(
                "Image repository and storage",
                Status.SKIPPED,
                message="Image metadata uses the tested PostgreSQL database; image storage has no independent remote health endpoint.",
            )
        )
    if selected("Authentication and session repository"):
        results.append(
            _result(
                "Authentication and session repository",
                Status.SKIPPED,
                message="Authentication and session data share PostgreSQL; no login or credential operation was performed.",
            )
        )
    return results, round((time.perf_counter() - started) * 1000)


def _overall_status(results: list[dict[str, object]]) -> str:
    statuses = {str(result["status"]) for result in results}
    if Status.FAIL.value in statuses:
        return "UNHEALTHY" if statuses == {Status.FAIL.value} else "PARTIALLY_HEALTHY"
    if Status.WARNING.value in statuses:
        return "PARTIALLY_HEALTHY"
    if statuses == {Status.NOT_TESTED.value}:
        return "NOT_TESTED"
    return "HEALTHY"


async def _authorize(token: str | None) -> None:
    expected = get_settings().diagnostics_token
    if not expected or not token or not hmac.compare_digest(token, expected):
        raise HTTPException(status_code=403, detail="Diagnostics access is not authorized.")


async def _rate_limit(request: Request, bucket: str, limit: int = _RATE_LIMIT) -> None:
    now = time.monotonic()
    key = f"{bucket}:{request.client.host if request.client else 'unknown'}"
    async with _state_lock:
        calls = _rate_buckets[key]
        while calls and calls[0] <= now - _RATE_WINDOW_SECONDS:
            calls.popleft()
        if len(calls) >= limit:
            raise HTTPException(status_code=429, detail="Diagnostics rate limit exceeded.")
        calls.append(now)
        while len(_rate_buckets) > 256:
            oldest = min(
                _rate_buckets,
                key=lambda item: _rate_buckets[item][-1] if _rate_buckets[item] else 0,
            )
            _rate_buckets.pop(oldest, None)


def _cleanup_results() -> None:
    cutoff = _now() - _RESULT_TTL
    expired = [
        key
        for key, value in _browser_results.items()
        if datetime.fromisoformat(str(value["updated_at"])) < cutoff
    ]
    for key in expired:
        _browser_results.pop(key, None)
    while len(_browser_results) > _MAX_RESULTS:
        oldest = min(_browser_results, key=lambda key: str(_browser_results[key]["updated_at"]))
        _browser_results.pop(oldest, None)


def _combined_response(correlation_id: str) -> dict[str, object]:
    entry = _browser_results[correlation_id]
    backend = entry.get("backend", [])
    browser = entry.get("results", [])
    combined = list(backend) + list(browser)
    return {
        "correlation_id": correlation_id,
        "status": _overall_status(combined),
        "duration_ms": entry.get("duration_ms", 0),
        "timestamp": entry["updated_at"],
        "failed_count": sum(result["status"] == Status.FAIL.value for result in combined),
        "warning_count": sum(result["status"] == Status.WARNING.value for result in combined),
        "results": combined,
        "serverless_note": "Browser results are transient and may not be available on a different Vercel serverless instance.",
    }


@router.post("/diagnostics/run")
async def run_diagnostics(
    request: Request,
    test_name: Annotated[str | None, Query(max_length=64)] = None,
    x_pns_diagnostics_token: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    allowed_tests = {
        "FastAPI application",
        "Serverless execution",
        "API routing",
        "Deployment configuration",
        "Backend to frontend",
        "PostgreSQL connection and SELECT 1",
        "Database session availability",
        "Redis",
        "Rate limiter",
        "Image repository and storage",
        "Authentication and session repository",
    }
    if test_name is not None and test_name not in allowed_tests:
        raise HTTPException(status_code=400, detail="Unknown diagnostic test name.")
    await _authorize(x_pns_diagnostics_token)
    await _rate_limit(request, "run", limit=10)
    results, duration_ms = await run_backend_checks(request.url.path, test_name)
    if test_name is None or test_name == "Serverless execution":
        results.append(
            _result(
                "Serverless execution",
                Status.PASS,
                message="The diagnostic API request completed in the current serverless invocation.",
            )
        )
    correlation_id = str(uuid4())
    async with _state_lock:
        _cleanup_results()
        _browser_results[correlation_id] = {
            "backend": results,
            "duration_ms": duration_ms,
            "results": [],
            "updated_at": _now().isoformat(),
        }
        _cleanup_results()
    response = _combined_response(correlation_id)
    if test_name:
        response["results"] = [
            item for item in response["results"] if item["name"] == test_name
        ]
        response["failed_count"] = sum(
            item["status"] == Status.FAIL.value for item in response["results"]
        )
        response["warning_count"] = sum(
            item["status"] == Status.WARNING.value for item in response["results"]
        )
        response["status"] = _overall_status(response["results"])
    return response


@router.post("/diagnostics/browser-result")
async def record_browser_result(
    payload: BrowserResultPayload,
    request: Request,
    x_pns_diagnostics_token: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    await _authorize(x_pns_diagnostics_token)
    await _rate_limit(request, "browser-result")
    settings = get_settings()
    expected = f"{settings.backend_public_url}/api/health" if settings.backend_public_url else ""
    if not expected or str(payload.target_url) != expected:
        raise HTTPException(status_code=400, detail="The browser test target does not match BACKEND_PUBLIC_URL.")
    if payload.timestamp > _now() + timedelta(minutes=5):
        raise HTTPException(status_code=400, detail="The browser result timestamp is invalid.")
    if payload.credentials_included != (
        payload.test_type == "browser_credentialed_request"
    ):
        raise HTTPException(status_code=400, detail="Credential reporting does not match the test type.")
    if payload.error_message and any(
        marker in payload.error_message.lower()
        for marker in (
            "password",
            "cookie",
            "authorization",
            "bearer ",
            "token",
            "session",
            "credential",
            "secret",
        )
    ):
        raise HTTPException(status_code=400, detail="The browser result message contains sensitive data.")

    correlation_id = str(payload.correlation_id)
    test_result = _result(
        payload.test_type.replace("_", " ").title(),
        payload.status,
        target=expected,
        duration_ms=payload.duration_ms,
        http_status=payload.http_status,
        error_category=payload.error_category,
        message=payload.error_message,
        details={
            "test_identifier": str(payload.test_identifier),
            "timestamp": payload.timestamp.isoformat(),
            "credentials_included": payload.credentials_included,
        },
    )
    async with _state_lock:
        _cleanup_results()
        entry = _browser_results.setdefault(
            correlation_id,
            {"backend": [], "duration_ms": 0, "results": [], "updated_at": _now().isoformat()},
        )
        results = entry["results"]
        assert isinstance(results, list)
        results[:] = [item for item in results if item["name"] != test_result["name"]]
        results.append(test_result)
        entry["updated_at"] = _now().isoformat()
    return {"correlation_id": correlation_id, "result": test_result}


@router.get("/diagnostics/results")
async def get_diagnostics_results(
    request: Request,
    correlation_id: UUID | None = None,
    x_pns_diagnostics_token: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    await _authorize(x_pns_diagnostics_token)
    await _rate_limit(request, "results")
    async with _state_lock:
        _cleanup_results()
        key = str(correlation_id) if correlation_id else (
            max(_browser_results, key=lambda item: str(_browser_results[item]["updated_at"]))
            if _browser_results
            else None
        )
        if key is None or key not in _browser_results:
            return {
                "correlation_id": key,
                "status": "NOT_TESTED",
                "results": [],
                "message": "No transient browser diagnostic results are available on this serverless instance.",
            }
        value = _browser_results[key]
        return _combined_response(key)


DIAGNOSTICS_DASHBOARD = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PNS System Diagnostics</title>
<style>
:root{color-scheme:light;--bg:#f4f7fb;--card:#fff;--ink:#17243a;--muted:#66758b;--line:#e4eaf2;--blue:#275efe;--green:#14804a;--red:#c52e3d;--amber:#9b6500;--gray:#738096}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}.wrap{max-width:1080px;margin:38px auto;padding:0 20px}header{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:24px}h1{font-size:28px;line-height:1.2;margin:0 0 6px}.sub{color:var(--muted);margin:0}.toolbar{display:flex;flex-wrap:wrap;gap:9px;align-items:center;margin:20px 0}.token{width:min(310px,100%);padding:10px 12px;border:1px solid var(--line);border-radius:8px}button{border:0;border-radius:8px;padding:10px 15px;background:var(--blue);color:white;font-weight:650;cursor:pointer}button.secondary{background:#e8eef9;color:#243b68}button:disabled{opacity:.55;cursor:wait}.summary,.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:13px}.card,.check{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:17px;box-shadow:0 2px 9px #22335508}.label{font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}.value{font-size:21px;font-weight:700;margin-top:7px}.checks{margin-top:24px}.check{margin:11px 0}.check summary{cursor:pointer;list-style:none;display:flex;justify-content:space-between;gap:12px;font-weight:650}.check summary::-webkit-details-marker{display:none}.check p{margin:8px 0;color:var(--muted);overflow-wrap:anywhere}.status{font-size:12px;font-weight:750}.PASS,.HEALTHY{color:var(--green)}.FAIL,.UNHEALTHY{color:var(--red)}.WARNING,.PARTIALLY_HEALTHY{color:var(--amber)}.SKIPPED,.NOT_TESTED{color:var(--gray)}.technical{border-top:1px solid var(--line);margin-top:13px;padding-top:8px}.message{margin-top:10px;color:var(--ink)!important}.footer{color:var(--muted);font-size:13px;margin:20px 0}.error{color:var(--red);font-weight:600;white-space:pre-wrap}@media(max-width:620px){.wrap{margin:24px auto}header{display:block}.toolbar{align-items:stretch}.toolbar button,.token{width:100%}}
</style></head><body><main class="wrap">
<header><div><h1>PNS System Diagnostics</h1><p class="sub">Connectivity and backend service checks</p></div><div id="overall" class="status NOT_TESTED">NOT TESTED</div></header>
<section class="summary"><div class="card"><div class="label">Diagnostic categories</div><div class="value">6</div></div><div class="card"><div class="label">Last tested</div><div id="last-tested" class="value">—</div></div><div class="card"><div class="label">Last test duration</div><div id="duration" class="value">—</div></div><div class="card"><div class="label">Failed checks</div><div id="failed" class="value">—</div></div><div class="card"><div class="label">Warnings</div><div id="warnings" class="value">—</div></div></section>
<div class="toolbar"><input id="token" class="token" type="password" autocomplete="off" placeholder="Diagnostics access token" aria-label="Diagnostics access token"><button id="run">Run all tests</button><button id="refresh" class="secondary">Refresh results</button><button id="copy" class="secondary">Copy diagnostic report</button></div>
<p id="error" class="error" role="alert"></p><section id="checks" class="checks"><p class="sub">No tests have run. Results will appear here after a diagnostic run.</p></section>
<p id="note" class="footer">Detailed checks require PNS_DIAGNOSTICS_TOKEN. Results are transient on Vercel serverless instances.</p></main>
<script>
const backendBase='';let lastData=null;const tokenInput=document.querySelector('#token');
function auth(){if(!tokenInput.value)throw Error('Enter the deployment PNS_DIAGNOSTICS_TOKEN to access detailed diagnostics.');return {'X-PNS-Diagnostics-Token':tokenInput.value,'Content-Type':'application/json'}}
async function api(path,options={}){const response=await fetch(path,{...options,headers:{...auth(),...(options.headers||{})}});if(!response.ok){const body=await response.json().catch(()=>({}));throw Error(body.detail||`Diagnostics request failed (HTTP ${response.status}).`)}return response.json()}
function render(data){lastData=data;const results=data.results||[];document.querySelector('#overall').textContent=data.status||'NOT TESTED';document.querySelector('#overall').className='status '+(data.status||'NOT_TESTED');document.querySelector('#last-tested').textContent=data.timestamp||data.updated_at?new Date(data.timestamp||data.updated_at).toLocaleString():'—';document.querySelector('#duration').textContent=data.duration_ms==null?'—':`${data.duration_ms} ms`;document.querySelector('#failed').textContent=data.failed_count??results.filter(x=>x.status==='FAIL').length;document.querySelector('#warnings').textContent=data.warning_count??results.filter(x=>x.status==='WARNING').length;document.querySelector('#checks').innerHTML=results.length?results.map(item=>`<details class="check"><summary><span>${escapeHtml(item.name)}</span><span class="status ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></summary><button class="secondary individual" data-test="${escapeHtml(item.name)}">Run this test</button><p>${escapeHtml(item.message||'No additional message.')}</p><div class="technical">${item.target?`<p><b>Target:</b> ${escapeHtml(item.target)}</p>`:''}${item.http_status?`<p><b>HTTP status:</b> ${item.http_status}</p>`:''}<p><b>Duration:</b> ${item.duration_ms??0} ms</p>${item.error_category?`<p><b>Category:</b> ${escapeHtml(item.error_category)}</p>`:''}${item.suggested_action?`<p><b>Suggested action:</b> ${escapeHtml(item.suggested_action)}</p>`:''}${Object.entries(item.details||{}).map(([k,v])=>`<p><b>${escapeHtml(k.replaceAll('_',' '))}:</b> ${escapeHtml(String(v))}</p>`).join('')}</div></details>`).join(''):'<p class="sub">No diagnostic results are available on this serverless instance.</p>';document.querySelectorAll('.individual').forEach(button=>button.onclick=async()=>{button.disabled=true;error('');try{if(button.dataset.test.startsWith('Browser ')){await browserTests(lastData.correlation_id);render(await api(`/api/v1/diagnostics/results?correlation_id=${encodeURIComponent(lastData.correlation_id)}`))}else{render(await api(`/api/v1/diagnostics/run?test_name=${encodeURIComponent(button.dataset.test)}`,{method:'POST'}))}}catch(e){error(e.message)}finally{button.disabled=false}});document.querySelector('#note').textContent=data.serverless_note||'Results reflect actual diagnostic requests.'}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
function error(message){document.querySelector('#error').textContent=message}
async function browserTests(correlation){if(!backendBase){error('BACKEND_PUBLIC_URL is not configured; no browser request was made.');return []}const target=backendBase+'/api/health';async function probe(credentials){const started=performance.now();const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8000);let response=null,category='CORS_ERROR',message='The browser blocked or could not reach the backend. Check CORS, network access and browser console details.';try{response=await fetch(target,{method:'GET',mode:'cors',credentials,headers:{'X-PNS-Diagnostic-Probe':'1'},signal:controller.signal});category=response.ok?null:'HTTP_ERROR';message=response.ok?'Browser request succeeded.':`Backend returned HTTP ${response.status}.`}catch(e){if(e.name==='AbortError'){category='CONNECTION_TIMEOUT';message='The browser request timed out after 8 seconds.'}}finally{clearTimeout(timer)}return{response,category,message,duration_ms:Math.round(performance.now()-started)}}const ordinary=await probe('omit');const credentialed=await probe('include');const sameOrigin=location.origin===new URL(target).origin;const base={correlation_id:correlation,target_url:target,timestamp:new Date().toISOString()};const items=[{...base,test_type:'browser_to_backend',http_status:ordinary.response?.status??null,duration_ms:ordinary.duration_ms,status:ordinary.response?.ok?'PASS':'FAIL',error_category:ordinary.category,error_message:ordinary.message},{...base,test_type:'browser_cors_preflight',http_status:ordinary.response?.status??null,duration_ms:ordinary.duration_ms,status:sameOrigin?'SKIPPED':ordinary.response?'PASS':'FAIL',error_category:sameOrigin?null:ordinary.response?null:ordinary.category,error_message:sameOrigin?'Dashboard and backend are same-origin; browser CORS preflight was not exercised.':ordinary.response?'The browser accepted the cross-origin preflight.':ordinary.message},{...base,test_type:'browser_credentialed_request',http_status:credentialed.response?.status??null,duration_ms:credentialed.duration_ms,credentials_included:true,status:credentialed.response?.ok?'PASS':'FAIL',error_category:credentialed.category,error_message:credentialed.message}];for(const item of items){try{await api('/api/v1/diagnostics/browser-result',{method:'POST',body:JSON.stringify(item)})}catch(e){error(`Browser test completed locally but could not report its result: ${e.message}`)}}return items}
document.querySelector('#run').onclick=async()=>{const button=document.querySelector('#run');button.disabled=true;error('');try{const data=await api('/api/v1/diagnostics/run',{method:'POST'});const browser=await browserTests(data.correlation_id);let latest={results:[]};try{latest=await api(`/api/v1/diagnostics/results?correlation_id=${encodeURIComponent(data.correlation_id)}`)}catch(e){}const returned=latest.results||[];const browserResults=returned.filter(x=>x.name.startsWith('Browser '));const localResults=browser.map(x=>({...x,name:x.test_type.replace(/_/g,' ').replace(/\b\w/g,char=>char.toUpperCase())}));const all=[...(data.results||[]),...(browserResults.length?browserResults:localResults)];render({...data,results:all,failed_count:all.filter(x=>x.status==='FAIL').length,warning_count:all.filter(x=>x.status==='WARNING').length,status:all.some(x=>x.status==='FAIL')?(all.every(x=>x.status==='FAIL')?'UNHEALTHY':'PARTIALLY_HEALTHY'):all.some(x=>x.status==='WARNING')?'PARTIALLY_HEALTHY':'HEALTHY'})}catch(e){error(e.message)}finally{button.disabled=false}};
document.querySelector('#refresh').onclick=async()=>{error('');try{const data=await api('/api/v1/diagnostics/results');const previous=lastData?.results?.filter(x=>!x.name.startsWith('Browser '))||[];const browser=data.results||[];render({...data,results:[...previous,...browser],failed_count:[...previous,...browser].filter(x=>x.status==='FAIL').length,warning_count:[...previous,...browser].filter(x=>x.status==='WARNING').length})}catch(e){error(e.message)}};
document.querySelector('#copy').onclick=async()=>{if(!lastData){error('Run or refresh diagnostics before copying a report.');return}const results=lastData.results||[];const report=['PNS CONNECTIVITY REPORT',`Timestamp: ${new Date().toISOString()}`,...results.map(x=>`${x.name}: ${x.status}${x.target?'\nTarget: '+x.target:''}${x.message?'\nError/Details: '+x.message:''}${x.suggested_action?'\nSuggested action: '+x.suggested_action:''}`),`Overall: ${lastData.status||'NOT_TESTED'}`].join('\n\n');try{await navigator.clipboard.writeText(report);error('Diagnostic report copied to clipboard.')}catch(_){error('Clipboard access was denied by the browser.')}};</script></body></html>"""
