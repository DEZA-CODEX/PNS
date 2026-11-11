from __future__ import annotations

import logging
import time
from typing import Any

import redis
from kombu.exceptions import OperationalError
from sqlalchemy import text
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
                "WHERE id = :job_id"
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


def _retry_or_fail(task, job_id: str, error: Exception, started_at: float) -> None:
    retry_count = task.request.retries + 1
    if retry_count <= task.max_retries:
        try:
            _update_job(
                job_id,
                status="retrying",
                retry_count=retry_count,
                error_message=f"Task operation failed ({type(error).__name__}).",
            )
        except (DatabaseOperationalError, DatabaseTimeoutError) as database_error:
            logger.warning(
                "Could not persist retry status (job_id=%s, error=%s).",
                job_id,
                type(database_error).__name__,
            )
            error = database_error
        logger.warning(
            "Background task will retry (task_id=%s, job_id=%s, retry=%s, error=%s).",
            task.request.id,
            job_id,
            retry_count,
            type(error).__name__,
        )
        raise task.retry(exc=error, countdown=min(2**retry_count, 60))

    _update_job(
        job_id,
        status="failed",
        retry_count=retry_count,
        error_message=f"Task failed after retries ({type(error).__name__}).",
        completed=True,
    )
    logger.error(
        "Background task failed (task_id=%s, job_id=%s, task=%s, duration_ms=%s, "
        "retry=%s, error=%s).",
        task.request.id,
        job_id,
        task.name,
        int((time.monotonic() - started_at) * 1000),
        retry_count,
        type(error).__name__,
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
    logger.info(
        "Background task started (task_id=%s, job_id=%s, task=%s, queue=%s, retry=%s).",
        self.request.id,
        job_id,
        self.name,
        (self.request.delivery_info or {}).get("routing_key", "pns-maintenance"),
        self.request.retries,
    )
    client = None
    try:
        with get_worker_engine().begin() as connection:
            row = connection.execute(
                text("SELECT status FROM public.background_jobs WHERE id = :job_id FOR UPDATE"),
                {"job_id": job_id},
            ).first()
            if row is None or row.status in {"completed", "failed", "cancelled"}:
                return {"status": row.status if row else "missing"}
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
        logger.info(
            "Background task completed (task_id=%s, job_id=%s, task=%s, duration_ms=%s, "
            "retry=%s, status=completed).",
            self.request.id,
            job_id,
            self.name,
            int((time.monotonic() - started_at) * 1000),
            self.request.retries,
        )
        return {"status": "completed", "deleted_keys": deleted}
    except (
        redis.RedisError,
        OSError,
        TimeoutError,
        DatabaseOperationalError,
        DatabaseTimeoutError,
    ) as error:
        _retry_or_fail(self, job_id, error, started_at)
    except Exception as error:
        _update_job(
            job_id,
            status="failed",
            error_message=f"Task failed ({type(error).__name__}).",
            completed=True,
        )
        logger.error(
            "Background task failed (task_id=%s, job_id=%s, task=%s, duration_ms=%s, "
            "retry=%s, error=%s).",
            self.request.id,
            job_id,
            self.name,
            int((time.monotonic() - started_at) * 1000),
            self.request.retries,
            type(error).__name__,
        )
        raise
    finally:
        if client is not None:
            client.close()


@celery_app.task(
    name="pns.tasks.dispatch_pending_jobs",
    acks_late=True,
    autoretry_for=(DatabaseOperationalError, DatabaseTimeoutError, OSError, TimeoutError),
    retry_backoff=True,
    retry_jitter=True,
    retry_backoff_max=60,
    max_retries=5,
)
def dispatch_pending_jobs() -> dict[str, int]:
    dispatched = 0
    failures = 0
    with get_worker_engine().begin() as connection:
        jobs = connection.execute(
            text(
                """
                SELECT id, task_id, job_type, status
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
        ).mappings()
        for job in jobs:
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
                continue
            task_name, queue_name = task
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
                    args=[str(job["id"])],
                    task_id=job["task_id"],
                    queue=queue_name,
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
                logger.warning(
                    "Background job dispatch will retry (job_id=%s, error=%s).",
                    job["id"],
                    type(error).__name__,
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
    return {"dispatched": dispatched, "failures": failures}


@celery_app.task(
    name="pns.tasks.cleanup_background_jobs",
    acks_late=True,
    autoretry_for=(DatabaseOperationalError, DatabaseTimeoutError, OSError, TimeoutError),
    retry_backoff=True,
    retry_jitter=True,
    retry_backoff_max=60,
    max_retries=5,
)
def cleanup_background_jobs() -> dict[str, int]:
    retention_days = get_settings().background_job_retention_days
    deleted = 0
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
    logger.info("Expired background jobs removed (count=%s).", deleted)
    return {"deleted": deleted}
