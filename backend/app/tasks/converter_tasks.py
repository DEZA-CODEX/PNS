from __future__ import annotations

import logging
from typing import Any

from celery.exceptions import MaxRetriesExceededError

from app.celery_app import celery_app
from app.core.config import get_settings
from app.services.converter_service import ConverterImageError, convert_image
from app.services.converter_storage import (
    ConverterStorageError,
    sync_cleanup_orphans,
    sync_get_batch,
    sync_get_file,
    sync_get_original,
    sync_release_active_batch,
    sync_save_result,
    sync_update_batch,
    sync_update_file,
)

logger = logging.getLogger("pns.tasks.converter")


def _summary(items: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "total": len(items),
        "completed": sum(item.get("status") == "completed" for item in items),
        "failed": sum(item.get("status") == "failed" for item in items),
        "processing": sum(item.get("status") == "processing" for item in items),
        "waiting": sum(item.get("status") == "waiting" for item in items),
    }


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


def _update_batch_items(batch_id: str, items: list[dict[str, Any]], **updates: Any) -> None:
    summary = _summary(items)
    sync_update_batch(
        batch_id,
        {
            **updates,
            "items": [_item_view(item) for item in items],
            **summary,
        },
    )


@celery_app.task(
    bind=True,
    name="pns.tasks.convert_image_batch",
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=3,
    default_retry_delay=5,
)
def convert_image_batch(task: Any, batch_id: str) -> dict[str, Any]:
    try:
        batch = sync_get_batch(batch_id)
        if batch is None:
            return {"batch_id": batch_id, "status": "expired"}
        if batch.get("status") == "cancelled":
            return {"batch_id": batch_id, "status": "cancelled"}

        items = list(batch.get("items", []))
        sync_update_batch(batch_id, {"status": "processing", "current_index": None})
        for index, file_id_value in enumerate(batch.get("file_ids", [])):
            file_id = str(file_id_value)
            latest_batch = sync_get_batch(batch_id)
            if latest_batch is None or latest_batch.get("status") == "cancelled":
                return {"batch_id": batch_id, "status": "cancelled"}
            item = next((value for value in items if value.get("file_id") == file_id), None)
            if item is None:
                continue

            stored_file = sync_get_file(batch_id, file_id)
            if stored_file and stored_file.get("status") == "completed":
                item.update(stored_file)
                continue
            if stored_file and stored_file.get("status") == "failed":
                item.update(stored_file)
                continue

            original = sync_get_original(batch_id, file_id)
            if original is None:
                item.update(
                    {
                        "status": "failed",
                        "error": "The original upload is no longer available.",
                    }
                )
                sync_update_file(batch_id, file_id, _item_view(item))
                _update_batch_items(batch_id, items, current_index=index, processed=index + 1)
                continue

            item["status"] = "processing"
            item["error"] = None
            sync_update_file(batch_id, file_id, _item_view(item))
            _update_batch_items(batch_id, items, current_index=index)
            try:
                converted = convert_image(original, get_settings())
            except ConverterImageError as error:
                item.update({"status": "failed", "error": error.message})
                sync_update_file(batch_id, file_id, _item_view(item))
            except (OSError, ValueError):
                item.update(
                    {
                        "status": "failed",
                        "error": "The image could not be converted to WebP.",
                    }
                )
                sync_update_file(batch_id, file_id, _item_view(item))
            else:
                item.update(
                    {
                        "status": "completed",
                        "converted_size": len(converted),
                        "reduction_bytes": int(item.get("original_size") or len(original))
                        - len(converted),
                        "reduction_percent": round(
                            (
                                (int(item.get("original_size") or len(original)) - len(converted))
                                * 100
                                / int(item.get("original_size") or len(original))
                            ),
                            1,
                        ),
                        "error": None,
                    }
                )
                sync_save_result(batch_id, file_id, _item_view(item), converted)
            _update_batch_items(batch_id, items, current_index=index, processed=index + 1)

        final_summary = _summary(items)
        sync_update_batch(
            batch_id,
            {
                "status": "completed",
                "current_index": None,
                "processed": final_summary["completed"] + final_summary["failed"],
                **final_summary,
                "items": [_item_view(item) for item in items],
            },
        )
        sync_release_active_batch(batch_id)
        return {"batch_id": batch_id, "status": "completed", **final_summary}
    except ConverterStorageError as error:
        logger.warning("Converter batch %s storage failure; retrying.", batch_id)
        try:
            raise task.retry(exc=error, countdown=min(60, 5 * (task.request.retries + 1)))
        except MaxRetriesExceededError:
            logger.error("Converter batch %s exhausted storage retries.", batch_id)
            raise


@celery_app.task(
    name="pns.tasks.cleanup_converter_batches",
    queue="pns-maintenance",
)
def cleanup_converter_batches() -> dict[str, int]:
    deleted = sync_cleanup_orphans()
    return {"deleted_keys": deleted}
