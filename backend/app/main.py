from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.v1.router import router as v1_router
from app.core.config import get_settings
from app.core.database import close_database, get_engine
from app.core.exceptions import APIError
from app.core.rate_limit import login_rate_limiter
from app.core.responses import JSONResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("pns.backend")
settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    engine = get_engine()
    if engine is None:
        logger.warning("DATABASE_URL is not configured; database routes will return 503.")
    else:
        try:
            async with engine.connect() as connection:
                await connection.execute(text("SELECT 1"))
        except DBAPIError:
            logger.exception(
                "PostgreSQL is unreachable during startup. The API will start in "
                "degraded mode; database routes will return 503. If this environment "
                "does not support IPv6, use the Supabase session pooler connection "
                "string from the project dashboard."
            )
        else:
            logger.info("PostgreSQL connection pool is ready.")
    yield
    await login_rate_limiter.close()
    await close_database()


app = FastAPI(
    title="PNS Hotel API",
    version="1.0.0",
    docs_url="/docs" if settings.api_docs_enabled else None,
    redoc_url=None,
    openapi_url="/openapi.json" if settings.api_docs_enabled else None,
    lifespan=lifespan,
)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(settings.allowed_hosts))
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Request-ID"],
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id_value = request.headers.get("x-request-id", "").strip() or str(uuid4())
    request.state.request_id = request_id_value
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id_value
    return response


@app.exception_handler(APIError)
async def handle_api_error(request: Request, error: APIError) -> JSONResponse:
    request_id_value = getattr(request.state, "request_id", None)
    content = {
        "success": False,
        "error": {"code": error.code, "message": str(error)},
    }
    if request.url.path.startswith("/api/v1/admin/"):
        content["requestId"] = request_id_value
    return JSONResponse(content, status_code=error.status_code)


@app.exception_handler(RequestValidationError)
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


app.include_router(v1_router, prefix="/api/v1")


@app.get("/health/live", include_in_schema=False)
async def live_health():
    return {"status": "ok"}


@app.get("/health/ready", include_in_schema=False)
async def ready_health():
    engine = get_engine()
    if engine is None:
        return JSONResponse({"status": "not_ready", "database": "not_configured"}, status_code=503)
    try:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
    except Exception:
        logger.exception("Readiness database check failed")
        return JSONResponse({"status": "not_ready", "database": "unavailable"}, status_code=503)
    return {"status": "ready", "database": "ok"}
