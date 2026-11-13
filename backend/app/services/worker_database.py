from __future__ import annotations

from functools import lru_cache
from urllib.parse import urlsplit, urlunsplit

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

from app.core.config import get_settings


def _sync_database_url(url: str) -> str:
    parts = urlsplit(url)
    if parts.scheme in {"postgres", "postgresql"}:
        scheme = "postgresql+psycopg"
    elif parts.scheme == "postgresql+asyncpg":
        scheme = "postgresql+psycopg"
    else:
        raise ValueError("DATABASE_URL must be a PostgreSQL connection URL.")
    return urlunsplit(parts._replace(scheme=scheme))


@lru_cache
def get_worker_engine() -> Engine:
    settings = get_settings()
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is required for Celery database tasks.")
    return create_engine(
        _sync_database_url(settings.database_url),
        pool_pre_ping=True,
        pool_size=1,
        max_overflow=0,
        pool_recycle=settings.database_pool_recycle_seconds,
        pool_timeout=settings.database_pool_timeout_seconds,
        connect_args={"connect_timeout": 5, "prepare_threshold": None},
    )
