from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any

import redis
from kombu.exceptions import OperationalError
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.exc import OperationalError as DatabaseOperationalError
from sqlalchemy.exc import TimeoutError as DatabaseTimeoutError

from app.celery_app import celery_app
from app.core.config import get_settings
from app.services.worker_database import get_worker_engine

logger = logging.getLogger("pns.tasks")

TASKS_BY_TYPE = {
    "cache.invalidate_images": ("pns.tasks.invalidate_image_cache", "pns-maintenance"),
}
IMAGE_CACHE_PATTERNS = (
    "images:homepage*",
    "images:rooms*",
    "images:dining*",
    "images:about*",
    "images:room:*",
    "images:dining:*",
)


def _log_task_event(
    level: int,
    event: str,
    *,
    task_name: str,
    task_id: str | None,
    job_id: str | None,
    job_type: str | None,
    queue_name: str,
    started_at: str,
    started_monotonic: float,
    retry_count: int,
    request_id: str | None = None,
    final_status: str | None = None,
    failure_reason: str | None = None,
    **details: Any,
) -> None:
    record = {
        "event": event,
        "logged_at": datetime.now(timezone.utc).isoformat(),
        "task_name": task_name,
        "celery_task_id": task_id,
        "background_job_id": job_id,
        "correlation_id": job_id or task_id,
        "request_id": request_id,
        "job_type": job_type,
        "queue_name": queue_name,
        "execution_started_at": started_at,
        "duration_ms": int((time.monotonic() - started_monotonic) * 1000),
        "final_status": final_status,
        "retry_count": retry_count,
        "failure_reason": failure_reason,
        **details,
    }
    logger.log(level, "%s", json.dumps(record, sort_keys=True, default=str))


def _task_queue(task, fallback: str) -> str:
    return (task.request.delivery_info or {}).get("routing_key", fallback)


def _task_request_id(task) -> str | None:
    headers = task.request.headers or {}
    return headers.get("request_id")


def _update_job(
    job_id: str,
    *,
    status: str,
    progress: int | None = None,
    retry_count: int | None = None,
    result_summary: str | None = None,
    error_message: str | None = None,
    completed: bool = False,
) -> None:
    values: dict[str, Any] = {
        "job_id": job_id,
        "status": status,
        "error_message": error_message,
    }
    assignments = ["status = :status", "updated_at = now()", "error_message = :error_message"]
    if progress is not None:
        assignments.append("progress = :progress")
        values["progress"] = progress
    if retry_count is not None:
        assignments.append("retry_count = :retry_count")
        values["retry_count"] = retry_count
    if result_summary is not None:
        assignments.append("result_summary = :result_summary")
        values["result_summary"] = result_summary
    if completed:
        assignments.append("completed_at = now()")
    with get_worker_engine().begin() as connection:
        connection.execute(
            text(
                f"UPDATE public.background_jobs SET {', '.join(assignments)} "
                "WHERE id = :job_id "
                "AND status NOT IN ('completed', 'failed', 'cancelled')"
            ),
            values,
        )


def _invalidate_cached_image_keys(client: redis.Redis, prefix: str) -> int:
    deleted = 0
    for pattern in IMAGE_CACHE_PATTERNS:
        batch: list[str] = []
        for key in client.scan_iter(match=f"{prefix}{pattern}", count=100):
            batch.append(key)
            if len(batch) == 100:
                deleted += int(client.delete(*batch))
                batch.clear()
        if batch:
            deleted += int(client.delete(*batch))
    return deleted


