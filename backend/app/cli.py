from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path, PurePosixPath

from sqlalchemy import text

from app.core.config import get_settings
from app.core.database import get_engine
from app.core.security import hash_password


async def _database():
    engine = get_engine()
    if engine is None:
        raise RuntimeError("Set DATABASE_URL to the existing Supabase PostgreSQL database.")
    return engine


async def bootstrap_superadmin() -> None:
    email = os.getenv("INITIAL_SUPERADMIN_EMAIL", "").strip().lower()
    password = os.getenv("INITIAL_SUPERADMIN_PASSWORD", "")
    if not email or not password or len(password) < 8:
        raise RuntimeError(
            "Set INITIAL_SUPERADMIN_EMAIL and a password of at least 8 characters."
        )
    engine = await _database()
    async with engine.begin() as connection:
        existing = await connection.execute(
            text("SELECT id FROM public.super_admins WHERE lower(email) = :email LIMIT 1"),
            {"email": email},
        )
        if existing.first():
            print("Super Admin already exists; no password was changed.")
            return
        await connection.execute(
            text(
                """
                INSERT INTO public.super_admins (email, password_hash, is_active)
                VALUES (:email, :password_hash, true)
                """
            ),
            {"email": email, "password_hash": hash_password(password)},
        )
    print(f"Super Admin bootstrap completed for {email}.")


def _legacy_image_path(upload_root: Path, storage_path: str) -> Path:
    normalized = storage_path.lstrip("/")
    if normalized.startswith("uploads/"):
        normalized = normalized.removeprefix("uploads/")
    relative = PurePosixPath(normalized)
    if relative.is_absolute() or any(part in {"", ".", ".."} for part in relative.parts):
        raise RuntimeError(f"Unsafe legacy image path in database: {storage_path}")
    root = upload_root.resolve()
    image_path = (root / Path(*relative.parts)).resolve()
    try:
        image_path.relative_to(root)
    except ValueError as error:
        raise RuntimeError(f"Legacy image path escapes upload directory: {storage_path}") from error
    return image_path


async def migrate_image_files(upload_root: Path) -> None:
    engine = await _database()
    migrated = 0
    async with engine.begin() as connection:
        result = await connection.execute(
            text(
                """
                SELECT id, storage_path
                  FROM public.managed_images
                 WHERE source_type = 'upload'
                   AND image_data IS NULL
                   AND storage_path IS NOT NULL
                 ORDER BY id
                """
            )
        )
        rows = result.mappings().all()
        for row in rows:
            path = _legacy_image_path(upload_root, str(row["storage_path"]))
            try:
                data = await asyncio.to_thread(path.read_bytes)
            except OSError as error:
                raise RuntimeError(f"Could not read legacy image for database row {row['id']}.") from error
            if not data:
                raise RuntimeError(f"Legacy image for database row {row['id']} is empty.")
            await connection.execute(
                text(
                    """
                    UPDATE public.managed_images
                       SET image_data = :image_data, content_type = 'image/webp'
                     WHERE id = :image_id AND image_data IS NULL
                    """
                ),
                {"image_data": data, "image_id": row["id"]},
            )
            migrated += 1
    print(f"Migrated {migrated} uploaded image(s) into PostgreSQL; source files were retained.")


async def main() -> None:
    parser = argparse.ArgumentParser(description="PNS FastAPI backend management commands.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("bootstrap-superadmin")
    image_parser = subparsers.add_parser("migrate-image-files")
    image_parser.add_argument(
        "--upload-dir",
        type=Path,
        default=Path(get_settings().image_storage_dir),
        help="Directory containing legacy uploaded files (defaults to PNS_IMAGE_STORAGE_DIR).",
    )
    args = parser.parse_args()
    try:
        if args.command == "bootstrap-superadmin":
            await bootstrap_superadmin()
        else:
            await migrate_image_files(args.upload_dir)
    finally:
        engine = get_engine()
        if engine:
            await engine.dispose()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(f"Backend command failed: {error}", file=sys.stderr)
        sys.exit(1)
