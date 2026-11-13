from __future__ import annotations

import io
import re
import warnings
from importlib import import_module
from pathlib import PurePath

from PIL import Image, ImageOps, UnidentifiedImageError

def _load_avif_plugin() -> None:
    try:
        import_module("pillow_avif")
    except ImportError:
        return


_load_avif_plugin()

from app.core.config import Settings, get_settings

SUPPORTED_FORMATS = {"JPEG", "PNG", "WEBP", "GIF", "TIFF", "BMP", "AVIF"}


class ConverterImageError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _safe_stem(filename: str) -> str:
    basename = filename.replace("\\", "/").rsplit("/", 1)[-1]
    stem = PurePath(basename).stem
    cleaned = re.sub(r"-{2,}", "-", re.sub(r"[^a-zA-Z0-9._-]+", "-", stem)).strip("-._")
    return cleaned or "image"


def output_filename(filename: str, used_names: set[str]) -> str:
    stem = _safe_stem(filename)
    candidate = f"{stem}.webp"
    suffix = 2
    while candidate.casefold() in used_names:
        candidate = f"{stem}-{suffix}.webp"
        suffix += 1
    used_names.add(candidate.casefold())
    return candidate


def _image_error(error: Exception) -> ConverterImageError:
    if isinstance(error, UnidentifiedImageError):
        return ConverterImageError("invalid_image", "The file is not a valid image.")
    if isinstance(error, (Image.DecompressionBombError, Image.DecompressionBombWarning)):
        return ConverterImageError(
            "image_too_large",
            "The image exceeds the allowed pixel dimensions.",
        )
    return ConverterImageError("conversion_failed", "The image could not be converted to WebP.")


def convert_image(data: bytes, settings: Settings | None = None) -> bytes:
    config = settings or get_settings()
    if not data:
        raise ConverterImageError("empty_file", "The file is empty.")
    if len(data) > config.converter_max_file_bytes:
        raise ConverterImageError(
            "file_too_large",
            f"Images must be {config.converter_max_file_bytes // (1024 * 1024)} MiB or smaller.",
        )

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                image_format = (image.format or "").upper()
                if image_format not in SUPPORTED_FORMATS:
                    raise ConverterImageError(
                        "unsupported_format",
                        "Use a JPEG, PNG, WebP, GIF, TIFF, BMP, or AVIF image.",
                    )
                if getattr(image, "n_frames", 1) > 1:
                    raise ConverterImageError(
                        "animated_image_unsupported",
                        "Animated images are not supported.",
                    )
                width, height = image.size
                if width * height > config.converter_max_image_pixels:
                    raise ConverterImageError(
                        "image_too_large",
                        "The image exceeds the allowed pixel dimensions.",
                    )
                image.load()
                processed = ImageOps.exif_transpose(image.copy())
                if processed.mode not in {"RGB", "RGBA"}:
                    processed = processed.convert(
                        "RGBA" if "A" in processed.getbands() else "RGB"
                    )
                output = io.BytesIO()
                processed.save(
                    output,
                    format="WEBP",
                    quality=config.converter_webp_quality,
                    method=config.converter_webp_method,
                )
                processed.close()

        converted = output.getvalue()
        with Image.open(io.BytesIO(converted)) as generated:
            if generated.format != "WEBP":
                raise ConverterImageError(
                    "invalid_converted_image",
                    "The converted image is not a valid WebP file.",
                )
            if generated.width * generated.height > config.converter_max_image_pixels:
                raise ConverterImageError(
                    "invalid_converted_image",
                    "The converted image exceeds the allowed pixel dimensions.",
                )
            generated.verify()
        return converted
    except ConverterImageError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise _image_error(error) from error
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise _image_error(error) from error
