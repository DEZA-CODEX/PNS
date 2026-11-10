from __future__ import annotations

import asyncio
import io
import logging
import re
import uuid
from pathlib import Path
from urllib.parse import urlsplit

from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.ext.asyncio import AsyncSession

try:
    import pillow_avif  # noqa: F401
except ImportError:
    pillow_avif = None

from app.core.config import get_settings
from app.core.exceptions import ImageManagementError
from app.services.image_storage import (
    delete_object,
    get_object,
    managed_object_path,
    resolve_object_url,
    upload_object,
)
from app.repositories.image_repository import (
    disable_bundled_image,
    disable_managed_image,
    get_managed_image,
    get_managed_image_content,
    list_about_managed_images,
    list_collection_managed_images,
    list_homepage_managed_images,
    list_managed_images,
    save_managed_image,
    update_managed_image,
)

ROOM_CATEGORIES = {"vajra", "garuda", "arohana", "madhurya", "maayukha"}
DINING_CATEGORIES = {"vrindavan", "cloud9", "clinq"}
SUPPORTED_FORMATS = {"JPEG", "PNG", "WEBP", "GIF", "TIFF", "BMP", "AVIF"}
logger = logging.getLogger("pns.image_service")


def validate_collection_category(collection: str, category: str) -> None:
    allowed = ROOM_CATEGORIES if collection == "room" else DINING_CATEGORIES
    if category not in allowed:
        raise ImageManagementError(
            "invalid_category", "The selected image category is invalid.", 400
        )


def _normalized_filename(value: str) -> str:
    base = Path(value).stem
    cleaned = re.sub(r"-{2,}", "-", re.sub(r"[^a-zA-Z0-9._-]+", "-", base)).strip("-")
    return cleaned or "image"


def _process_image(data: bytes, filename: str) -> tuple[bytes, str, bool]:
    settings = get_settings()
    if not data:
        raise ImageManagementError("empty_file", "Choose a non-empty image file.", 400)
    if len(data) > settings.max_upload_bytes:
        raise ImageManagementError("file_too_large", "Images must be 8 MB or smaller.", 400)
    try:
        with Image.open(io.BytesIO(data)) as image:
            image_format = (image.format or "").upper()
            if image_format not in SUPPORTED_FORMATS:
                raise ImageManagementError(
                    "invalid_file_type",
                    "Use a JPEG, PNG, WebP, GIF, TIFF, BMP, or AVIF image.",
                    400,
                )
            if getattr(image, "n_frames", 1) > 1:
                raise ImageManagementError(
                    "animated_image_unsupported",
                    "Animated uploads are not supported. Please use a static image file.",
                    400,
                )
            width, height = image.size
            if width * height > settings.max_image_pixels:
                raise ImageManagementError(
                    "image_too_large",
                    "The uploaded image exceeds the allowed pixel dimensions.",
                    400,
                )
            processed = ImageOps.exif_transpose(image.copy())
            output = io.BytesIO()
            converted = image_format != "WEBP"
            if converted:
                if processed.mode not in {"RGB", "RGBA"}:
                    processed = processed.convert("RGBA" if "A" in processed.getbands() else "RGB")
                processed.save(output, format="WEBP", quality=82, method=6)
                processed_data = output.getvalue()
            else:
                processed_data = data
            with Image.open(io.BytesIO(processed_data)) as generated:
                if generated.format != "WEBP" or generated.width * generated.height > settings.max_image_pixels:
                    raise ImageManagementError(
                        "invalid_converted_image", "The converted WebP image is invalid.", 422
                    )
                generated.verify()
            logger.info(
                "Processed image upload (input_format=%s, input_bytes=%d, output_bytes=%d, converted=%s).",
                image_format,
                len(data),
                len(processed_data),
                converted,
            )
            return (
                processed_data,
                f"{uuid.uuid4()}-{_normalized_filename(filename)}.webp",
                converted,
            )
    except ImageManagementError:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise ImageManagementError(
            "invalid_image", "The uploaded image could not be processed.", 400
        ) from error


async def list_images(
    db: AsyncSession, collection: str, category: str, display_location: str | None = None
) -> tuple[list[dict], list[str]]:
    validate_collection_category(collection, category)
    images, hidden_ids = await list_managed_images(db, collection, category, display_location)
    await _resolve_storage_image_urls(images, collection, category)
    return images, hidden_ids


async def _resolve_storage_image_urls(
    images: list[dict], collection: str, category: str
) -> None:
    for image in images:
        if (
            image.get("sourceType") != "upload"
            or not image.get("path")
            or image.get("url")
        ):
            continue
        path = managed_object_path(collection, category, str(image["path"]))
        image["url"] = await resolve_object_url(path)


async def list_homepage_images(db: AsyncSession) -> dict:
    result = await list_homepage_managed_images(db)
    for collection, categories in result["images"].items():
        for category, images in categories.items():
            await _resolve_storage_image_urls(images, collection, category)
    return result


