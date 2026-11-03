from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.core.config import get_engine
from app.core.security import hash_password


def _timestamp(value: Any) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    if isinstance(value, datetime):
        return value
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _uuid(value: Any) -> UUID:
    return UUID(str(value))


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


async def _import_legacy_auth(connection, auth_path: Path) -> None:
    try:
        store = json.loads(auth_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        print("No legacy admin-auth-store.json found; skipping admin auth backup import.")
        return
    users = store.get("users", []) if isinstance(store, dict) else []
    sessions = store.get("sessions", []) if isinstance(store, dict) else []
    events = store.get("audit", []) if isinstance(store, dict) else []
    if not users and not sessions and not events:
        print("Legacy admin auth store is empty; skipping auth backup import.")
        return

    role_result = await connection.execute(
        text("SELECT id FROM public.admin_roles WHERE name = 'Super Admin' LIMIT 1")
    )
    role_row = role_result.mappings().first()
    if role_row is None:
        raise RuntimeError("The Super Admin role is missing from the database.")

    existing_rows = await connection.execute(
        text("SELECT id, email FROM public.admin_users")
    )
    user_ids = {row["email"]: row["id"] for row in existing_rows.mappings()}
    for user in users:
        email = str(user["email"]).strip().lower()
        if email in user_ids:
            continue
        try:
            result = await connection.execute(
                text(
                    """
                    INSERT INTO public.admin_users
                        (id, email, display_name, password_hash, status, role_id,
                         last_login_at, created_at, updated_at)
                    VALUES (:id, :email, :display_name, :password_hash, :status, :role_id,
                            :last_login_at, :created_at, :updated_at)
                    ON CONFLICT (email) DO NOTHING
                    RETURNING id
                    """
                ),
                {
                    "id": _uuid(user["id"]),
                    "email": email,
                    "display_name": user.get("display_name") or email.split("@", 1)[0],
                    "password_hash": user["password_hash"],
                    "status": "disabled" if user.get("status") == "disabled" else "active",
                    "role_id": role_row["id"],
                    "last_login_at": _timestamp(user["last_login_at"])
                    if user.get("last_login_at")
                    else None,
                    "created_at": _timestamp(user.get("created_at")),
                    "updated_at": _timestamp(user.get("updated_at") or user.get("created_at")),
                },
            )
        except IntegrityError:
            raise
        inserted = result.mappings().first()
        if inserted:
            user_ids[email] = inserted["id"]
        else:
            current = await connection.execute(
                text("SELECT id FROM public.admin_users WHERE email = :email"),
                {"email": email},
            )
            row = current.mappings().first()
            if row:
                user_ids[email] = row["id"]

    valid_ids = set(user_ids.values())
    for item in sessions:
        owner = next(
            (user for user in users if str(user.get("id")) == str(item.get("user_id"))),
            None,
        )
        mapped_id = user_ids.get(str(owner.get("email", "")).lower()) if owner else None
        mapped_id = mapped_id or item.get("user_id")
        try:
            mapped_id = _uuid(mapped_id)
        except (ValueError, TypeError):
            continue
        if mapped_id not in valid_ids:
            continue
        await connection.execute(
            text(
                """
                INSERT INTO public.admin_sessions (id, user_id, token_hash, expires_at, created_at)
                VALUES (:id, :user_id, :token_hash, :expires_at, :created_at)
                ON CONFLICT (token_hash) DO NOTHING
                """
            ),
            {
                "id": _uuid(item["id"]),
                "user_id": mapped_id,
                "token_hash": item["token_hash"],
                "expires_at": _timestamp(item["expires_at"]),
                "created_at": _timestamp(item.get("created_at")),
            },
        )

    for event in events:
        legacy_actor = event.get("actor_user_id")
        actor = next(
            (user for user in users if str(user.get("id")) == str(legacy_actor)),
            None,
        )
        actor_id = user_ids.get(str(actor.get("email", "")).lower()) if actor else None
        if actor_id is not None and actor_id not in valid_ids:
            actor_id = None
        await connection.execute(
            text(
                """
                INSERT INTO public.admin_audit_events
                    (id, actor_user_id, action, target_type, target_id, outcome,
                     request_id, metadata, created_at)
                VALUES (:id, :actor_user_id, :action, :target_type, :target_id, :outcome,
                        :request_id, CAST(:metadata AS jsonb), :created_at)
                ON CONFLICT (id) DO NOTHING
                """
            ),
            {
                "id": _uuid(event["id"]),
                "actor_user_id": actor_id,
                "action": event["action"],
                "target_type": event.get("target_type"),
                "target_id": event.get("target_id"),
                "outcome": event["outcome"],
                "request_id": event.get("request_id"),
                "metadata": json.dumps(event.get("metadata") or {}),
                "created_at": _timestamp(event.get("created_at")),
            },
        )
    print(
        "Imported legacy admin auth data "
        f"({len(users)} users, {len(sessions)} sessions, {len(events)} audit events)."
    )


async def _import_legacy_manifest(connection, manifest_path: Path) -> None:
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        print(f"No legacy image manifest found at {manifest_path}; skipping.")
        return
    entries = manifest.get("images", []) if isinstance(manifest, dict) else []
    if not entries:
        print(f"No image-manifest entries found in {manifest_path}.")
        return

    for image in entries:
        if not isinstance(image, dict):
            continue
        destination_key = image.get("destinationKey") or (
            f"{image.get('category', 'unknown')}:"
            f"{image.get('id') or image.get('filename') or 'item'}"
        )
        folder_path = image.get("path") or image.get("folderPath") or "uploads/unknown"
        public_url = image.get("publicUrlPrefix") or image.get("url") or ""
        display_location = (
            image.get("displayLocation") or image.get("display_placement") or "gallery"
        )
        metadata = {
            "id": image.get("id"),
            "category": image.get("category"),
            "sourceType": image.get("sourceType"),
            "filename": image.get("filename"),
            "url": image.get("url"),
            "path": image.get("path"),
            "deleted": bool(image.get("deleted")),
            "active": image.get("active", True),
        }
        config_key = f"manifest:{image.get('id') or destination_key}"
        await connection.execute(
            text(
                """
                INSERT INTO public.image_manifest_config
                    (config_key, category, destination_key, folder_path, public_url_prefix,
                     display_placement, metadata)
                VALUES (:config_key, :category, :destination_key, :folder_path, :public_url,
                        :display_location, CAST(:metadata AS jsonb))
                ON CONFLICT (config_key) DO NOTHING
                """
            ),
            {
                "config_key": config_key,
                "category": str(image.get("category") or "unknown"),
                "destination_key": str(destination_key),
                "folder_path": str(folder_path),
                "public_url": str(public_url) or None,
                "display_location": str(display_location),
                "metadata": json.dumps(metadata),
            },
        )

        source_type = image.get("sourceType", "external")
        if source_type not in {"upload", "external", "bundled"}:
            source_type = "external"
        category = str(image.get("category") or "unknown")
        path_value = str(image.get("path") or "")
        image_id = str(image.get("id") or "")
        is_dining = (
            category.lower() in {"vrindavan", "cloud9", "clinq"}
            or "/dining/" in path_value
            or image_id.startswith("dining:")
        )
        legacy_id = image.get("id")
        if not legacy_id:
            continue
        await connection.execute(
            text(
                """
                INSERT INTO public.managed_images
                    (category_type, category_id, source_type, public_url, storage_path,
                     display_location, display_order, is_active, legacy_id)
                VALUES (:category_type, :category_id, :source_type, :public_url, :storage_path,
                        :display_location, :display_order, :is_active, :legacy_id)
                ON CONFLICT (legacy_id) DO NOTHING
                """
            ),
            {
                "category_type": "dining" if is_dining else "room",
                "category_id": category,
                "source_type": source_type,
                "public_url": str(image.get("url") or ""),
                "storage_path": image.get("path"),
                "display_location": str(
                    image.get("displayLocation") or image.get("display_placement") or "gallery"
                ),
                "display_order": max(0, int(image.get("displayOrder") or 0)),
                "is_active": False if image.get("deleted") else bool(image.get("active", True)),
                "legacy_id": str(legacy_id),
            },
        )
    print(f"Imported {len(entries)} image manifest entries from {manifest_path}.")


async def import_legacy_data() -> None:
    engine = await _database()
    auth_path = Path(os.getenv("ADMIN_AUTH_STORE_PATH", "data/admin-auth-store.json"))
    manifest_path = Path(
        os.getenv("PNS_IMAGE_MANIFEST", "data/uploads/image-manifest.json")
    )
    async with engine.begin() as connection:
        await _import_legacy_auth(connection, auth_path)
        await _import_legacy_manifest(connection, manifest_path)


async def main() -> None:
    parser = argparse.ArgumentParser(description="PNS FastAPI backend management commands.")
    parser.add_argument(
        "command",
        choices=("bootstrap-superadmin", "import-legacy-data"),
    )
    args = parser.parse_args()
    if args.command == "bootstrap-superadmin":
        await bootstrap_superadmin()
    else:
        await import_legacy_data()
    engine = get_engine()
    if engine:
        await engine.dispose()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(f"Backend command failed: {error}", file=sys.stderr)
        sys.exit(1)
