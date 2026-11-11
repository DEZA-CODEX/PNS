from __future__ import annotations

import asyncio

import httpx
import pytest

from app.celery_app import celery_app, validate_broker_url
from app.api.v1.admin_jobs import _job_response
from app.core import cache
from app.core.config import Settings
from app.services.worker_database import _sync_database_url
from app.tasks.jobs import _invalidate_cached_image_keys


def test_celery_uses_json_and_separate_maintenance_queue() -> None:
    assert celery_app.conf.accept_content == ["json"]
    assert celery_app.conf.task_serializer == "json"
    assert celery_app.conf.task_acks_late is True
    assert celery_app.conf.worker_prefetch_multiplier == 1
    assert celery_app.conf.task_default_queue == "pns-default"
    assert celery_app.conf.broker_transport_options["global_keyprefix"] == "pns:celery:"
    assert "pns-maintenance" in {queue.name for queue in celery_app.conf.task_queues}
    assert len(celery_app.conf.beat_schedule) == 2


def test_worker_database_url_preserves_tls_query_parameters() -> None:
    assert (
        _sync_database_url(
            "postgresql://worker:secret@db.example.test:5432/postgres?sslmode=require"
        )
        == "postgresql+psycopg://worker:secret@db.example.test:5432/postgres?sslmode=require"
    )
    assert (
        _sync_database_url(
            "postgresql+asyncpg://worker:secret@db.example.test/postgres?ssl=require"
        )
        == "postgresql+psycopg://worker:secret@db.example.test/postgres?ssl=require"
    )


def test_worker_database_url_rejects_non_postgres_schemes() -> None:
    with pytest.raises(ValueError, match="PostgreSQL"):
        _sync_database_url("sqlite:///not-a-production-database.db")


def test_production_broker_requires_a_tls_redis_protocol_url() -> None:
    with pytest.raises(ValueError, match="Redis protocol"):
        validate_broker_url("https://example.upstash.io", "production")
    with pytest.raises(ValueError, match="TLS"):
        validate_broker_url("redis://default:secret@upstash.example.test:6379/0", "development")
    with pytest.raises(ValueError, match="TLS"):
        validate_broker_url("redis://default:secret@localhost:6379/0", "production")
    validate_broker_url("redis://localhost:6379/0", "development")
    validate_broker_url("rediss://default:secret@localhost:6379/0", "production")


def test_job_response_serializes_only_public_status_fields() -> None:
    job = _job_response(
        {
            "id": "job-id",
            "task_id": "task-id",
            "job_type": "cache.invalidate_images",
            "queue_name": "pns-maintenance",
            "status": "queued",
            "progress": 0,
            "result_summary": None,
            "error_message": None,
            "retry_count": 0,
            "created_at": "2026-11-11T00:00:00+00:00",
            "updated_at": "2026-11-11T00:00:00+00:00",
            "started_at": None,
            "completed_at": None,
            "payload": {"secret": "not-returned"},
        }
    )
    assert job["id"] == "job-id"
    assert "payload" not in job


def test_image_cache_invalidation_is_targeted(monkeypatch) -> None:
    patterns: list[str] = []

    async def record(pattern: str) -> int:
        patterns.append(pattern)
        return 0

    monkeypatch.setattr(cache, "invalidate_pattern", record)
    asyncio.run(cache.invalidate_image_caches("room", "vajra"))
    assert patterns == [
        "images:homepage*",
        "images:rooms*",
        "images:room:vajra:*",
    ]


def test_worker_removes_only_namespaced_image_cache_keys() -> None:
    class FakeRedis:
        def __init__(self) -> None:
            self.patterns: list[str] = []
            self.deleted: list[str] = []

        def scan_iter(self, *, match: str, count: int):
            self.patterns.append(match)
            return iter([match.replace("*", "sample")])

        def delete(self, *keys: str) -> int:
            self.deleted.extend(keys)
            return len(keys)

    client = FakeRedis()
    deleted = _invalidate_cached_image_keys(client, "pns:backend:")
    assert deleted == 6
    assert len(client.patterns) == 6
    assert all(pattern.startswith("pns:backend:images:") for pattern in client.patterns)


def test_cache_timeout_falls_back_without_failing_the_request(monkeypatch) -> None:
    monkeypatch.setattr(cache, "get_redis", lambda: object())
    monkeypatch.setattr(
        cache,
        "get_settings",
        lambda: Settings(_env_file=None, redis_timeout_seconds=0.01),
    )

    async def slow_read(_client):
        await asyncio.sleep(1)

    result = asyncio.run(cache._redis_call("read", slow_read, "database-fallback"))
    assert result == "database-fallback"


def test_cache_http_transport_error_uses_fallback(monkeypatch) -> None:
    monkeypatch.setattr(cache, "get_redis", lambda: object())

    async def failed_read(_client):
        raise httpx.ConnectError(
            "connection unavailable",
            request=httpx.Request("GET", "https://redis.example.test"),
        )

    assert asyncio.run(cache._redis_call("read", failed_read, None)) is None
