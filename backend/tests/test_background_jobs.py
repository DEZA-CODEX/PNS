from __future__ import annotations

import asyncio
import json
import logging
import ssl
from contextlib import contextmanager
from types import SimpleNamespace

import httpx
import pytest
from fastapi import Request

from app.celery_app import broker_ssl_options, celery_app, validate_broker_url
from app.api.v1.admin_jobs import CreateJobRequest, _job_response, create_job
from app.core import cache
from app.core.admin_types import AdminContext
from app.core.config import Settings
from app.services import worker_database
from app.services.worker_database import _sync_database_url
from app.tasks.jobs import (
    _invalidate_cached_image_keys,
    celery_connectivity_test,
    dispatch_pending_jobs,
    invalidate_image_cache,
)


def test_celery_uses_json_and_separate_maintenance_queue() -> None:
    assert celery_app.conf.accept_content == ["json"]
    assert celery_app.conf.task_serializer == "json"
    assert celery_app.conf.task_acks_late is True
    assert celery_app.conf.worker_prefetch_multiplier == 1
    assert (
        celery_app.conf.worker_concurrency
        == Settings(_env_file=None).celery_worker_concurrency
    )
    assert celery_app.conf.task_default_queue == "pns-default"
    assert celery_app.conf.broker_transport_options["global_keyprefix"] == "pns:celery:"
    assert "pns-maintenance" in {queue.name for queue in celery_app.conf.task_queues}
    assert len(celery_app.conf.beat_schedule) == 2
    assert {
        "pns.tasks.cleanup_background_jobs",
        "pns.tasks.dispatch_pending_jobs",
        "pns.tasks.invalidate_image_cache",
        "pns.tasks.celery_connectivity_test",
    }.issubset(celery_app.tasks)
    assert (
        celery_app.conf.task_routes["pns.tasks.celery_connectivity_test"]["queue"]
        == "pns-maintenance"
    )


def test_rediss_broker_requires_certificate_verification() -> None:
    assert broker_ssl_options("rediss://default:secret@redis.example.test:6379") == {
        "ssl_cert_reqs": ssl.CERT_REQUIRED
    }
    assert broker_ssl_options("redis://localhost:6379/0") is None


def test_worker_concurrency_is_configurable_and_bounded(monkeypatch) -> None:
    monkeypatch.setenv("PNS_CELERY_WORKER_CONCURRENCY", "2")
    assert Settings(_env_file=None).celery_worker_concurrency == 2
    monkeypatch.setenv("PNS_CELERY_WORKER_CONCURRENCY", "0")
    with pytest.raises(ValueError):
        Settings(_env_file=None)


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


def test_worker_engine_disables_psycopg_automatic_prepared_statements(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}
    engine = object()

    def create_engine(_url: str, **kwargs: object) -> object:
        captured.update(kwargs)
        return engine

    monkeypatch.setattr(
        worker_database,
        "get_settings",
        lambda: Settings(
            _env_file=None,
            database_url="postgresql://user:password@db.example.test/postgres",
        ),
    )
    monkeypatch.setattr(worker_database, "create_engine", create_engine)
    worker_database.get_worker_engine.cache_clear()
    try:
        assert worker_database.get_worker_engine() is engine
        assert captured["connect_args"] == {
            "connect_timeout": 5,
            "prepare_threshold": None,
        }
    finally:
        worker_database.get_worker_engine.cache_clear()


