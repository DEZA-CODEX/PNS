from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Awaitable, Callable, TypeVar

import httpx
from upstash_redis import AsyncRedis
from upstash_redis.errors import UpstashError

from app.core.config import get_settings

logger = logging.getLogger("pns.cache")

T = TypeVar("T")

IMAGE_CACHE_PATTERNS = (
    "images:homepage*",
    "images:rooms*",
    "images:dining*",
    "images:about*",
    "images:room:*",
    "images:dining:*",
)

_redis: AsyncRedis | None = None


def _key(key: str) -> str:
    prefix = get_settings().redis_key_prefix
    return key if key.startswith(prefix) else f"{prefix}{key}"


def get_redis() -> AsyncRedis | None:
    global _redis
    settings = get_settings()
    if not settings.redis_enabled or not settings.upstash_redis_rest_url:
        return None
    if not settings.upstash_redis_rest_token:
        logger.warning("Redis is enabled but UPSTASH_REDIS_REST_TOKEN is not configured.")
        return None
    if _redis is None:
        _redis = AsyncRedis(
            url=settings.upstash_redis_rest_url,
            token=settings.upstash_redis_rest_token,
            rest_retries=1,
            rest_retry_interval=0.2,
        )
    return _redis


async def _redis_call(
    operation: str,
    callback: Callable[[AsyncRedis], Awaitable[T]],
    fallback: T,
) -> T:
    client = get_redis()
    if client is None:
        return fallback
    try:
        return await asyncio.wait_for(
            callback(client),
            timeout=get_settings().redis_timeout_seconds,
        )
    except (UpstashError, httpx.HTTPError, OSError, TimeoutError):
        logger.warning("Redis %s failed; continuing without cache.", operation, exc_info=True)
        return fallback


async def get(key: str) -> Any:
    return await _redis_call("read", lambda client: client.get(_key(key)), None)


async def set(
    key: str,
    value: str | int | float | bool,
    ttl_seconds: int | None = None,
) -> bool:
    ttl = ttl_seconds or get_settings().redis_default_ttl
    result = await _redis_call(
        "write",
        lambda client: client.set(_key(key), value, ex=ttl),
        None,
    )
    return result == "OK"


async def delete(*keys: str) -> bool:
    if not keys:
        return True
    result = await _redis_call(
        "delete",
        lambda client: client.delete(*(_key(key) for key in keys)),
        0,
    )
    return bool(result)


async def invalidate_pattern(pattern: str) -> int:
    async def invalidate(client: AsyncRedis) -> int:
        cursor = 0
        deleted = 0
        while True:
            cursor, keys = await client.scan(cursor, match=_key(pattern), count=100)
            if keys:
                deleted += int(await client.delete(*keys))
            if cursor == 0:
                return deleted

    return await _redis_call("pattern invalidation", invalidate, 0)


async def get_json(key: str) -> dict[str, Any] | None:
    value = await get(key)
    if value is None:
        return None
    try:
        decoded = json.loads(value) if isinstance(value, str) else value
    except (json.JSONDecodeError, TypeError):
        logger.warning("Redis cache value for %s is invalid JSON.", _key(key))
        return None
    return decoded if isinstance(decoded, dict) else None


async def set_json(
    key: str,
    value: dict[str, Any],
    ttl_seconds: int | None = None,
) -> None:
    try:
        encoded = json.dumps(value, separators=(",", ":"))
    except (TypeError, ValueError):
        logger.warning("Redis cache value for %s could not be serialized.", _key(key))
        return
    await set(key, encoded, ttl_seconds)


async def invalidate_image_caches(
    collection: str | None = None,
    category: str | None = None,
) -> None:
    if collection is None:
        patterns = IMAGE_CACHE_PATTERNS
    elif collection == "room":
        patterns = (
            "images:homepage*",
            "images:rooms*",
            f"images:room:{category}:*" if category else "images:room:*",
        )
    elif collection == "dining":
        patterns = (
            "images:homepage*",
            "images:dining*",
            "images:about*",
            f"images:dining:{category}:*" if category else "images:dining:*",
        )
    else:
        raise ValueError(f"Unsupported image cache collection: {collection}")
    for pattern in patterns:
        await invalidate_pattern(pattern)


async def close_redis() -> None:
    global _redis
    if _redis is not None:
        await _redis.close()
        _redis = None