def _retry_or_fail(
    task,
    job_id: str,
    error: Exception,
    started_at: float,
    execution_started_at: str,
) -> None:
    retry_count = task.request.retries + 1
    queue_name = _task_queue(task, "pns-maintenance")
    if retry_count <= task.max_retries:
        try:
            _update_job(
                job_id,
                status="retrying",
                retry_count=retry_count,
                error_message=f"Task operation failed ({type(error).__name__}).",
            )
        except SQLAlchemyError as database_error:
            _log_task_event(
                logging.WARNING,
                "background_job_retry_status_persist_failed",
                task_name=task.name,
                task_id=task.request.id,
                job_id=job_id,
                job_type="cache.invalidate_images",
                queue_name=queue_name,
                started_at=execution_started_at,
                started_monotonic=started_at,
                retry_count=retry_count,
                request_id=_task_request_id(task),
                final_status="retrying",
                failure_reason=type(database_error).__name__,
            )
            error = database_error
        _log_task_event(
            logging.WARNING,
            "background_task_retrying",
            task_name=task.name,
            task_id=task.request.id,
            job_id=job_id,
            job_type="cache.invalidate_images",
            queue_name=queue_name,
            started_at=execution_started_at,
            started_monotonic=started_at,
            retry_count=retry_count,
            request_id=_task_request_id(task),
            final_status="retrying",
            failure_reason=type(error).__name__,
        )
        raise task.retry(exc=error, countdown=min(2**retry_count, 60))

    _update_job(
        job_id,
        status="failed",
        retry_count=retry_count,
        error_message=f"Task failed after retries ({type(error).__name__}).",
        completed=True,
    )
    _log_task_event(
        logging.ERROR,
        "background_task_failed",
        task_name=task.name,
        task_id=task.request.id,
        job_id=job_id,
        job_type="cache.invalidate_images",
        queue_name=queue_name,
        started_at=execution_started_at,
        started_monotonic=started_at,
        retry_count=retry_count,
        request_id=_task_request_id(task),
        final_status="failed",
        failure_reason=type(error).__name__,
    )
    raise error


@celery_app.task(
    bind=True,
    name="pns.tasks.invalidate_image_cache",
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=5,
)
def invalidate_image_cache(self, job_id: str) -> dict[str, Any]:
    started_at = time.monotonic()
    execution_started_at = datetime.now(timezone.utc).isoformat()
    queue_name = _task_queue(self, "pns-maintenance")
    _log_task_event(
        logging.INFO,
        "background_task_started",
        task_name=self.name,
        task_id=self.request.id,
        job_id=job_id,
        job_type="cache.invalidate_images",
        queue_name=queue_name,
        started_at=execution_started_at,
        started_monotonic=started_at,
        retry_count=self.request.retries,
        request_id=_task_request_id(self),
    )
    client = None
    try:
        with get_worker_engine().begin() as connection:
            row = connection.execute(
                text("SELECT status FROM public.background_jobs WHERE id = :job_id FOR UPDATE"),
                {"job_id": job_id},
            ).first()
            if row is None or row.status in {"completed", "failed", "cancelled"}:
                final_status = row.status if row else "missing"
                _log_task_event(
                    logging.INFO,
                    "background_task_finished",
                    task_name=self.name,
                    task_id=self.request.id,
                    job_id=job_id,
                    job_type="cache.invalidate_images",
                    queue_name=queue_name,
                    started_at=execution_started_at,
                    started_monotonic=started_at,
                    retry_count=self.request.retries,
                    request_id=_task_request_id(self),
                    final_status=final_status,
                )
                return {"status": final_status}
            connection.execute(
                text(
                    """
                    UPDATE public.background_jobs
                       SET status = 'processing',
                           progress = 10,
                           retry_count = :retry_count,
                           started_at = COALESCE(started_at, now()),
                           updated_at = now(),
                           error_message = NULL
                     WHERE id = :job_id
                    """
                ),
                {"job_id": job_id, "retry_count": self.request.retries},
            )

        settings = get_settings()
        if not settings.redis_url:
            _update_job(
                job_id,
                status="failed",
                error_message="Task configuration is incomplete.",
                completed=True,
            )
            raise RuntimeError("CELERY_BROKER_URL is required for cache invalidation.")
        client = redis.Redis.from_url(
            settings.redis_url,
            socket_connect_timeout=5,
            socket_timeout=10,
            health_check_interval=30,
        )
        deleted = _invalidate_cached_image_keys(client, settings.redis_key_prefix)
        _update_job(
            job_id,
            status="completed",
            progress=100,
            result_summary=f"Invalidated {deleted} image cache key(s).",
            completed=True,
        )
        _log_task_event(
            logging.INFO,
            "background_task_finished",
            task_name=self.name,
            task_id=self.request.id,
            job_id=job_id,
            job_type="cache.invalidate_images",
            queue_name=queue_name,
            started_at=execution_started_at,
            started_monotonic=started_at,
            retry_count=self.request.retries,
            request_id=_task_request_id(self),
            final_status="completed",
            deleted_cache_keys=deleted,
        )
        return {"status": "completed", "deleted_keys": deleted}
    except (
        redis.RedisError,
        OSError,
        TimeoutError,
        DatabaseOperationalError,
        DatabaseTimeoutError,
    ) as error:
        _retry_or_fail(self, job_id, error, started_at, execution_started_at)
    except Exception as error:
        try:
            _update_job(
                job_id,
                status="failed",
                error_message=f"Task failed ({type(error).__name__}).",
                completed=True,
            )
        except SQLAlchemyError as database_error:
            _log_task_event(
                logging.ERROR,
                "background_task_failure_status_persist_failed",
                task_name=self.name,
                task_id=self.request.id,
                job_id=job_id,
                job_type="cache.invalidate_images",
                queue_name=queue_name,
                started_at=execution_started_at,
                started_monotonic=started_at,
                retry_count=self.request.retries,
                request_id=_task_request_id(self),
                final_status="unknown",
                failure_reason=type(database_error).__name__,
            )
        _log_task_event(
            logging.ERROR,
            "background_task_failed",
            task_name=self.name,
            task_id=self.request.id,
            job_id=job_id,
            job_type="cache.invalidate_images",
            queue_name=queue_name,
            started_at=execution_started_at,
            started_monotonic=started_at,
            retry_count=self.request.retries,
            request_id=_task_request_id(self),
            final_status="failed",
            failure_reason=type(error).__name__,
        )
        raise
    finally:
        if client is not None:
            client.close()


