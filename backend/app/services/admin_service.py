from __future__ import annotations

from datetime import timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AdminAuthError
from app.core.security import hash_password, hash_session_token, new_session_token, verify_password
from app.repositories.admin_repository import (
    create_admin_session,
    ensure_super_admin_user,
    find_admin_by_email,
    find_super_admin_by_email,
    now_utc,
    update_admin_login,
    update_super_admin_login,
    write_audit_event,
)

SESSION_DURATION_SECONDS = 60 * 60 * 8
REMEMBERED_SESSION_DURATION_SECONDS = 60 * 60 * 24 * 30


def _validate_email(email: str) -> str:
    normalized = email.strip().lower()
    at_index = normalized.find("@")
    dot_index = normalized.rfind(".")
    if (
        at_index <= 0
        or dot_index <= at_index + 1
        or dot_index >= len(normalized) - 1
        or any(character in normalized for character in " \t\n\r")
    ):
        raise AdminAuthError("invalid_credentials", "Invalid email or password.", 401)
    return normalized


async def authenticate_admin(
    db: AsyncSession, email: str, password: str, remember: bool, request_id: str | None = None
) -> tuple[str, dict]:
    normalized_email = _validate_email(email)
    if not password:
        raise AdminAuthError("invalid_credentials", "Invalid email or password.", 401)
    super_admin = await find_super_admin_by_email(db, normalized_email)
    if super_admin is not None:
        if not super_admin["is_active"] or not verify_password(
            password, super_admin["password_hash"]
        ):
            await write_audit_event(
                db,
                None,
                "auth.login",
                "user",
                str(super_admin["id"]),
                "denied",
                request_id,
            )
            await db.commit()
            raise AdminAuthError("invalid_credentials", "Invalid email or password.", 401)
        user = await ensure_super_admin_user(db, super_admin)
        if user.get("status") != "active":
            await write_audit_event(
                db,
                None,
                "auth.login",
                "user",
                user.get("id"),
                "denied",
                request_id,
            )
            await db.commit()
            raise AdminAuthError("invalid_credentials", "Invalid email or password.", 401)
        user_id = str(user["id"])
        await update_super_admin_login(db, str(super_admin["id"]))
    else:
        raw_user = await find_admin_by_email(db, normalized_email)
        if (
            raw_user is None
            or raw_user["status"] != "active"
            or not verify_password(password, raw_user["password_hash"])
        ):
            await write_audit_event(
                db,
                None,
                "auth.login",
                "user",
                str(raw_user["id"]) if raw_user else None,
                "denied",
                request_id,
            )
            await db.commit()
            raise AdminAuthError("invalid_credentials", "Invalid email or password.", 401)
        user = {
            "id": str(raw_user["id"]),
            "email": raw_user["email"],
            "displayName": raw_user["display_name"],
            "roleName": raw_user["role_name"] or "Administrator",
        }
        user_id = str(raw_user["id"])

    remember_seconds = (
        REMEMBERED_SESSION_DURATION_SECONDS if remember else SESSION_DURATION_SECONDS
    )
    token = new_session_token()
    await create_admin_session(
        db,
        user_id,
        hash_session_token(token),
        now_utc() + timedelta(seconds=remember_seconds),
    )
    await update_admin_login(db, user_id)
    await write_audit_event(
        db, user_id, "auth.login", "user", user_id, "success", request_id
    )
    await db.commit()
    return token, user


def create_password_hash(password: str) -> str:
    if len(password) < 8:
        raise AdminAuthError("validation", "Password must be at least 8 characters.", 400)
    return hash_password(password)
