from __future__ import annotations

import asyncio
import io
import logging
import re
import uuid
from pathlib import Path, PurePosixPath
from urllib.parse import quote, urlsplit

import httpx
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.ext.asyncio import AsyncSession

try:
    import pillow_avif  # noqa: F401
except ImportError:
    pillow_avif = None

from app.core.config import get_settings
from app.core.exceptions import ImageManagementError, ServiceUnavailableError
from app.repositories.image_repository import (
    disable_bundled_image,
    disable_managed_image,
    get_managed_image,
    list_managed_images,
    save_managed_image,
    update_managed_image,
)

logger = logging.getLogger("pns.images")

ROOM_CATEGORIES = {"vajra", "garuda", "arohana", "madhurya", "maayukha"}
DINING_CATEGORIES = {"vrindavan", "cloud9", "clinq"}
SUPPORTED_FORMATS = {"JPEG", "PNG", "WEBP", "GIF", "TIFF", "BMP", "AVIF"}
MIME_TYPES = {
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "WEBP": "image/webp",
    "GIF": "image/gif",
    "TIFF": "image/tiff",
    "BMP": "image/bmp",
    "AVIF": "image/avif",
}


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


class ImageStorage:
    def __init__(self) -> None:
        self.settings = get_settings()

    def _safe_relative_path(self, storage_path: str) -> PurePosixPath:
        normalized = storage_path.lstrip("/")
        if normalized.startswith("uploads/"):
            normalized = normalized.removeprefix("uploads/")
        path = PurePosixPath(normalized)
        if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
            raise ImageManagementError("invalid_storage_path", "The image storage path is invalid.", 500)
        return path

    def _local_path(self, storage_path: str) -> Path:
        root = Path(self.settings.image_storage_dir).resolve()
        destination = (root / Path(*self._safe_relative_path(storage_path).parts)).resolve()
        try:
            destination.relative_to(root)
        except ValueError as error:
            raise ImageManagementError(
                "invalid_storage_path", "The image storage path is invalid.", 500
            ) from error
        return destination

    def _remote_url(self, storage_path: str) -> str:
        if not self.settings.storage_bucket or not self.settings.supabase_url:
            raise ServiceUnavailableError(
                "Supabase Storage is selected but its URL or bucket is not configured."
            )
        return (
            f"{self.settings.supabase_url}/storage/v1/object/"
            f"{quote(self.settings.storage_bucket, safe='')}/"
            f"{quote(str(self._safe_relative_path(storage_path)), safe='/')}"
        )

    def _headers(self) -> dict[str, str]:
        if not self.settings.supabase_service_key:
            raise ServiceUnavailableError("The private Supabase Storage key is not configured.")
        return {
            "apikey": self.settings.supabase_service_key,
            "Authorization": f"Bearer {self.settings.supabase_service_key}",
        }

    def public_url(self, storage_path: str) -> str:
        if self.settings.image_storage_backend == "supabase":
            base = self._remote_url(storage_path)
            return base.replace("/storage/v1/object/", "/storage/v1/object/public/", 1)
        return f"/{storage_path}"

    async def put(self, storage_path: str, data: bytes, content_type: str) -> None:
        if self.settings.image_storage_backend == "supabase":
            url = self._remote_url(storage_path)
            headers = self._headers()
            headers.update({"Content-Type": content_type, "x-upsert": "false"})
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(url, content=data, headers=headers)
            if response.status_code not in {200, 201}:
                logger.error("Supabase Storage upload failed with status %s", response.status_code)
                raise ImageManagementError(
                    "storage_error", "The image could not be written to persistent storage.", 502
                )
            return
        destination = self._local_path(storage_path)
        await asyncio.to_thread(destination.parent.mkdir, parents=True, exist_ok=True)
        temporary = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.tmp")
        try:
            await asyncio.to_thread(temporary.write_bytes, data)
            await asyncio.to_thread(temporary.replace, destination)
        except OSError as error:
            await asyncio.to_thread(temporary.unlink, missing_ok=True)
            raise ImageManagementError(
                "storage_error", "The image could not be written to persistent storage.", 500
            ) from error

    async def get_existing(self, storage_path: str, public_url: str | None) -> bytes | None:
        is_remote = (
            self.settings.storage_bucket
            and public_url
            and f"/storage/v1/object/public/{self.settings.storage_bucket}/" in public_url
        )
        if is_remote:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(self._remote_url(storage_path), headers=self._headers())
            if response.status_code == 404:
                return None
            if response.status_code != 200:
                raise ImageManagementError(
                    "storage_error", "The image could not be read from persistent storage.", 502
                )
            return response.content
        path = self._local_path(storage_path)
        try:
            return await asyncio.to_thread(path.read_bytes)
        except FileNotFoundError:
            return None
        except OSError as error:
            raise ImageManagementError(
                "storage_error", "The image could not be read from persistent storage.", 500
            ) from error

    async def remove(self, storage_path: str, public_url: str | None) -> bytes | None:
        is_remote = (
            self.settings.storage_bucket
            and public_url
            and f"/storage/v1/object/public/{self.settings.storage_bucket}/" in public_url
        )
        previous = await self.get_existing(storage_path, public_url)
        if previous is None:
            return None
        if is_remote:
            url = (
                f"{self.settings.supabase_url}/storage/v1/object/"
                f"{quote(self.settings.storage_bucket or '', safe='')}"
            )
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.delete(
                    url,
                    json={"prefixes": [str(self._safe_relative_path(storage_path))]},
                    headers=self._headers(),
                )
            if response.status_code not in {200, 204}:
                logger.error("Supabase Storage delete failed with status %s", response.status_code)
                raise ImageManagementError(
                    "storage_error", "The image could not be removed from persistent storage.", 502
                )
        else:
            path = self._local_path(storage_path)
            try:
                await asyncio.to_thread(path.unlink)
            except FileNotFoundError:
                return None
            except OSError as error:
                raise ImageManagementError(
                    "storage_error", "The image could not be removed from persistent storage.", 500
                ) from error
        return previous


