from __future__ import annotations

import logging
from dataclasses import dataclass
from urllib.parse import quote, urlsplit

import httpx

from app.core.config import get_settings
from app.core.exceptions import ImageManagementError

logger = logging.getLogger("pns.image_storage")
_TIMEOUT_SECONDS = 20.0


@dataclass(frozen=True)
class StorageSettings:
    base_url: str
    secret_key: str
    bucket: str
    is_public: bool


def _storage_settings() -> StorageSettings:
    settings = get_settings()
    base_url = (settings.supabase_url or "").strip().rstrip("/")
    secret_key = (settings.supabase_secret_key or "").strip()
    bucket = (settings.supabase_storage_bucket or "").strip()
    if not base_url or not secret_key or not bucket:
        raise ImageManagementError(
            "storage_not_configured",
            "Supabase Storage is not configured. Set SUPABASE_URL, SUPABASE_SECRET_KEY, and SUPABASE_STORAGE_BUCKET in the backend environment.",
            503,
        )
    try:
        parsed = urlsplit(base_url)
        _ = parsed.port
    except ValueError as error:
        raise ImageManagementError(
            "storage_not_configured", "SUPABASE_URL is invalid.", 503
        ) from error
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        raise ImageManagementError(
            "storage_not_configured", "SUPABASE_URL must be an HTTP(S) origin.", 503
        )
    if (
        not bucket
        or "/" in bucket
        or "\\" in bucket
        or any(character.isspace() or character in "?#" for character in bucket)
        or bucket in {".", ".."}
    ):
        raise ImageManagementError(
            "storage_not_configured", "SUPABASE_STORAGE_BUCKET is invalid.", 503
        )
    return StorageSettings(
        base_url=base_url,
        secret_key=secret_key,
        bucket=bucket,
        is_public=settings.supabase_storage_public,
    )


def managed_object_path(collection: str, category: str, path: str) -> str:
    prefix = f"uploads/{collection}/{category}/"
    if (
        not path.startswith(prefix)
        or "\\" in path
        or any(part in {"", ".", ".."} for part in path.split("/"))
        or "/" in path[len(prefix) :]
    ):
        raise ImageManagementError(
            "invalid_storage_path", "The image storage path is invalid.", 400
        )
    return path


def _object_endpoint(config: StorageSettings, path: str) -> str:
    bucket = quote(config.bucket, safe="")
    object_path = quote(path, safe="/")
    return f"{config.base_url}/storage/v1/object/{bucket}/{object_path}"


def public_object_url(path: str) -> str:
    config = _storage_settings()
    return f"{config.base_url}/storage/v1/object/public/{quote(config.bucket, safe='')}/{quote(path, safe='/')}"


def _headers(config: StorageSettings, *, content_type: str | None = None) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {config.secret_key}",
        "apikey": config.secret_key,
    }
    if content_type:
        headers["Content-Type"] = content_type
    return headers


def _storage_failure(response: httpx.Response | None, operation: str) -> ImageManagementError:
    if response is not None and response.status_code in {400, 404}:
        message = "The configured Supabase Storage bucket or object is unavailable. Verify that the bucket exists and the path is correct."
    elif response is not None and response.status_code in {401, 403}:
        message = "Supabase Storage rejected the backend credentials or bucket permissions."
    else:
        message = f"Supabase Storage {operation} failed."
    return ImageManagementError("storage_error", message, 502)


async def _request(
    method: str,
    url: str,
    *,
    headers: dict[str, str],
    content: bytes | None = None,
    json: dict | None = None,
) -> httpx.Response:
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS, follow_redirects=False) as client:
            return await client.request(method, url, headers=headers, content=content, json=json)
    except httpx.RequestError as error:
        logger.warning("Supabase Storage request failed (%s).", type(error).__name__)
        raise ImageManagementError(
            "storage_error", "Supabase Storage could not be reached.", 502
        ) from error


async def get_object(path: str) -> bytes | None:
    config = _storage_settings()
    response = await _request(
        "GET", _object_endpoint(config, path), headers=_headers(config)
    )
    if response.status_code == 404:
        return None
    if response.status_code != 200:
        raise _storage_failure(response, "object retrieval")
    if not response.content:
        raise ImageManagementError(
            "storage_error", "The Supabase Storage object is empty.", 502
        )
    return response.content


async def upload_object(path: str, data: bytes, *, upsert: bool = False) -> str:
    config = _storage_settings()
    endpoint = _object_endpoint(config, path)
    headers = _headers(config, content_type="image/webp")
    headers["x-upsert"] = "true" if upsert else "false"
    logger.info(
        "Uploading image object to Supabase Storage (bucket=%s, path=%s, bytes=%d).",
        config.bucket,
        path,
        len(data),
    )
    response = await _request("POST", endpoint, headers=headers, content=data)
    if response.status_code not in {200, 201}:
        raise _storage_failure(response, "upload")

    verified = await get_object(path)
    if verified != data:
        try:
            await delete_object(path)
        except ImageManagementError:
            logger.exception("Could not clean up an unverified Supabase Storage upload.")
        raise ImageManagementError(
            "storage_verification_failed",
            "Supabase Storage did not return the uploaded image bytes as expected.",
            502,
        )

    if config.is_public:
        url = public_object_url(path)
        public_response = await _request("GET", url, headers={})
        if public_response.status_code != 200 or public_response.content != data:
            try:
                await delete_object(path)
            except ImageManagementError:
                logger.exception("Could not clean up an inaccessible public Storage upload.")
            raise ImageManagementError(
                "storage_verification_failed",
                "The uploaded image is not retrievable from its configured public URL. Verify the bucket's public access setting.",
                502,
            )
        logger.info(
            "Verified public Supabase Storage image object (bucket=%s, path=%s).",
            config.bucket,
            path,
        )
        return url
    logger.info(
        "Verified private Supabase Storage image object (bucket=%s, path=%s).",
        config.bucket,
        path,
    )
    return ""


async def delete_object(path: str) -> None:
    config = _storage_settings()
    response = await _request(
        "DELETE", _object_endpoint(config, path), headers=_headers(config)
    )
    if response.status_code not in {200, 204, 404}:
        raise _storage_failure(response, "object deletion")
    logger.info(
        "Deleted Supabase Storage image object (bucket=%s, path=%s).",
        config.bucket,
        path,
    )


async def restore_object(path: str, data: bytes) -> None:
    await upload_object(path, data, upsert=True)