@celery_app.task(
    bind=True,
    name="pns.tasks.dispatch_pending_jobs",
    acks_late=True,
    autoretry_for=(DatabaseOperationalError, DatabaseTimeoutError, OSError, TimeoutError),
    retry_backoff=True,
    retry_jitter=True,
    retry_backoff_max=60,
    max_retries=5,
)
def dispatch_pending_jobs(self) -> dict[str, int]:
    started_at = time.monotonic()
    execution_started_at = datetime.now(timezone.utc).isoformat()
    queue_name = _task_queue(self, "pns-maintenance")
    _log_task_event(
        logging.INFO,
        "background_task_started",
        task_name=self.name,
        task_id=self.request.id,
        job_id=None,
        job_type="background_jobs.dispatch",
        queue_name=queue_name,
        started_at=execution_started_at,
        started_monotonic=started_at,
        retry_count=self.request.retries,
    )
    dispatched = 0
    failures = 0
    eligible_job_ids: list[str] = []
    published_job_ids: list[str] = []
    failed_job_ids: list[str] = []
    failed_dispatch_ids: list[str] = []
    try:
        with get_worker_engine().begin() as connection:
            jobs = connection.execute(
                text(
                    """
                    SELECT id, task_id, job_type, queue_name, status, retry_count
                      FROM public.background_jobs
                      WHERE (status = 'pending' AND dispatched_at IS NULL)
                         OR (
                             status = 'queued'
                             AND started_at IS NULL
                             AND dispatched_at < now() - interval '1 hour'
                         )
                      ORDER BY created_at
                     LIMIT 50
                     FOR UPDATE SKIP LOCKED
                    """
                )
            ).mappings().all()
            eligible_job_ids = [str(job["id"]) for job in jobs]
            for job in jobs:
                job_id = str(job["id"])
                task = TASKS_BY_TYPE.get(job["job_type"])
                if task is None:
                    connection.execute(
                        text(
                            """
                            UPDATE public.background_jobs
                               SET status = 'failed',
                                   error_message = 'Unsupported background task type.',
                                   completed_at = now(),
                                   updated_at = now()
                             WHERE id = :job_id
                            """
                        ),
                        {"job_id": job["id"]},
                    )
                    failures += 1
                    failed_job_ids.append(job_id)
                    _log_task_event(
                        logging.ERROR,
                        "background_job_dispatch_failed",
                        task_name=self.name,
                        task_id=str(job["task_id"]),
                        job_id=job_id,
                        job_type=str(job["job_type"]),
                        queue_name=str(job["queue_name"]),
                        started_at=execution_started_at,
                        started_monotonic=started_at,
                        retry_count=int(job["retry_count"]),
                        request_id=_task_request_id(self),
                        final_status="failed",
                        failure_reason="unsupported_job_type",
                    )
                    continue
                task_name, target_queue = task
                if job["status"] == "queued":
                    connection.execute(
                        text(
                            """
                            UPDATE public.background_jobs
                               SET status = 'pending', dispatched_at = NULL, updated_at = now()
                             WHERE id = :job_id AND status = 'queued'
                            """
                        ),
                        {"job_id": job["id"]},
                    )
                try:
                    celery_app.send_task(
                        task_name,
                        args=[job_id],
                        task_id=job["task_id"],
                        queue=target_queue,
                        headers={
                            "background_job_id": job_id,
                            "correlation_id": job_id,
                            "job_type": job["job_type"],
                        },
                    )
                except (OperationalError, redis.RedisError, OSError, TimeoutError) as error:
                    connection.execute(
                        text(
                            """
                            UPDATE public.background_jobs
                               SET dispatch_attempts = dispatch_attempts + 1,
                                   error_message = :error_message,
                                   updated_at = now()
                             WHERE id = :job_id
                            """
                        ),
                        {
                            "job_id": job["id"],
                            "error_message": f"Broker publish failed ({type(error).__name__}).",
                        },
                    )
                    failures += 1
                    failed_job_ids.append(job_id)
                    failed_dispatch_ids.append(job_id)
                    _log_task_event(
                        logging.WARNING,
                        "background_job_dispatch_failed",
                        task_name=task_name,
                        task_id=str(job["task_id"]),
                        job_id=job_id,
                        job_type=str(job["job_type"]),
                        queue_name=target_queue,
                        started_at=execution_started_at,
                        started_monotonic=started_at,
                        retry_count=int(job["retry_count"]),
                        request_id=_task_request_id(self),
                        final_status="pending",
                        failure_reason=type(error).__name__,
                    )
                    continue
                connection.execute(
                    text(
                        """
                        UPDATE public.background_jobs
                           SET status = 'queued',
                               dispatched_at = now(),
                               dispatch_attempts = dispatch_attempts + 1,
                               error_message = NULL,
                               updated_at = now()
                         WHERE id = :job_id AND status = 'pending'
                        """
                    ),
                    {"job_id": job["id"]},
                )
                dispatched += 1
                published_job_ids.append(job_id)
                _log_task_event(
                    logging.INFO,
                    "background_job_published",
                    task_name=task_name,
                    task_id=str(job["task_id"]),
                    job_id=job_id,
                    job_type=str(job["job_type"]),
                    queue_name=target_queue,
                    started_at=execution_started_at,
                    started_monotonic=started_at,
                    retry_count=int(job["retry_count"]),
                    request_id=_task_request_id(self),
                    final_status="queued",
                )
    except SQLAlchemyError as error:
        _log_task_event(
            logging.ERROR,
            "background_dispatch_database_failed",
            task_name=self.name,
            task_id=self.request.id,
            job_id=None,
            job_type=None,
            queue_name=queue_name,
            started_at=execution_started_at,
            started_monotonic=started_at,
            retry_count=self.request.retries,
            request_id=_task_request_id(self),
            final_status="failed",
            failure_reason=type(error).__name__,
        )
        raise
    except Exception as error:
        _log_task_event(
            logging.ERROR,
            "background_dispatch_failed",
            task_name=self.name,
            task_id=self.request.id,
            job_id=None,
            job_type="background_jobs.dispatch",
            queue_name=queue_name,
            started_at=execution_started_at,
            started_monotonic=started_at,
            retry_count=self.request.retries,
            request_id=_task_request_id(self),
            final_status="failed",
            failure_reason=type(error).__name__,
        )
        raise

    _log_task_event(
        logging.INFO if failures == 0 else logging.WARNING,
        "background_dispatch_finished",
        task_name=self.name,
        task_id=self.request.id,
        job_id=None,
        job_type=None,
        queue_name=queue_name,
        started_at=execution_started_at,
        started_monotonic=started_at,
        retry_count=self.request.retries,
        request_id=_task_request_id(self),
        final_status="completed" if failures == 0 else "completed_with_failures",
        eligible_jobs=len(eligible_job_ids),
        eligible_job_ids=eligible_job_ids,
        published_jobs=dispatched,
        published_job_ids=published_job_ids,
        failed_dispatch_attempts=len(failed_dispatch_ids),
        failed_dispatch_job_ids=failed_dispatch_ids,
        failed_jobs=failures,
        failed_job_ids=failed_job_ids,
    )
    return {"dispatched": dispatched, "failures": failures}


