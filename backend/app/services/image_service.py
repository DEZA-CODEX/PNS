from __future__ import annotations

import asyncio
import io
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
                return output.getvalue(), f"{uuid.uuid4()}-{_normalized_filename(filename)}.webp", True
            return data, f"{uuid.uuid4()}-{_normalized_filename(filename)}.webp", False
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
    return await list_managed_images(db, collection, category, display_location)


async def list_homepage_images(db: AsyncSession) -> dict:
    return await list_homepage_managed_images(db)


async def list_about_images(db: AsyncSession) -> dict:
    return await list_about_managed_images(db)


async def list_section_images(
    db: AsyncSession, collection: str, categories: tuple[str, ...]
) -> dict:
    return await list_collection_managed_images(db, collection, categories)


async def add_external_image(
    db: AsyncSession,
    collection: str,
    category: str,
    image_url: str,
    created_by: str,
) -> dict:
    validate_collection_category(collection, category)
    parsed = urlsplit(image_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
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
    row = await save_managed_image(
        db,
        collection=collection,
        category=category,
        url="",
        storage_path=f"uploads/{collection}/{category}/{stored_name}",
        source_type="upload",
        created_by=created_by,
        image_data=processed_data,
        content_type="image/webp",
    )
    row["_converted"] = converted
    return row


async def image_content(db: AsyncSession, image_id: str) -> dict | None:
    return await get_managed_image_content(db, image_id)


async def delete_managed_image(
    db: AsyncSession,
    collection: str,
    category: str,
    image_id: str,
) -> None:
    validate_collection_category(collection, category)
    row = await get_managed_image(db, collection, category, image_id)
    if row is not None:
        updated = await disable_managed_image(db, image_id, collection, category)
        if updated is None:
            raise ImageManagementError(
                "not_found", "The image was not found in this category.", 404
            )
        return
    if not image_id.startswith(f"{category}:"):
        raise ImageManagementError("not_found", "The image was not found in this category.", 404)
    await disable_bundled_image(db, image_id, collection, category)


async def patch_image(
    db: AsyncSession, collection: str, image_id: str, patch: dict
) -> dict | None:
    return await update_managed_image(db, collection, image_id, patch)
