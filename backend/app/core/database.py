from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from functools import lru_cache

from fastapi import Request
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.exc import DBAPIError, IntegrityError, SQLAlchemyError

from app.core.config import database_url_for_asyncpg, get_settings
from app.core.exceptions import ServiceUnavailableError

logger = logging.getLogger("pns.database")


def _is_connectivity_error(error: SQLAlchemyError) -> bool:
    if isinstance(error, DBAPIError) and error.connection_invalidated:
        return True
    original = getattr(error, "orig", None)
    sqlstate = getattr(original, "sqlstate", None) or getattr(original, "pgcode", None)
    if isinstance(sqlstate, str) and sqlstate.startswith("08"):
        return True
    if isinstance(original, (OSError, ConnectionError, TimeoutError)):
        return True
    original_type = type(original).__name__.lower()
    original_module = type(original).__module__.lower()
    return "connection" in original_type and "asyncpg" in original_module


@lru_cache
def get_engine() -> AsyncEngine | None:
    settings = get_settings()
    raw_url = settings.database_url
    if not raw_url:
        return None
    return create_async_engine(
        database_url_for_asyncpg(raw_url),
        pool_pre_ping=True,
        pool_size=settings.database_pool_size,
        max_overflow=settings.database_max_overflow,
        pool_recycle=settings.database_pool_recycle_seconds,
        pool_timeout=settings.database_pool_timeout_seconds,
        connect_args={"statement_cache_size": 0},
    )


@lru_cache
def get_session_factory() -> async_sessionmaker[AsyncSession] | None:
    engine = get_engine()
    return async_sessionmaker(engine, expire_on_commit=False) if engine else None


async def get_db_session(request: Request) -> AsyncIterator[AsyncSession]:
    factory = get_session_factory()
    if factory is None:
        raise ServiceUnavailableError("The PostgreSQL connection is not configured.")
    async with factory() as session:
        try:
            yield session
        except IntegrityError:
            raise
        except SQLAlchemyError as error:
            if not _is_connectivity_error(error):
                raise
            logger.exception(
                "Database connection failed for %s %s (request_id=%s).",
                request.method,
                request.url.path,
                getattr(request.state, "request_id", "unknown"),
            )
            raise ServiceUnavailableError(
                "The requested service is temporarily unavailable. Please try again later."
            ) from error


async def close_database() -> None:
    engine = get_engine()
    if engine is not None:
        await engine.dispose()
