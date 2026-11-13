from __future__ import annotations

import asyncio
import io
import logging
import secrets
import time
import zipfile
from typing import Any

from celery.exceptions import OperationalError
from fastapi import APIRouter, Request
from fastapi.responses import Response
from redis import RedisError
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException

from app.celery_app import celery_app
from app.core.config import get_settings
from app.core.exceptions import APIError
from app.core.responses import JSONResponse
from app.services.converter_service import output_filename
from app.services.converter_storage import (
    ConverterStorageError,
    cancel_batch,
    create_batch,
    create_file,
    delete_batch,
    get_batch,
    get_file,
    get_file_data,
    save_original,
    update_batch,
)

logger = logging.getLogger("pns.api.converter")
router = APIRouter(prefix="/convert", tags=["converter"])


class ConverterRequestError(APIError):
    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        super().__init__(code, message, status_code)


def _request_size(request: Request) -> int | None:
    raw = request.headers.get("content-length")
    if raw is None:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def _item_view(item: dict[str, Any]) -> dict[str, Any]:
    return {
        key: item[key]
        for key in (
            "index",
            "file_id",
            "original_name",
            "original_size",
            "output_name",
            "status",
            "converted_size",
            "reduction_bytes",
            "reduction_percent",
            "error",
        )
        if key in item
    }


def _summary(items: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "total": len(items),
        "completed": sum(item.get("status") == "completed" for item in items),
        "failed": sum(item.get("status") == "failed" for item in items),
        "processing": sum(item.get("status") == "processing" for item in items),
        "waiting": sum(item.get("status") == "waiting" for item in items),
    }


def _batch_response(batch: dict[str, Any]) -> dict[str, Any]:
    items = list(batch.get("items", []))
    summary = _summary(items)
    completed = summary["completed"]
    progress = round((completed + summary["failed"]) * 100 / summary["total"]) if summary["total"] else 0
    return {
        "batch_id": str(batch.get("batch_id")),
        "status": batch.get("status"),
        **summary,
        "progress": progress,
        "current_image": batch.get("current_index"),
        "images": items,
    }


@router.post("/", status_code=202)
async def convert_images(request: Request) -> JSONResponse:
    settings = get_settings()
    request_size = _request_size(request)
    if request_size is not None and request_size > settings.converter_max_request_bytes:
        raise ConverterRequestError(
            "batch_too_large",
            "This batch exceeds the configured total upload size.",
        )
    try:
        form = await request.form(
            max_files=settings.converter_max_files,
            max_fields=4,
            max_part_size=settings.converter_max_file_bytes,
        )
    except MultiPartException as error:
        raise ConverterRequestError(
            "invalid_batch",
            "The upload request is too large or contains too many files.",
        ) from error
    uploads = [
        value
        for key, value in form.multi_items()
        if key in {"file", "files"} and isinstance(value, UploadFile)
    ]
    if not uploads:
        raise ConverterRequestError("no_files", "Choose at least one image file.")
    if len(uploads) > settings.converter_max_files:
        raise ConverterRequestError("batch_too_many_files", "This batch contains too many files.")

    batch_id = secrets.token_urlsafe(24)
    used_names: set[str] = set()
    items: list[dict[str, Any]] = []
    for index, upload in enumerate(uploads):
        original_name = upload.filename or f"image-{index + 1}"
        items.append(
            {
                "index": index,
                "file_id": secrets.token_urlsafe(18),
                "original_name": original_name,
                "original_size": 0,
                "output_name": output_filename(original_name, used_names),
                "status": "waiting",
                "converted_size": None,
                "reduction_bytes": None,
                "reduction_percent": None,
                "error": None,
            }
        )

    await create_batch(
        batch_id,
        {
            "batch_id": batch_id,
            "status": "queued",
            "created_at": time.time(),
            "current_index": None,
            "processed": 0,
            "file_ids": [str(item["file_id"]) for item in items],
            "items": [_item_view(item) for item in items],
        },
    )
    total_bytes = 0
    try:
        for item, upload in zip(items, uploads, strict=True):
            data = await upload.read(settings.converter_max_file_bytes + 1)
            await upload.close()
            if len(data) > settings.converter_max_file_bytes:
                raise ConverterRequestError(
                    "file_too_large",
                    f"Images must be {settings.converter_max_file_bytes // (1024 * 1024)} MiB or smaller.",
                )
            total_bytes += len(data)
            if total_bytes > settings.converter_max_request_bytes:
                raise ConverterRequestError(
                    "batch_too_large",
                    "This batch exceeds the configured total upload size.",
                )
            if total_bytes > settings.converter_max_batch_memory_bytes:
                raise ConverterRequestError(
                    "batch_memory_limit",
                    "This batch exceeds the configured temporary storage limit.",
                )
            item["original_size"] = len(data)
            file_id = str(item["file_id"])
            await create_file(batch_id, file_id, _item_view(item))
            await save_original(batch_id, file_id, data)
        await update_batch(
            batch_id,
            {"items": [_item_view(value) for value in items]},
        )
        await asyncio.to_thread(
            celery_app.send_task,
            "pns.tasks.convert_image_batch",
            args=[batch_id],
            task_id=f"converter-{batch_id}",
            queue="pns-converter",
        )
    except (ConverterRequestError, ConverterStorageError, OperationalError, RedisError) as error:
        try:
            await delete_batch(batch_id)
        except ConverterStorageError:
            logger.exception("Could not clean up converter batch %s after enqueue failure.", batch_id)
        if isinstance(error, (ConverterRequestError, ConverterStorageError)):
            raise
        raise ConverterRequestError(
            "queue_unavailable",
            "The conversion queue is temporarily unavailable. Please try again.",
            503,
        ) from error
    except (OSError, TimeoutError) as error:
        try:
            await delete_batch(batch_id)
        except ConverterStorageError:
            logger.exception("Could not clean up converter batch %s after upload failure.", batch_id)
        raise ConverterRequestError(
            "upload_failed",
            "The files could not be stored for conversion.",
            503,
        ) from error

    batch = await get_batch(batch_id)
    if batch is None:
        raise ConverterRequestError("batch_expired", "The conversion batch expired unexpectedly.", 503)
    return JSONResponse(
        {
            "batch_id": batch_id,
            "status": "queued",
            "total_images": len(items),
            "message": "Conversion batch created successfully",
        },
        status_code=202,
    )


