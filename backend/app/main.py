from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from sqlalchemy import text
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.diagnostics import DIAGNOSTICS_DASHBOARD
from app.api.diagnostics import router as diagnostics_router
from app.api.v1.router import router as v1_router
from app.core.config import get_settings
from app.core.database import close_database, get_engine
from app.core.exceptions import APIError
from app.core.rate_limit import login_rate_limiter
from app.core.responses import JSONResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("pns.backend")
settings = get_settings()
if not settings.allowed_hosts:
    raise RuntimeError(
        "PNS_ALLOWED_HOSTS must list the backend hostnames accepted by this deployment."
    )


@asynccontextmanager
async def lifespan(_: FastAPI):
    engine = get_engine()
    if engine is None:
        logger.warning("DATABASE_URL is not configured; database routes will return 503.")
    else:
        try:
            async with engine.connect() as connection:
                await connection.execute(text("SELECT 1"))
        except Exception:
            logger.exception(
                "PostgreSQL is unreachable during startup. The API will start in "
                "degraded mode; database routes will return 503. Verify the direct "
                "Supabase hostname, TLS settings, and IPv6/IPv4 compatibility for the "
                "Vercel deployment environment."
            )
        else:
            logger.info("PostgreSQL connection pool is ready.")
    yield
    await login_rate_limiter.close()
    await close_database()


fastapi_app = FastAPI(
    title="PNS Hotel API",
    version="1.0.0",
    docs_url="/docs" if settings.api_docs_enabled else None,
    redoc_url=None,
    openapi_url="/openapi.json" if settings.api_docs_enabled else None,
    lifespan=lifespan,
)
fastapi_app.add_middleware(
    TrustedHostMiddleware, allowed_hosts=list(settings.allowed_hosts)
)


@fastapi_app.middleware("http")
async def request_context(request: Request, call_next):
    request_id_value = request.headers.get("x-request-id", "").strip() or str(uuid4())
    request.state.request_id = request_id_value
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id_value
    return response


@fastapi_app.exception_handler(APIError)
async def handle_api_error(request: Request, error: APIError) -> JSONResponse:
    request_id_value = getattr(request.state, "request_id", None)
    content = {
        "success": False,
        "error": {"code": error.code, "message": str(error)},
    }
    if request.url.path.startswith("/api/v1/admin/"):
        content["requestId"] = request_id_value
    return JSONResponse(content, status_code=error.status_code)


@fastapi_app.exception_handler(RequestValidationError)
async def handle_validation_error(
    request: Request, error: RequestValidationError
) -> JSONResponse:
    logger.info("Request validation failed for %s", request.url.path)
    request_id_value = getattr(request.state, "request_id", None)
    content = {
        "success": False,
        "error": {"code": "validation", "message": "The request payload is invalid."},
    }
    if request.url.path.startswith("/api/v1/admin/"):
        content["requestId"] = request_id_value
    return JSONResponse(content, status_code=400)


fastapi_app.include_router(v1_router, prefix="/api/v1")
fastapi_app.include_router(diagnostics_router, prefix="/api/v1")


@fastapi_app.get("/health/live", include_in_schema=False)
async def live_health():
    return {"status": "ok"}


@fastapi_app.get("/api/health")
async def api_health():
    return {
        "status": "ok",
        "application": fastapi_app.title,
        "environment": settings.app_env,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "api": "available",
    }


@fastapi_app.get("/test", response_class=HTMLResponse, include_in_schema=False)
async def diagnostics_dashboard():
    backend_url = json.dumps(settings.backend_public_url)
    page = DIAGNOSTICS_DASHBOARD.replace(
        "const backendBase='';", f"const backendBase={backend_url};"
    )
    return HTMLResponse(page)


@fastapi_app.get("/api/health/ready")
async def api_ready_health():
    database_ready = False
    try:
        engine = get_engine()
        if engine is not None:
            async with asyncio.timeout(settings.diagnostics_timeout_seconds):
                async with engine.connect() as connection:
                    await connection.execute(text("SELECT 1"))
            database_ready = True
    except Exception:
        logger.warning("Readiness database check failed.")

    try:
        async with asyncio.timeout(settings.diagnostics_timeout_seconds):
            redis_ready = await login_rate_limiter.health_check()
    except Exception:
        logger.warning("Readiness Redis check failed.")
        redis_ready = False
    if settings.redis_url and redis_ready is None:
        redis_ready = False
    ready = database_ready and redis_ready is not False
    return JSONResponse(
        {
            "status": "ready" if ready else "not_ready",
            "database": (
                "ok"
                if database_ready
                else "unavailable"
                if settings.database_url
                else "not_configured"
            ),
            "redis": "ok" if redis_ready else ("unavailable" if redis_ready is False else "not_configured"),
        },
        status_code=200 if ready else 503,
    )


@fastapi_app.get("/health/ready", include_in_schema=False)
async def ready_health():
    return await api_ready_health()


app = CORSMiddleware(
    app=fastapi_app,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Content-Type",
        "Authorization",
        "X-Request-ID",
        "X-PNS-Diagnostics-Token",
        "X-PNS-Diagnostic-Probe",
    ],
)
