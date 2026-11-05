from __future__ import annotations

import asyncio
import logging
import time

from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core.config import get_settings
from app.core.exceptions import ServiceUnavailableError

logger = logging.getLogger("pns.rate_limit")


class LoginRateLimiter:
    def __init__(self, maximum: int = 5, window_seconds: int = 15 * 60) -> None:
        self.maximum = maximum
        self.window_seconds = window_seconds
        self._attempts: dict[str, tuple[int, float]] = {}
        self._lock = asyncio.Lock()
        self._redis: Redis | None = None
        if get_settings().redis_url:
            self._redis = Redis.from_url(get_settings().redis_url, decode_responses=True)

    async def is_limited(self, key: str) -> bool:
        if self._redis:
            try:
                count = await self._redis.get(self._redis_key(key))
            except RedisError as error:
                logger.exception("Shared login rate-limit store is unavailable")
                raise ServiceUnavailableError(
                    "Login protection is temporarily unavailable."
                ) from error
            return int(count or 0) >= self.maximum
        async with self._lock:
            count, reset_at = self._attempts.get(key, (0, 0.0))
            if reset_at <= time.monotonic():
                self._attempts.pop(key, None)
                return False
            return count >= self.maximum

    async def record_failure(self, key: str) -> None:
        if self._redis:
            try:
                pipeline = self._redis.pipeline(transaction=True)
                pipeline.incr(self._redis_key(key))
                pipeline.expire(self._redis_key(key), self.window_seconds, nx=True)
                await pipeline.execute()
            except RedisError as error:
                logger.exception("Shared login rate-limit store is unavailable")
                raise ServiceUnavailableError(
                    "Login protection is temporarily unavailable."
                ) from error
            return
        async with self._lock:
            count, reset_at = self._attempts.get(key, (0, 0.0))
            if reset_at <= time.monotonic():
                count, reset_at = 0, time.monotonic() + self.window_seconds
            self._attempts[key] = (count + 1, reset_at)

    async def clear(self, key: str) -> None:
        if self._redis:
            try:
                await self._redis.delete(self._redis_key(key))
            except RedisError as error:
                logger.exception("Shared login rate-limit store is unavailable")
                raise ServiceUnavailableError(
                    "Login protection is temporarily unavailable."
                ) from error
            return
        async with self._lock:
            self._attempts.pop(key, None)

    async def health_check(self) -> bool | None:
        if self._redis is None:
            return None
        return bool(await self._redis.ping())

    def _redis_key(self, key: str) -> str:
        return f"pns:login-rate-limit:{key}"

    async def close(self) -> None:
        if self._redis:
            await self._redis.aclose()


login_rate_limiter = LoginRateLimiter()