image_storage = ImageStorage()


def public_image_url(url: str, updated_at: object, image_id: object) -> str:
    if not url:
        return url
    version = str(updated_at or image_id)
    version = "".join(character for character in version if character.isalnum() or character in "_-")
    separator = "&" if "?" in url else "?"
    return f"{url}{separator}v={version}" if version else url


async def list_images(
    db: AsyncSession, collection: str, category: str, display_location: str | None = None
) -> tuple[list[dict], list[str]]:
    validate_collection_category(collection, category)
    images, hidden_ids = await list_managed_images(
        db, collection, category, display_location
    )
    return images, hidden_ids


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
    row = await save_managed_image(
        db,
        collection=collection,
        category=category,
        url=image_url,
        storage_path=None,
        source_type="external",
        created_by=created_by,
    )
    return row


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
    storage_path = f"uploads/{collection}/{category}/{stored_name}"
    await image_storage.put(storage_path, processed_data, "image/webp")
    try:
        row = await save_managed_image(
            db,
            collection=collection,
            category=category,
            url=image_storage.public_url(storage_path),
            storage_path=storage_path,
            source_type="upload",
            created_by=created_by,
        )
        return row
    except Exception:
        try:
            await image_storage.remove(storage_path, image_storage.public_url(storage_path))
        except Exception:
            logger.exception("Upload compensation failed for storage path %s", storage_path)
        raise


async def delete_managed_image(
    db: AsyncSession,
    collection: str,
    category: str,
    image_id: str,
) -> tuple[str, bytes] | None:
    validate_collection_category(collection, category)
    row = await get_managed_image(db, collection, category, image_id)
    if row is not None:
        removed: bytes | None = None
        if row["source_type"] == "upload" and row.get("storage_path"):
            removed = await image_storage.remove(row["storage_path"], row.get("public_url"))
        try:
            updated = await disable_managed_image(db, image_id, collection, category)
            if updated is None:
                raise ImageManagementError(
                    "not_found", "The image was not found in this category.", 404
                )
        except Exception:
            if removed is not None and row.get("storage_path"):
                try:
                    content_type = "image/webp"
                    await image_storage.put(row["storage_path"], removed, content_type)
                except Exception:
                    logger.exception(
                        "Image delete compensation failed for storage path %s",
                        row["storage_path"],
                    )
            raise
        return (str(row["storage_path"]), removed) if removed is not None else None

    if not image_id.startswith(f"{category}:"):
        raise ImageManagementError("not_found", "The image was not found in this category.", 404)
    await disable_bundled_image(db, image_id, collection, category)
    return None


async def restore_deleted_image(deleted_file: tuple[str, bytes]) -> None:
    storage_path, data = deleted_file
    await image_storage.put(storage_path, data, "image/webp")


async def patch_image(
    db: AsyncSession, collection: str, image_id: str, patch: dict
) -> dict | None:
    return await update_managed_image(db, collection, image_id, patch)