@celery_app.task(
    bind=True,
    name="pns.tasks.cleanup_background_jobs",
    acks_late=True,
    autoretry_for=(DatabaseOperationalError, DatabaseTimeoutError, OSError, TimeoutError),
    retry_backoff=True,
    retry_jitter=True,
    retry_backoff_max=60,
    max_retries=5,
)
def cleanup_background_jobs(self) -> dict[str, int]:
    started_at = time.monotonic()
    execution_started_at = datetime.now(timezone.utc).isoformat()
    queue_name = _task_queue(self, "pns-maintenance")
    _log_task_event(
        logging.INFO,
        "background_task_started",
        task_name=self.name,
        task_id=self.request.id,
        job_id=None,
        job_type="background_jobs.cleanup",
        queue_name=queue_name,
        started_at=execution_started_at,
        started_monotonic=started_at,
        retry_count=self.request.retries,
    )
    try:
        retention_days = get_settings().background_job_retention_days
        with get_worker_engine().begin() as connection:
            result = connection.execute(
                text(
                    """
                    DELETE FROM public.background_jobs
                     WHERE id IN (
                         SELECT id
                           FROM public.background_jobs
                          WHERE status IN ('completed', 'failed', 'cancelled')
                            AND completed_at < now() - make_interval(days => :retention_days)
                          ORDER BY completed_at
                          LIMIT 5000
                     )
                    """
                ),
                {"retention_days": retention_days},
            )
            deleted = result.rowcount or 0
    except SQLAlchemyError as error:
        _log_task_event(
            logging.ERROR,
            "background_task_failed",
            task_name=self.name,
            task_id=self.request.id,
            job_id=None,
            job_type="background_jobs.cleanup",
            queue_name=queue_name,
            started_at=execution_started_at,
            started_monotonic=started_at,
            retry_count=self.request.retries,
            request_id=_task_request_id(self),
            final_status="failed",
            failure_reason=type(error).__name__,
        )
        raise
    except Exception as error:
        _log_task_event(
            logging.ERROR,
            "background_task_failed",
            task_name=self.name,
            task_id=self.request.id,
            job_id=None,
            job_type="background_jobs.cleanup",
            queue_name=queue_name,
            started_at=execution_started_at,
            started_monotonic=started_at,
            retry_count=self.request.retries,
            request_id=_task_request_id(self),
            final_status="failed",
            failure_reason=type(error).__name__,
        )
        raise
    _log_task_event(
        logging.INFO,
        "background_task_finished",
        task_name=self.name,
        task_id=self.request.id,
        job_id=None,
        job_type="background_jobs.cleanup",
        queue_name=queue_name,
        started_at=execution_started_at,
        started_monotonic=started_at,
        retry_count=self.request.retries,
        request_id=_task_request_id(self),
        final_status="completed",
        deleted_jobs=deleted,
    )
    return {"deleted": deleted}


@celery_app.task(bind=True, name="pns.tasks.celery_connectivity_test")
def celery_connectivity_test(self) -> dict[str, str]:
    started_at = time.monotonic()
    execution_started_at = datetime.now(timezone.utc).isoformat()
    task_id = self.request.id
    _log_task_event(
        logging.INFO,
        "background_task_started",
        task_name=self.name,
        task_id=task_id,
        job_id=None,
        job_type="celery.connectivity_test",
        queue_name=_task_queue(self, "pns-maintenance"),
        started_at=execution_started_at,
        started_monotonic=started_at,
        retry_count=self.request.retries,
        request_id=_task_request_id(self),
    )
    _log_task_event(
        logging.INFO,
        "background_task_finished",
        task_name=self.name,
        task_id=task_id,
        job_id=None,
        job_type="celery.connectivity_test",
        queue_name=_task_queue(self, "pns-maintenance"),
        started_at=execution_started_at,
        started_monotonic=started_at,
        retry_count=self.request.retries,
        final_status="completed",
    )
    return {"status": "ok", "task_id": task_id or ""}
