from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from functools import lru_cache

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
import logging

from app.core.config import database_url_for_asyncpg, get_settings
from app.core.exceptions import ServiceUnavailableError

logger = logging.getLogger("pns.database")


@lru_cache
def get_engine() -> AsyncEngine | None:
    raw_url = get_settings().database_url
    if not raw_url:
        return None
    return create_async_engine(
        database_url_for_asyncpg(raw_url),
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
        pool_recycle=1800,
        connect_args={"statement_cache_size": 0},
    )


@lru_cache
def get_session_factory() -> async_sessionmaker[AsyncSession] | None:
    engine = get_engine()
    return async_sessionmaker(engine, expire_on_commit=False) if engine else None


async def get_db_session() -> AsyncIterator[AsyncSession]:
    factory = get_session_factory()
    if factory is None:
        raise ServiceUnavailableError("The PostgreSQL connection is not configured.")
    try:
        async with factory() as session:
            yield session
    except Exception as error:
        logger.exception("PostgreSQL operation failed while serving a database request.")
        raise ServiceUnavailableError(
            "The PostgreSQL database is unavailable. Check the backend database "
            "connection and network access."
        ) from error


async def close_database() -> None:
    engine = get_engine()
    if engine is not None:
        await engine.dispose()
