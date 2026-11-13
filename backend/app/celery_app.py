from __future__ import annotations

import logging
import ssl
from urllib.parse import urlsplit

from celery import Celery
from celery.schedules import crontab
from kombu import Queue

from app.core.config import get_settings

logger = logging.getLogger("pns.celery")
settings = get_settings()


def validate_broker_url(url: str | None, app_env: str) -> None:
    if not url:
        return
    parsed_url = urlsplit(url)
    broker_scheme = parsed_url.scheme
    if broker_scheme not in {"redis", "rediss"}:
        raise ValueError("CELERY_BROKER_URL must use the Redis protocol, not a REST endpoint.")
    local_hosts = {"localhost", "127.0.0.1", "::1"}
    if broker_scheme == "redis" and (
        app_env.lower() == "production" or parsed_url.hostname not in local_hosts
    ):
        raise ValueError("CELERY_BROKER_URL must use TLS (rediss://) outside local development.")


def broker_ssl_options(url: str | None) -> dict[str, object] | None:
    if not url or urlsplit(url).scheme != "rediss":
        return None
    return {"ssl_cert_reqs": ssl.CERT_REQUIRED}


if not settings.redis_url:
    logger.warning("CELERY_BROKER_URL is not configured; Celery will try local Redis.")
validate_broker_url(settings.redis_url, settings.app_env)

celery_app = Celery(
    "pns",
    broker=settings.redis_url or "redis://localhost:6379/0",
    include=["app.tasks.jobs"],
)
celery_app.conf.update(
    accept_content=["json"],
    task_serializer="json",
    result_serializer="json",
    task_ignore_result=True,
    task_store_errors_even_if_ignored=False,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    task_track_started=True,
    task_time_limit=settings.celery_task_time_limit_seconds,
    task_soft_time_limit=max(1, settings.celery_task_time_limit_seconds - 60),
    task_default_queue="pns-default",
    task_queues=(
        Queue("pns-default"),
        Queue("pns-maintenance"),
    ),
    task_routes={
        "pns.tasks.invalidate_image_cache": {"queue": "pns-maintenance"},
        "pns.tasks.dispatch_pending_jobs": {"queue": "pns-maintenance"},
        "pns.tasks.cleanup_background_jobs": {"queue": "pns-maintenance"},
    },
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=500,
    worker_send_task_events=True,
    worker_cancel_long_running_tasks_on_connection_loss=True,
    task_send_sent_event=True,
    broker_use_ssl=broker_ssl_options(settings.redis_url),
    broker_connection_timeout=5,
    broker_connection_retry=True,
    broker_connection_retry_on_startup=True,
    broker_connection_max_retries=None,
    broker_heartbeat=30,
    broker_transport_options={
        "global_keyprefix": "pns:celery:",
        "socket_connect_timeout": 5,
        "socket_timeout": 10,
        "visibility_timeout": 3600,
        "health_check_interval": 30,
        "retry_on_timeout": True,
    },
    task_publish_retry=True,
    task_publish_retry_policy={
        "max_retries": 1,
        "interval_start": 0.2,
        "interval_step": 0.2,
        "interval_max": 1,
    },
    result_expires=3600,
    timezone="UTC",
    enable_utc=True,
    worker_concurrency=settings.celery_worker_concurrency,
    beat_schedule={
        "dispatch-pending-background-jobs": {
            "task": "pns.tasks.dispatch_pending_jobs",
            "schedule": settings.celery_job_dispatch_interval_seconds,
        },
        "cleanup-expired-background-jobs-daily": {
            "task": "pns.tasks.cleanup_background_jobs",
            "schedule": crontab(
                hour=settings.celery_job_cleanup_hour,
                minute=settings.celery_job_cleanup_minute,
            ),
        },
    },
)
