from __future__ import annotations

import asyncio
import logging
from collections.abc import Mapping
from typing import Annotated, Literal
from uuid import UUID, uuid4

import redis
from fastapi import APIRouter, Depends, Header, Query, Request
from kombu.exceptions import OperationalError
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.celery_app import celery_app
from app.core.admin_types import AdminContext
from app.core.database import get_db_session
from app.core.dependencies import require_permission
from app.core.responses import JSONResponse

logger = logging.getLogger("pns.api.admin_jobs")
router = APIRouter()
Database = Annotated[AsyncSession, Depends(get_db_session)]


class CreateJobRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_type: Literal["cache.invalidate_images"] = Field(alias="type")


def _job_response(job: Mapping[str, object]) -> dict[str, object]:
    return {
        "id": str(job["id"]),
        "taskId": job["task_id"],
        "type": job["job_type"],
        "queue": job["queue_name"],
        "status": job["status"],
        "progress": job["progress"],
        "resultSummary": job["result_summary"],
        "error": job["error_message"],
        "retryCount": job["retry_count"],
        "createdAt": job["created_at"],
        "updatedAt": job["updated_at"],
        "startedAt": job["started_at"],
        "completedAt": job["completed_at"],
    }


@router.get("")
async def list_jobs(
    request: Request,
    db: Database,
    _: Annotated[AdminContext, Depends(require_permission("jobs.read"))],
    status: Literal[
        "pending", "queued", "processing", "completed", "failed", "retrying", "cancelled"
    ]
    | None = None,
    job_type: Literal["cache.invalidate_images"] | None = Query(default=None, alias="type"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> JSONResponse:
    conditions: list[str] = []
    filter_params: dict[str, object] = {}
    if status:
        conditions.append("status = :status")
        filter_params["status"] = status
    if job_type:
        conditions.append("job_type = :job_type")
        filter_params["job_type"] = job_type
    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    count = await db.execute(
        text(f"SELECT count(*) FROM public.background_jobs {where_clause}"),
        filter_params,
    )
    params = {
        **filter_params,
        "limit": page_size,
        "offset": (page - 1) * page_size,
    }
    result = await db.execute(
        text(
            "SELECT id, task_id, job_type, queue_name, status, progress, result_summary, "
            "error_message, retry_count, created_at, updated_at, started_at, completed_at "
            f"FROM public.background_jobs {where_clause} "
            "ORDER BY created_at DESC LIMIT :limit OFFSET :offset"
        ),
        params,
    )
    total = int(count.scalar_one())
    return JSONResponse(
        {
            "success": True,
            "jobs": [_job_response(row) for row in result.mappings()],
            "pagination": {
                "page": page,
                "pageSize": page_size,
                "total": total,
                "totalPages": (total + page_size - 1) // page_size,
            },
            "requestId": getattr(request.state, "request_id", "unknown"),
        },
        headers={"Cache-Control": "no-store"},
    )


@router.post("", status_code=202)
async def create_job(
    request: Request,
    body: CreateJobRequest,
    db: Database,
    actor: Annotated[AdminContext, Depends(require_permission("jobs.create"))],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> JSONResponse:
    key = (idempotency_key or str(uuid4())).strip()
    if not key or len(key) > 200:
        return JSONResponse(
            {
                "success": False,
                "error": {
                    "code": "invalid_idempotency_key",
                    "message": "The Idempotency-Key header must be 1 to 200 characters.",
                },
                "requestId": getattr(request.state, "request_id", "unknown"),
            },
            status_code=400,
        )

    job_id = uuid4()
    result = await db.execute(
        text(
            """
            INSERT INTO public.background_jobs
                (id, task_id, job_type, queue_name, idempotency_key, actor_user_id)
            VALUES
                (:id, :task_id, :job_type, 'pns-maintenance', :idempotency_key, :actor_user_id)
            ON CONFLICT (idempotency_key) DO NOTHING
            RETURNING id, task_id, job_type, queue_name, status, progress, result_summary,
                      error_message, retry_count, created_at, updated_at, started_at, completed_at
            """
        ),
        {
            "id": job_id,
            "task_id": str(job_id),
            "job_type": body.job_type,
            "idempotency_key": key,
            "actor_user_id": actor.user["id"],
        },
    )
    inserted = result.first()
    await db.commit()
    if inserted is None:
        existing = await db.execute(
            text(
                """
                SELECT id, task_id, job_type, queue_name, status, progress, result_summary,
                       error_message, retry_count, created_at, updated_at, started_at, completed_at
                  FROM public.background_jobs
                 WHERE idempotency_key = :idempotency_key
                """
            ),
            {"idempotency_key": key},
        )
        existing_job = existing.first()
        if existing_job is None:
            raise RuntimeError("The idempotent background job could not be retrieved.")
        return JSONResponse(
            {
                "success": True,
                "job": _job_response(existing_job._mapping),
                "dispatch": "already_exists",
                "requestId": getattr(request.state, "request_id", "unknown"),
            },
            status_code=202,
            headers={"Cache-Control": "no-store"},
        )

    job_id_text = str(job_id)
    dispatch_status = "pending_retry"
    try:
        await asyncio.to_thread(
            celery_app.send_task,
            "pns.tasks.invalidate_image_cache",
            args=[job_id_text],
            task_id=job_id_text,
            queue="pns-maintenance",
        )
    except (OperationalError, redis.RedisError, OSError, TimeoutError) as error:
        logger.warning(
            "Background job is committed and will be dispatched by Beat "
            "(job_id=%s, error=%s).",
            job_id_text,
            type(error).__name__,
        )
        await db.execute(
            text(
                """
                UPDATE public.background_jobs
                   SET dispatch_attempts = dispatch_attempts + 1,
                       error_message = :error_message
                 WHERE id = :job_id AND status = 'pending'
                """
            ),
            {
                "job_id": job_id,
                "error_message": f"Broker publish failed ({type(error).__name__}).",
            },
        )
        await db.commit()
    else:
        dispatch_status = "queued"
        await db.execute(
            text(
                """
                UPDATE public.background_jobs
                   SET status = 'queued',
                       dispatched_at = now(),
                       dispatch_attempts = dispatch_attempts + 1,
                       error_message = NULL
                 WHERE id = :job_id AND status = 'pending'
                """
            ),
            {"job_id": job_id},
        )
        await db.commit()

    current_job = await _get_job(db, job_id)
    if current_job is None:
        raise RuntimeError("The newly created background job could not be retrieved.")
    return JSONResponse(
        {
            "success": True,
            "job": _job_response(current_job._mapping),
            "dispatch": dispatch_status,
            "requestId": getattr(request.state, "request_id", "unknown"),
        },
        status_code=202,
        headers={"Cache-Control": "no-store"},
    )


async def _get_job(db: AsyncSession, job_id: UUID):
    result = await db.execute(
        text(
            """
            SELECT id, task_id, job_type, queue_name, status, progress, result_summary,
                   error_message, retry_count, created_at, updated_at, started_at, completed_at
              FROM public.background_jobs
             WHERE id = :job_id
            """
        ),
        {"job_id": job_id},
    )
    return result.first()


@router.get("/{job_id}")
async def get_job(
    request: Request,
    job_id: UUID,
    db: Database,
    _: Annotated[AdminContext, Depends(require_permission("jobs.read"))],
) -> JSONResponse:
    row = await _get_job(db, job_id)
    if row is None:
        return JSONResponse(
            {
                "success": False,
                "error": {"code": "not_found", "message": "Background job not found."},
                "requestId": getattr(request.state, "request_id", "unknown"),
            },
            status_code=404,
        )
    return JSONResponse(
        {
            "success": True,
            "job": _job_response(row._mapping),
            "requestId": getattr(request.state, "request_id", "unknown"),
        },
        headers={"Cache-Control": "no-store"},
    )


@router.get("/{job_id}/status")
async def get_job_status(
    request: Request,
    job_id: UUID,
    db: Database,
    _: Annotated[AdminContext, Depends(require_permission("jobs.read"))],
) -> JSONResponse:
    row = await _get_job(db, job_id)
    if row is None:
        return JSONResponse(
            {
                "success": False,
                "error": {"code": "not_found", "message": "Background job not found."},
                "requestId": getattr(request.state, "request_id", "unknown"),
            },
            status_code=404,
        )
    return JSONResponse(
        {
            "success": True,
            "job": _job_response(row._mapping),
            "requestId": getattr(request.state, "request_id", "unknown"),
        },
        headers={"Cache-Control": "no-store"},
    )