@router.get("/{batch_id}/status")
async def conversion_status(batch_id: str) -> JSONResponse:
    batch = await get_batch(batch_id)
    if batch is None:
        raise ConverterRequestError("batch_expired", "This conversion batch has expired.", 404)
    return JSONResponse(_batch_response(batch))


@router.get("/{batch_id}/files/{file_id}")
async def download_file(batch_id: str, file_id: str) -> Response:
    batch = await get_batch(batch_id)
    if batch is None or file_id not in batch.get("file_ids", []):
        raise ConverterRequestError("invalid_file", "The conversion file was not found.", 404)
    metadata = await get_file(batch_id, file_id)
    if metadata is None or metadata.get("status") != "completed":
        raise ConverterRequestError("file_not_ready", "The converted file is not available.", 404)
    data = await get_file_data(batch_id, file_id)
    if data is None:
        raise ConverterRequestError("file_not_ready", "The converted file is not available.", 404)
    filename = str(metadata.get("output_name") or "converted.webp")
    return Response(
        content=data,
        media_type="image/webp",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{batch_id}/download-all")
async def download_all(batch_id: str) -> Response:
    batch = await get_batch(batch_id)
    if batch is None:
        raise ConverterRequestError("batch_expired", "This conversion batch has expired.", 404)
    completed_items = [item for item in batch.get("items", []) if item.get("status") == "completed"]
    if not completed_items:
        raise ConverterRequestError(
            "no_downloads",
            "No converted images are available yet.",
            409,
        )
    archive = io.BytesIO()
    try:
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as output:
            for item in completed_items:
                file_id = str(item["file_id"])
                data = await get_file_data(batch_id, file_id)
                if data is None:
                    raise ConverterStorageError("A converted file is no longer available.")
                output.writestr(str(item.get("output_name") or f"{file_id}.webp"), data)
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        logger.exception("Could not create ZIP archive for converter batch %s.", batch_id)
        raise ConverterRequestError(
            "zip_creation_failed",
            "The converted images could not be packaged into a ZIP archive.",
            500,
        ) from error
    return Response(
        content=archive.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="converted-images.zip"'},
    )


@router.delete("/{batch_id}")
async def cleanup_batch(batch_id: str) -> JSONResponse:
    batch = await get_batch(batch_id)
    if batch is None:
        raise ConverterRequestError("batch_expired", "This conversion batch has expired.", 404)
    cancelled = await cancel_batch(batch_id)
    return JSONResponse({"success": True, **_batch_response(cancelled)})