async def list_about_images(db: AsyncSession) -> dict:
    result = await list_about_managed_images(db)
    for collection, categories in result["images"].items():
        for category, images in categories.items():
            await _resolve_storage_image_urls(images, collection, category)
    return result


async def list_section_images(
    db: AsyncSession, collection: str, categories: tuple[str, ...]
) -> dict:
    result = await list_collection_managed_images(db, collection, categories)
    for category, images in result["images"].items():
        await _resolve_storage_image_urls(images, collection, category)
    return result


async def add_external_image(
    db: AsyncSession,
    collection: str,
    category: str,
    image_url: str,
    created_by: str,
) -> dict:
    validate_collection_category(collection, category)
    try:
        parsed = urlsplit(image_url)
        _ = parsed.port
    except ValueError as error:
        raise ImageManagementError("invalid_url", "Enter a valid HTTP or HTTPS image URL.", 400) from error
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or any(character.isspace() for character in image_url)
    ):
        raise ImageManagementError("invalid_url", "Enter a valid HTTP or HTTPS image URL.", 400)
    return await save_managed_image(
        db,
        collection=collection,
        category=category,
        url=image_url,
        storage_path=None,
        source_type="external",
        created_by=created_by,
    )


async def add_uploaded_image(
    db: AsyncSession,
    collection: str,
    category: str,
    filename: str,
    data: bytes,
    created_by: str,
) -> dict:
    validate_collection_category(collection, category)
    processed_data, stored_name, converted = await asyncio.to_thread(
        _process_image, data, filename
    )
    storage_path = managed_object_path(
        collection, category, f"uploads/{collection}/{category}/{stored_name}"
    )
    logger.info(
        "Starting managed image upload (collection=%s, category=%s, path=%s).",
        collection,
        category,
        storage_path,
    )
    resolved_url = await upload_object(storage_path, processed_data)
    public_url = resolved_url if get_settings().supabase_storage_public else ""
    try:
        row = await save_managed_image(
            db,
            collection=collection,
            category=category,
            url=public_url,
            storage_path=storage_path,
            source_type="upload",
            created_by=created_by,
            image_data=None,
            content_type="image/webp",
        )
    except Exception:
        try:
            await delete_object(storage_path)
        except ImageManagementError:
            logger.exception("Could not clean up an image object after metadata persistence failed.")
        raise
    logger.info(
        "Saved managed image metadata (collection=%s, category=%s, image_id=%s).",
        collection,
        category,
        row.get("id", "unknown"),
    )
    row["url"] = resolved_url
    row["_converted"] = converted
    return row


async def image_content(db: AsyncSession, image_id: str) -> dict | None:
    image = await get_managed_image_content(db, image_id)
    if image is None or image.get("image_data") is not None:
        return image
    if image.get("source_type") != "upload":
        return None
    if not image.get("storage_path") or not image.get("category_type") or not image.get("category_id"):
        return None
    path = managed_object_path(
        str(image["category_type"]), str(image["category_id"]), str(image["storage_path"])
    )
    data = await get_object(path)
    if data is None:
        return None
    image["image_data"] = data
    image["content_type"] = image.get("content_type") or "image/webp"
    return image


async def delete_managed_image(
    db: AsyncSession,
    collection: str,
    category: str,
    image_id: str,
) -> dict | None:
    validate_collection_category(collection, category)
    row = await get_managed_image(db, collection, category, image_id)
    if row is not None:
        is_storage_image = (
            row.get("source_type") == "upload"
            and not row.get("has_database_content")
            and row.get("content_type") == "image/webp"
            and row.get("storage_path")
        )
        if is_storage_image:
            if not row.get("is_active", True):
                raise ImageManagementError(
                    "not_found", "The image was not found in this category.", 404
                )
            storage_path = managed_object_path(
                collection, category, str(row["storage_path"])
            )
            backup = await get_object(storage_path)
            if backup is None:
                raise ImageManagementError(
                    "storage_object_missing",
                    "The uploaded image record points to a missing Supabase Storage object.",
                    502,
                )
            updated = await disable_managed_image(db, image_id, collection, category)
            if updated is None:
                raise ImageManagementError(
                    "not_found", "The image was not found in this category.", 404
                )
            await delete_object(storage_path)
            logger.info(
                "Disabled managed image and removed Storage object (collection=%s, category=%s, image_id=%s).",
                collection,
                category,
                image_id,
            )
            return {"storage_path": storage_path, "backup": backup}
        if not row.get("is_active", True):
            raise ImageManagementError(
                "not_found", "The image was not found in this category.", 404
            )
        updated = await disable_managed_image(db, image_id, collection, category)
        if updated is None:
            raise ImageManagementError(
                "not_found", "The image was not found in this category.", 404
            )
        return None
    if not image_id.startswith(f"{category}:"):
        raise ImageManagementError("not_found", "The image was not found in this category.", 404)
    await disable_bundled_image(db, image_id, collection, category)
    return None


async def patch_image(
    db: AsyncSession, collection: str, image_id: str, patch: dict
) -> dict | None:
    return await update_managed_image(db, collection, image_id, patch)