def test_dispatcher_publishes_pending_jobs_with_lock_and_logs_counts(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    job = {
        "id": "job-123",
        "task_id": "task-123",
        "job_type": "cache.invalidate_images",
        "queue_name": "pns-maintenance",
        "status": "pending",
        "retry_count": 0,
    }

    class FakeResult:
        def mappings(self) -> "FakeResult":
            return self

        def all(self) -> list[dict[str, object]]:
            return [job]

    class FakeConnection:
        select_statement = ""

        def execute(self, statement, _params=None):
            query = str(statement)
            if query.lstrip().startswith("SELECT"):
                self.select_statement = query
                return FakeResult()
            return SimpleNamespace(rowcount=1)

    connection = FakeConnection()

    @contextmanager
    def transaction():
        yield connection

    class FakeEngine:
        def begin(self):
            return transaction()

    publications: list[dict[str, object]] = []

    def send_task(task_name: str, **kwargs: object) -> None:
        publications.append({"task_name": task_name, **kwargs})

    import app.tasks.jobs as jobs_module

    monkeypatch.setattr(jobs_module, "get_worker_engine", lambda: FakeEngine())
    monkeypatch.setattr(celery_app, "send_task", send_task)
    caplog.set_level(logging.INFO, logger="pns.tasks")
    result = dispatch_pending_jobs.apply(task_id="dispatcher-123")

    assert result.successful()
    assert result.get() == {"dispatched": 1, "failures": 0}
    assert "FOR UPDATE SKIP LOCKED" in connection.select_statement
    assert publications == [
        {
            "task_name": "pns.tasks.invalidate_image_cache",
            "args": ["job-123"],
            "task_id": "task-123",
            "queue": "pns-maintenance",
            "headers": {
                "background_job_id": "job-123",
                "correlation_id": "job-123",
                "job_type": "cache.invalidate_images",
            },
        }
    ]
    events = [json.loads(record.getMessage()) for record in caplog.records]
    summary = next(event for event in events if event["event"] == "background_dispatch_finished")
    assert summary["eligible_jobs"] == 1
    assert summary["published_jobs"] == 1
    assert summary["failed_dispatch_attempts"] == 0
    assert summary["published_job_ids"] == ["job-123"]


def test_celery_connectivity_test_is_explicitly_registered_and_returns_success(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO, logger="pns.tasks")
    result = celery_connectivity_test.apply(task_id="connectivity-test-id")
    assert result.successful()
    assert result.get() == {"status": "ok", "task_id": "connectivity-test-id"}
    events = [json.loads(record.getMessage()) for record in caplog.records]
    assert any(
        event["event"] == "background_task_finished"
        and event["celery_task_id"] == "connectivity-test-id"
        and event["final_status"] == "completed"
        for event in events
    )


def test_dispatcher_reports_no_eligible_jobs_without_publishing(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    class FakeResult:
        def mappings(self) -> "FakeResult":
            return self

        def all(self) -> list[object]:
            return []

    class FakeConnection:
        def execute(self, *_args, **_kwargs):
            return FakeResult()

    @contextmanager
    def transaction():
        yield FakeConnection()

    class FakeEngine:
        def begin(self):
            return transaction()

    import app.tasks.jobs as jobs_module

    def unexpected_publish(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("The empty outbox must not publish a task.")

    monkeypatch.setattr(jobs_module, "get_worker_engine", lambda: FakeEngine())
    monkeypatch.setattr(celery_app, "send_task", unexpected_publish)
    caplog.set_level(logging.INFO, logger="pns.tasks")
    result = dispatch_pending_jobs.apply(task_id="empty-dispatch-id")

    assert result.successful()
    assert result.get() == {"dispatched": 0, "failures": 0}
    summary = next(
        json.loads(record.getMessage())
        for record in caplog.records
        if json.loads(record.getMessage())["event"] == "background_dispatch_finished"
    )
    assert summary["eligible_jobs"] == 0
    assert summary["published_jobs"] == 0
    assert summary["failed_dispatch_attempts"] == 0


def test_admin_job_is_committed_before_publication_and_correlated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    job_record = {
        "id": "job-456",
        "task_id": "task-456",
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
    }

    class FakeResult:
        def first(self):
            if self.is_job:
                return SimpleNamespace(_mapping=job_record)
            return SimpleNamespace()

        def __init__(self, is_job: bool = False) -> None:
            self.is_job = is_job

    class FakeSession:
        def __init__(self) -> None:
            self.commits = 0
            self.statements: list[str] = []

        async def execute(self, statement, params=None):
            query = str(statement)
            self.statements.append(query)
            if query.lstrip().startswith("INSERT INTO"):
                job_record["id"] = str(params["id"])
                job_record["task_id"] = params["task_id"]
            return FakeResult(is_job="SELECT id, task_id" in query)

        async def commit(self) -> None:
            self.commits += 1

    session = FakeSession()
    publications: list[tuple[str, dict[str, object]]] = []

    def send_task(task_name: str, **kwargs: object) -> SimpleNamespace:
        publications.append((task_name, kwargs))
        return SimpleNamespace(id=kwargs["task_id"])

    monkeypatch.setattr(celery_app, "send_task", send_task)
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/admin/jobs",
            "headers": [],
            "query_string": b"",
            "scheme": "https",
            "server": ("testserver", 443),
            "client": ("127.0.0.1", 1),
            "state": {"request_id": "request-456"},
        }
    )
    actor = AdminContext(
        user={"id": "admin-id"},
        permissions=frozenset({"jobs.create"}),
        request_id="request-456",
    )
    response = asyncio.run(
        create_job(
            request,
            CreateJobRequest(type="cache.invalidate_images"),
            session,
            actor,
        )
    )

    payload = json.loads(response.body)
    assert response.status_code == 202
    assert session.commits == 2
    assert session.statements[0].lstrip().startswith("INSERT INTO")
    assert publications[0][0] == "pns.tasks.invalidate_image_cache"
    assert publications[0][1]["task_id"] == payload["job"]["taskId"]
    assert publications[0][1]["headers"]["request_id"] == "request-456"
    assert payload["job"]["status"] == "queued"


def test_image_cache_worker_records_completed_job_status(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    class FakeResult:
        def first(self) -> SimpleNamespace:
            return SimpleNamespace(status="queued")

    class FakeConnection:
        def __init__(self) -> None:
            self.statements: list[tuple[str, dict[str, object]]] = []

        def execute(self, statement, params=None):
            query = str(statement)
            self.statements.append((query, params or {}))
            return FakeResult()

    connection = FakeConnection()

    @contextmanager
    def transaction():
        yield connection

    class FakeEngine:
        def begin(self):
            return transaction()

    class FakeRedis:
        def scan_iter(self, **_kwargs):
            return iter([])

        def close(self) -> None:
            return None

    import app.tasks.jobs as jobs_module

    monkeypatch.setattr(jobs_module, "get_worker_engine", lambda: FakeEngine())
    monkeypatch.setattr(
        jobs_module,
        "get_settings",
        lambda: Settings(_env_file=None, redis_url="rediss://broker.example.test"),
    )
    monkeypatch.setattr(jobs_module.redis.Redis, "from_url", lambda *_args, **_kwargs: FakeRedis())
    caplog.set_level(logging.INFO, logger="pns.tasks")
    result = invalidate_image_cache.apply(
        args=["job-789"],
        task_id="task-789",
        headers={"request_id": "request-789"},
    )

    assert result.successful()
    assert result.get() == {"status": "completed", "deleted_keys": 0}
    updates = [
        (query, params)
        for query, params in connection.statements
        if query.lstrip().startswith("UPDATE")
    ]
    assert any("status = 'processing'" in query for query, _params in updates)
    completion = next(
        (query, params)
        for query, params in updates
        if params.get("status") == "completed"
    )
    assert "status NOT IN ('completed', 'failed', 'cancelled')" in completion[0]
    events = [json.loads(record.getMessage()) for record in caplog.records]
    finished = next(event for event in events if event["event"] == "background_task_finished")
    assert finished["background_job_id"] == "job-789"
    assert finished["celery_task_id"] == "task-789"
    assert finished["request_id"] == "request-789"


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
