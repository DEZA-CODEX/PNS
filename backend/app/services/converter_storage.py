from __future__ import annotations

import asyncio
import base64
import binascii
import json
import logging
import time
from collections.abc import Awaitable, Callable
from functools import lru_cache
from typing import Any, TypeVar

import httpx
import redis
from upstash_redis import AsyncRedis
from upstash_redis.errors import UpstashError

from app.core.cache import get_redis
from app.core.config import get_settings
from app.core.exceptions import APIError

logger = logging.getLogger("pns.converter_storage")
T = TypeVar("T")


class ConverterStorageError(APIError):
    def __init__(self, message: str = "Temporary conversion storage is unavailable.") -> None:
        super().__init__("temporary_storage_unavailable", message, 503)


def _key(kind: str, batch_id: str, file_id: str | None = None) -> str:
    prefix = get_settings().redis_key_prefix
    suffix = f"converter:batch:{batch_id}:{kind}"
    if file_id is not None:
        suffix += f":{file_id}"
    return f"{prefix}{suffix}"


def _active_key() -> str:
    return f"{get_settings().redis_key_prefix}converter:active-batches"


def _decode(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8")
    if isinstance(value, str):
        return value
    raise ConverterStorageError("Temporary conversion storage returned invalid data.")


def _encode_bytes(value: bytes) -> str:
    return base64.b64encode(value).decode("ascii")


def _decode_bytes(value: Any) -> bytes:
    try:
        raw = value.encode("ascii") if isinstance(value, str) else value
        if not isinstance(raw, bytes):
            raise TypeError
        return base64.b64decode(raw, validate=True)
    except (binascii.Error, UnicodeEncodeError, TypeError) as error:
        raise ConverterStorageError("Temporary conversion binary data is invalid.") from error


def _json(value: str, kind: str) -> dict[str, Any]:
    try:
        decoded = json.loads(value)
    except (TypeError, json.JSONDecodeError) as error:
        raise ConverterStorageError(f"Temporary conversion {kind} is invalid.") from error
    if not isinstance(decoded, dict):
        raise ConverterStorageError(f"Temporary conversion {kind} is invalid.")
    return decoded


async def _redis_call(
    operation: str,
    callback: Callable[[AsyncRedis], Awaitable[T]],
) -> T:
    client = get_redis()
    if client is None:
        settings = get_settings()
        if not settings.redis_enabled:
            message = "Temporary conversion storage is disabled. Set REDIS_ENABLED=true."
        elif not settings.upstash_redis_rest_url:
            message = (
                "Temporary conversion storage is missing its REST URL. Set "
                "UPSTASH_REDIS_REST_URL or REDIS_KV_REST_API_URL."
            )
        else:
            message = (
                "Temporary conversion storage is missing its writable REST token. Set "
                "UPSTASH_REDIS_REST_TOKEN or REDIS_KV_REST_API_TOKEN."
            )
        raise ConverterStorageError(message)
    try:
        return await asyncio.wait_for(
            callback(client),
            timeout=get_settings().redis_timeout_seconds,
        )
    except (UpstashError, httpx.HTTPError, OSError, TimeoutError) as error:
        logger.warning("Converter Redis %s failed.", operation, exc_info=True)
        raise ConverterStorageError() from error


async def _set(key: str, value: str | bytes, *, ttl: int | None = None) -> None:
    result = await _redis_call(
        "write",
        lambda client: client.set(
            key,
            value,
            ex=ttl or get_settings().converter_batch_ttl_seconds,
        ),
    )
    if result not in {"OK", True}:
        raise ConverterStorageError("Temporary conversion storage rejected the batch.")


async def _get(key: str) -> str | bytes | None:
    value = await _redis_call("read", lambda client: client.get(key))
    return value


async def _delete(*keys: str) -> None:
    if keys:
        await _redis_call("cleanup", lambda client: client.delete(*keys))


async def create_batch(batch_id: str, metadata: dict[str, Any]) -> None:
    active_key = _active_key()
    added = await _redis_call("reserve active batch", lambda client: client.sadd(active_key, batch_id))
    if not added:
        raise ConverterStorageError("This conversion batch already exists.")
    try:
        active_count = int(await _redis_call("count active batches", lambda client: client.scard(active_key)))
        if active_count > get_settings().converter_max_active_batches:
            await _redis_call("release active batch", lambda client: client.srem(active_key, batch_id))
            raise ConverterStorageError(
                "The converter is temporarily busy. Please try again later."
            )
        metadata["expires_at"] = time.time() + get_settings().converter_batch_ttl_seconds
        await _set(_key("metadata", batch_id), json.dumps(metadata, separators=(",", ":")))
    except Exception:
        try:
            await _redis_call("release active batch", lambda client: client.srem(active_key, batch_id))
        except ConverterStorageError:
            logger.exception("Could not release active converter batch %s.", batch_id)
        raise


async def create_file(batch_id: str, file_id: str, metadata: dict[str, Any]) -> None:
    batch = await get_batch(batch_id)
    if batch is None:
        raise ConverterStorageError("The conversion batch has expired.")
    await _set(
        _key("metadata", batch_id, file_id),
        json.dumps(metadata, separators=(",", ":")),
        ttl=_remaining_ttl(batch),
    )


async def save_original(batch_id: str, file_id: str, data: bytes) -> None:
    batch = await get_batch(batch_id)
    if batch is None:
        raise ConverterStorageError("The conversion batch has expired.")
    await _set(
        _key("original", batch_id, file_id),
        _encode_bytes(data),
        ttl=_remaining_ttl(batch),
    )


async def get_batch(batch_id: str) -> dict[str, Any] | None:
    value = await _get(_key("metadata", batch_id))
    return None if value is None else _json(_decode(value), "batch")


async def update_batch(batch_id: str, updates: dict[str, Any]) -> dict[str, Any]:
    metadata = await get_batch(batch_id)
    if metadata is None:
        raise ConverterStorageError("The conversion batch has expired.")
    metadata.update(updates)
    await _set(
        _key("metadata", batch_id),
        json.dumps(metadata, separators=(",", ":")),
        ttl=_remaining_ttl(metadata),
    )
    return metadata


async def save_file(
    batch_id: str,
    file_id: str,
    metadata: dict[str, Any],
    data: bytes,
) -> None:
    batch = await get_batch(batch_id)
    if batch is None:
        raise ConverterStorageError("The conversion batch has expired.")
    await _set(
        _key("result", batch_id, file_id),
        _encode_bytes(data),
        ttl=_remaining_ttl(batch),
    )
    await _set(
        _key("metadata", batch_id, file_id),
        json.dumps(metadata, separators=(",", ":")),
        ttl=_remaining_ttl(batch),
    )


async def get_file(batch_id: str, file_id: str) -> dict[str, Any] | None:
    value = await _get(_key("metadata", batch_id, file_id))
    return None if value is None else _json(_decode(value), "file")


async def get_file_data(batch_id: str, file_id: str) -> bytes | None:
    value = await _get(_key("result", batch_id, file_id))
    if value is None:
        return None
    return _decode_bytes(value)


async def update_file(batch_id: str, file_id: str, updates: dict[str, Any]) -> dict[str, Any]:
    metadata = await get_file(batch_id, file_id)
    if metadata is None:
        raise ConverterStorageError("The conversion file has expired.")
    batch = await get_batch(batch_id)
    if batch is None:
        raise ConverterStorageError("The conversion batch has expired.")
    metadata.update(updates)
    await _set(
        _key("metadata", batch_id, file_id),
        json.dumps(metadata, separators=(",", ":")),
        ttl=_remaining_ttl(batch),
    )
    return metadata


async def cancel_batch(batch_id: str) -> dict[str, Any]:
    batch = await get_batch(batch_id)
    if batch is None:
        raise ConverterStorageError("The conversion batch has expired.")
    batch["status"] = "cancelled"
    batch["current_index"] = None
    await _set(
        _key("metadata", batch_id),
        json.dumps(batch, separators=(",", ":")),
        ttl=_remaining_ttl(batch),
    )
    keys: list[str] = []
    for file_id in batch.get("file_ids", []):
        if isinstance(file_id, str):
            keys.extend(
                (
                    _key("original", batch_id, file_id),
                    _key("result", batch_id, file_id),
                )
            )
    await _delete(*keys)
    await _redis_call("release active batch", lambda client: client.srem(_active_key(), batch_id))
    return batch


async def delete_batch(batch_id: str) -> None:
    batch = await get_batch(batch_id)
    if batch is None:
        return
    keys = [_key("metadata", batch_id)]
    for file_id in batch.get("file_ids", []):
        if isinstance(file_id, str):
            keys.extend(
                (
                    _key("metadata", batch_id, file_id),
                    _key("original", batch_id, file_id),
                    _key("result", batch_id, file_id),
                )
            )
    await _delete(*keys)
    await _redis_call("release active batch", lambda client: client.srem(_active_key(), batch_id))


@lru_cache
def _sync_client() -> redis.Redis:
    url = get_settings().redis_url
    if not url:
        raise ConverterStorageError(
            "CELERY_BROKER_URL is required for converter worker storage."
        )
    return redis.Redis.from_url(
        url,
        decode_responses=False,
        socket_connect_timeout=5,
        socket_timeout=10,
        health_check_interval=30,
    )


def _sync_get(key: str) -> bytes | None:
    try:
        return _sync_client().get(key)
    except (redis.RedisError, OSError, TimeoutError) as error:
        raise ConverterStorageError() from error


def _sync_set(key: str, value: str | bytes, *, ttl: int | None = None) -> None:
    try:
        if not _sync_client().set(
            key,
            value,
            ex=ttl or get_settings().converter_batch_ttl_seconds,
        ):
            raise ConverterStorageError("Temporary conversion storage rejected the update.")
    except (redis.RedisError, OSError, TimeoutError) as error:
        raise ConverterStorageError() from error


def _sync_delete(*keys: str) -> None:
    try:
        if keys:
            _sync_client().delete(*keys)
    except (redis.RedisError, OSError, TimeoutError) as error:
        raise ConverterStorageError() from error


def _sync_get_json(key: str, kind: str) -> dict[str, Any] | None:
    value = _sync_get(key)
    return None if value is None else _json(_decode(value), kind)


def _remaining_ttl(metadata: dict[str, Any]) -> int:
    expires_at = metadata.get("expires_at")
    if not isinstance(expires_at, (int, float)):
        return get_settings().converter_batch_ttl_seconds
    return max(1, int(expires_at - time.time()))


def sync_get_batch(batch_id: str) -> dict[str, Any] | None:
    return _sync_get_json(_key("metadata", batch_id), "batch")


def sync_update_batch(batch_id: str, updates: dict[str, Any]) -> dict[str, Any]:
    batch = sync_get_batch(batch_id)
    if batch is None:
        raise ConverterStorageError("The conversion batch has expired.")
    batch.update(updates)
    _sync_set(
        _key("metadata", batch_id),
        json.dumps(batch, separators=(",", ":")),
        ttl=_remaining_ttl(batch),
    )
    return batch


def sync_get_file(batch_id: str, file_id: str) -> dict[str, Any] | None:
    return _sync_get_json(_key("metadata", batch_id, file_id), "file")


def sync_get_original(batch_id: str, file_id: str) -> bytes | None:
    value = _sync_get(_key("original", batch_id, file_id))
    return None if value is None else _decode_bytes(value)


def sync_save_result(
    batch_id: str,
    file_id: str,
    metadata: dict[str, Any],
    data: bytes,
) -> None:
    batch = sync_get_batch(batch_id)
    if batch is None:
        raise ConverterStorageError("The conversion batch has expired.")
    _sync_set(
        _key("result", batch_id, file_id),
        _encode_bytes(data),
        ttl=_remaining_ttl(batch),
    )
    _sync_set(
        _key("metadata", batch_id, file_id),
        json.dumps(metadata, separators=(",", ":")),
        ttl=_remaining_ttl(batch),
    )


def sync_update_file(
    batch_id: str,
    file_id: str,
    updates: dict[str, Any],
) -> dict[str, Any]:
    metadata = sync_get_file(batch_id, file_id)
    if metadata is None:
        raise ConverterStorageError("The conversion file has expired.")
    batch = sync_get_batch(batch_id)
    if batch is None:
        raise ConverterStorageError("The conversion batch has expired.")
    metadata.update(updates)
    _sync_set(
        _key("metadata", batch_id, file_id),
        json.dumps(metadata, separators=(",", ":")),
        ttl=_remaining_ttl(batch),
    )
    return metadata


def sync_release_active_batch(batch_id: str) -> None:
    try:
        _sync_client().srem(_active_key(), batch_id)
    except (redis.RedisError, OSError, TimeoutError) as error:
        raise ConverterStorageError() from error


def sync_delete_batch(batch_id: str) -> None:
    batch = sync_get_batch(batch_id)
    if batch is None:
        return
    keys = [_key("metadata", batch_id)]
    for file_id in batch.get("file_ids", []):
        if isinstance(file_id, str):
            keys.extend(
                (
                    _key("metadata", batch_id, file_id),
                    _key("original", batch_id, file_id),
                    _key("result", batch_id, file_id),
                )
            )
    _sync_delete(*keys)
    sync_release_active_batch(batch_id)


def sync_cleanup_orphans() -> int:
    client = _sync_client()
    deleted = 0
    prefix = f"{get_settings().redis_key_prefix}converter:batch:"
    try:
        active_batches = client.smembers(_active_key())
        for active_batch in active_batches:
            batch_id = active_batch.decode() if isinstance(active_batch, bytes) else str(active_batch)
            if not client.exists(_key("metadata", batch_id)):
                client.srem(_active_key(), batch_id)
        for key in client.scan_iter(match=f"{prefix}*", count=100):
            key_text = key.decode() if isinstance(key, bytes) else str(key)
            marker = f"{prefix}"
            if not key_text.startswith(marker):
                continue
            batch_id = key_text[len(marker):].split(":", 1)[0]
            if not batch_id:
                continue
            if client.exists(_key("metadata", batch_id)):
                continue
            deleted += int(client.delete(key))
    except (redis.RedisError, OSError, TimeoutError) as error:
        raise ConverterStorageError() from error
    return deleted
