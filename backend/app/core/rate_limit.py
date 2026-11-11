from __future__ import annotations

import asyncio
import logging
import time

from upstash_redis.errors import UpstashError

from app.core.cache import close_redis, delete, get, get_redis
from app.core.config import get_settings
from app.core.exceptions import ServiceUnavailableError

logger = logging.getLogger("pns.rate_limit")


class LoginRateLimiter:
    def __init__(self, maximum: int = 5, window_seconds: int = 15 * 60) -> None:
        self.maximum = maximum
        self.window_seconds = window_seconds
        self._attempts: dict[str, tuple[int, float]] = {}
        self._lock = asyncio.Lock()
        settings = get_settings()
        self._redis_enabled = bool(
            settings.redis_enabled
            and settings.upstash_redis_rest_url
            and settings.upstash_redis_rest_token
        )

    async def is_limited(self, key: str) -> bool:
        if self._redis_enabled:
            try:
                count = await get(self._redis_key(key))
            except (UpstashError, OSError, TimeoutError) as error:
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
        if self._redis_enabled:
            try:
                redis = get_redis()
                if redis is None:
                    return
                await redis.incr(self._redis_key(key))
                await redis.expire(self._redis_key(key), self.window_seconds, nx=True)
            except (UpstashError, OSError, TimeoutError) as error:
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
        if self._redis_enabled:
            try:
                await delete(self._redis_key(key))
            except (UpstashError, OSError, TimeoutError) as error:
                logger.exception("Shared login rate-limit store is unavailable")
                raise ServiceUnavailableError(
                    "Login protection is temporarily unavailable."
                ) from error
            return
        async with self._lock:
            self._attempts.pop(key, None)

    async def health_check(self) -> bool | None:
        if not self._redis_enabled:
            return None
        redis = get_redis()
        try:
            return bool(await redis.ping()) if redis is not None else None
        except (UpstashError, OSError, TimeoutError):
            logger.warning("Shared login rate-limit health check failed.", exc_info=True)
            return False

    def _redis_key(self, key: str) -> str:
        return f"pns:login-rate-limit:{key}"

    async def close(self) -> None:
        await close_redis()


login_rate_limiter = LoginRateLimiter()
