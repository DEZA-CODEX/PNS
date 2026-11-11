from __future__ import annotations

import logging
import re
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.datastructures import UploadFile

from app.core.config import get_settings
from app.core.cache import invalidate_image_caches
from app.core.database import get_db_session
from app.core.dependencies import AdminContext, require_permission
from app.core.exceptions import AdminAuthError, APIError, ImageManagementError
from app.core.rate_limit import login_rate_limiter
from app.core.responses import JSONResponse
from app.core.security import hash_session_token
from app.repositories.admin_repository import (
    count_active_super_admin_users,
    create_admin_session,
    create_admin_user,
    create_group,
    create_super_admin,
    delete_admin_session,
    delete_group,
    find_admin_by_id,
    find_admin_by_email,
    find_super_admin_by_email,
    get_group,
    get_user_details,
    is_foreign_key_violation,
    is_unique_violation,
    list_audit_events,
    list_groups,
    list_users,
    now_utc,
    public_user,
    replace_group_members,
    replace_group_permissions,
    update_admin_user,
    update_group,
    write_audit_event,
)
from app.repositories.image_repository import IMAGE_SELECTION_COLUMNS, get_managed_image
from app.services.admin_service import (
    authenticate_admin,
    create_password_hash,
)
from app.services.image_service import (
    add_external_image,
    add_uploaded_image,
    delete_managed_image,
    list_images,
    patch_image,
)
from app.services.image_storage import delete_object, restore_object

logger = logging.getLogger("pns.api.admin")
router = APIRouter()
Database = Annotated[AsyncSession, Depends(get_db_session)]


async def _json_body(request: Request) -> dict[str, Any]:
    try:
        body = await request.json()
    except (ValueError, UnicodeDecodeError) as error:
        raise AdminAuthError("validation", "A valid JSON request body is required.", 400) from error
    if not isinstance(body, dict):
        raise AdminAuthError("validation", "The request body must be an object.", 400)
    return body


def _require_text(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise AdminAuthError("validation", f"{label} is required.", 400)
    return value.strip()


def _require_password(value: Any) -> str:
    if not isinstance(value, str) or not value:
        raise AdminAuthError("validation", "Password is required.", 400)
    return value


def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", "unknown")


def _error(
    request: Request, code: str, message: str, status_code: int
) -> JSONResponse:
    return JSONResponse(
        {
            "success": False,
            "requestId": _request_id(request),
            "error": {"code": code, "message": message},
        },
        status_code=status_code,
    )


def _set_session_cookie(response: Response, token: str, remember: bool) -> None:
    settings = get_settings()
    duration_minutes = (
        settings.remembered_session_duration_minutes
        if remember
        else settings.session_duration_minutes
    )
    response.set_cookie(
        key=get_settings().session_cookie_name,
        value=token,
        max_age=duration_minutes * 60,
        path="/",
        httponly=True,
        secure=get_settings().secure_cookies,
        samesite=get_settings().cookie_samesite,
        domain=get_settings().cookie_domain,
    )


def _expire_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=get_settings().session_cookie_name,
        path="/",
        httponly=True,
        secure=get_settings().secure_cookies,
        samesite=get_settings().cookie_samesite,
        domain=get_settings().cookie_domain,
    )


def _client_key(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
    return forwarded or (request.client.host if request.client else "unknown")


@router.post("/auth/login")
async def login(request: Request, db: Database) -> Response:
    client_key = _client_key(request)
    if await login_rate_limiter.is_limited(client_key):
        return JSONResponse(
            {
                "success": False,
                "error": {
                    "code": "rate_limited",
                    "message": "Too many sign-in attempts. Try again later.",
                },
            },
            status_code=429,
        )
    try:
        body = await _json_body(request)
        if not isinstance(body.get("email"), str) or not isinstance(body.get("password"), str):
            raise AdminAuthError("validation", "Email and password are required.", 400)
        remember = body.get("rememberMe") is True
        token, user = await authenticate_admin(
            db, body["email"], body["password"], remember, _request_id(request)
        )
        await login_rate_limiter.clear(client_key)
        response = JSONResponse(
            {
                "success": True,
                "user": {
                    "id": user.get("id"),
                    "email": user.get("email"),
                    "displayName": user.get("displayName")
                    or user.get("display_name"),
                    "roleName": user.get("roleName")
                    or (user.get("role") or {}).get("name", "Administrator"),
                },
                "message": "Signed in successfully.",
            }
        )
        _set_session_cookie(response, token, remember)
        return response
    except AdminAuthError as error:
        if error.code == "invalid_credentials":
            await login_rate_limiter.record_failure(client_key)
        return JSONResponse(
            {"success": False, "error": {"code": error.code, "message": str(error)}},
            status_code=error.status_code,
        )
    except Exception:
        await db.rollback()
        logger.exception("Admin login failed (request_id=%s)", _request_id(request))
        return JSONResponse(
            {
                "success": False,
                "error": {
                    "code": "server_error",
                    "message": "Sign-in is temporarily unavailable.",
                },
            },
            status_code=500,
        )


@router.post("/auth/logout")
async def logout(
    request: Request,
    db: Database,
) -> Response:
    token = request.cookies.get(get_settings().session_cookie_name)
    try:
        current = None
        if token:
            from app.repositories.admin_repository import get_admin_context

            current = await get_admin_context(db, token, _request_id(request))
        await delete_admin_session(db, hash_session_token(token) if token else None)
        if current:
            await write_audit_event(
                db,
                current.user["id"],
                "auth.logout",
                "user",
                current.user["id"],
                "success",
                current.request_id,
            )
        await db.commit()
        response = JSONResponse({"success": True, "message": "Signed out successfully."})
        _expire_session_cookie(response)
        return response
    except Exception:
        await db.rollback()
        logger.exception("Admin logout failed (request_id=%s)", _request_id(request))
        return JSONResponse(
            {
                "success": False,
                "error": {"code": "server_error", "message": "Admin authentication is disabled."},
            },
            status_code=410,
        )


@router.get("/auth/me")
async def who_am_i(
    request: Request,
    db: Database,
) -> Response:
    token = request.cookies.get(get_settings().session_cookie_name)
    try:
        from app.repositories.admin_repository import get_admin_context

        current = await get_admin_context(db, token, _request_id(request))
    except Exception:
        await db.rollback()
        logger.exception("Admin session lookup failed (request_id=%s)", _request_id(request))
        return JSONResponse(
            {"authenticated": False, "message": "Admin authentication has been disabled."},
            status_code=401,
        )
    if current is None:
        return JSONResponse(
            {"authenticated": False, "message": "Authentication required."},
            status_code=401,
        )
    return JSONResponse(
        {
            "authenticated": True,
            "user": current.user,
            "permissions": sorted(current.permissions),
        },
        headers={"Cache-Control": "no-store, max-age=0"},
    )


@router.get("/users")
async def get_users(
    request: Request,
    db: Database,
    context: Annotated[AdminContext, Depends(require_permission("users.read"))],
    search: str | None = Query(default=None),
) -> Response:
    users = await list_users(db, search.strip().lower() if search else None)
    return JSONResponse(
        {
            "success": True,
            "users": users,
            "requestId": _request_id(request),
            "actor": context.user["id"],
        },
        headers={"Cache-Control": "no-store, max-age=0"},
    )


@router.post("/users")
async def create_user(
    request: Request,
    db: Database,
    context: Annotated[AdminContext, Depends(require_permission("users.create"))],
) -> Response:
    try:
        body = await _json_body(request)
        email = _require_text(body.get("email"), "Email").lower()
        display_name = _require_text(body.get("displayName"), "Display name")
        password = _require_password(body.get("password"))
        group_ids: list[str] | None = None
        if "groupIds" in body:
            if "groups.members.manage" not in context.permissions:
                raise AdminAuthError(
                    "forbidden", "You do not have permission to assign group memberships.", 403
                )
            value = body["groupIds"]
            if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
                raise AdminAuthError("validation", "Invalid group IDs.", 400)
            try:
                group_ids = [str(UUID(item)) for item in value]
            except ValueError as error:
                raise AdminAuthError("validation", "Invalid group IDs.", 400) from error
        user = await create_admin_user(
            db, email, display_name, create_password_hash(password), group_ids
        )
        await write_audit_event(
            db, context.user["id"], "users.create", "user", user["id"], "success", _request_id(request)
        )
        await db.commit()
        return JSONResponse(
            {"success": True, "user": user, "requestId": _request_id(request)},
            status_code=201,
        )
    except IntegrityError as error:
        await db.rollback()
        if is_unique_violation(error):
            return _error(request, "conflict", "An account with that email already exists.", 409)
        if is_foreign_key_violation(error):
            return _error(request, "validation", "One or more group IDs are invalid.", 400)
        raise


@router.get("/users/{user_id}")
async def get_user(
    request: Request,
    user_id: str,
    db: Database,
    _: Annotated[AdminContext, Depends(require_permission("users.read"))],
) -> Response:
    details = await get_user_details(db, user_id)
    if details is None:
        return JSONResponse(
            {"success": False, "error": {"code": "not_found", "message": "User not found."}},
            status_code=404,
        )
    return JSONResponse(
        {**details, "requestId": _request_id(request)},
        headers={"Cache-Control": "no-store, max-age=0"},
    )


@router.patch("/users/{user_id}")
async def patch_user(
    request: Request,
    user_id: str,
    db: Database,
    actor: Annotated[AdminContext, Depends(require_permission("users.update"))],
) -> Response:
    body = await _json_body(request)
    existing = await find_admin_by_id(db, user_id)
    if existing is None:
        return JSONResponse(
            {
                "success": False,
                "error": {"code": "not_found", "message": "User not found."},
            },
            status_code=404,
        )
    patch: dict[str, Any] = {}
    if "displayName" in body:
        patch["display_name"] = _require_text(body["displayName"], "Display name")
    if "password" in body:
        if actor.user["role"]["name"] != "Super Admin":
            raise AdminAuthError("forbidden", "Only a Super Admin may change user passwords.", 403)
        patch["password_hash"] = create_password_hash(_require_password(body["password"]))
    if "status" in body:
        if "users.disable" not in actor.permissions:
            raise AdminAuthError(
                "forbidden", "You do not have permission to update user status.", 403
            )
        if body["status"] not in {"active", "disabled"}:
            raise AdminAuthError("validation", "Status must be active or disabled.", 400)
        if body["status"] == "disabled" and existing["role_name"] == "Super Admin":
            if await count_active_super_admin_users(db) <= 1:
                return _error(
                    request,
                    "last_super_admin",
                    "The last active Super Admin cannot be disabled.",
                    409,
                )
        patch["status"] = body["status"]
    if not patch:
        raise AdminAuthError("validation", "No permitted fields were supplied.", 400)
    user = await update_admin_user(db, user_id, patch)
    if user is None:
        return _error(request, "not_found", "User not found.", 404)
    if "password_hash" in patch:
        keep = request.cookies.get(get_settings().session_cookie_name)
        from app.repositories.admin_repository import invalidate_admin_sessions

        await invalidate_admin_sessions(
            db, user_id, hash_session_token(keep) if keep else None
        )
    await write_audit_event(
        db,
        actor.user["id"],
        "users.update",
        "user",
        user_id,
        "success",
        _request_id(request),
        {"fields": ["password" if key == "password_hash" else key for key in patch]},
    )
    await db.commit()
    return JSONResponse(
        {"success": True, "user": user, "requestId": _request_id(request)},
        headers={"Cache-Control": "no-store, max-age=0"},
    )


@router.post("/super-admins")
async def post_super_admin(
    request: Request,
    db: Database,
    actor: Annotated[AdminContext, Depends(require_permission("users.create"))],
) -> Response:
    if actor.user["role"]["name"] != "Super Admin":
        raise AdminAuthError(
            "forbidden", "Only a Super Admin may create additional Super Admin accounts.", 403
        )
    body = await _json_body(request)
    email = _require_text(body.get("email"), "Email").lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise AdminAuthError("validation", "Please enter a valid email address.", 400)
    password = _require_password(body.get("password"))
    password_hash = create_password_hash(password)
    if await find_super_admin_by_email(db, email):
        return _error(
            request,
            "conflict",
            "A Super Admin account with that email already exists.",
            409,
        )
    if await find_admin_by_email(db, email):
        return _error(request, "conflict", "An account with that email already exists.", 409)
    try:
        super_admin = await create_super_admin(db, email, password_hash)
    except IntegrityError as error:
        await db.rollback()
        if is_unique_violation(error):
            return _error(
                request,
                "conflict",
                "A Super Admin account with that email already exists.",
                409,
            )
        raise
    await write_audit_event(
        db,
        actor.user["id"],
        "super_admins.create",
        "super_admin",
        super_admin["id"],
        "success",
        _request_id(request),
        {"email": email},
    )
    await db.commit()
    return JSONResponse(
        {"success": True, "superAdmin": super_admin, "requestId": _request_id(request)},
        status_code=201,
    )


@router.get("/groups")
async def get_groups(
    request: Request,
    db: Database,
    _: Annotated[AdminContext, Depends(require_permission("groups.read"))],
) -> Response:
    groups = await list_groups(db)
    return JSONResponse(
        {"success": True, "groups": groups, "requestId": _request_id(request)},
        headers={"Cache-Control": "no-store, max-age=0"},
    )


@router.post("/groups")
async def post_group(
    request: Request,
    db: Database,
    actor: Annotated[AdminContext, Depends(require_permission("groups.create"))],
) -> Response:
    body = await _json_body(request)
    name = _require_text(body.get("name"), "Group name")
    description = body.get("description", "")
    if not isinstance(description, str):
        description = ""
    try:
        group = await create_group(db, name, description.strip())
    except IntegrityError as error:
        await db.rollback()
        if is_unique_violation(error):
            return _error(request, "conflict", "A group with that name already exists.", 409)
        raise
    await write_audit_event(
        db, actor.user["id"], "groups.create", "group", group["id"], "success", _request_id(request)
    )
    await db.commit()
    return JSONResponse(
        {"success": True, "group": group, "requestId": _request_id(request)}, status_code=201
    )


@router.patch("/groups/{group_id}")
async def patch_group(
    request: Request,
    group_id: str,
    db: Database,
    actor: Annotated[AdminContext, Depends(require_permission("groups.update"))],
) -> Response:
    body = await _json_body(request)
    existing = await get_group(db, group_id)
    if existing is None:
        return _error(request, "not_found", "Group not found.", 404)
    if existing["is_protected"] and (
        "name" in body or body.get("isActive") is False
    ):
        return _error(
            request,
            "protected_group",
            "The built-in group cannot be renamed or disabled.",
            409,
        )
    patch: dict[str, Any] = {}
    if "name" in body:
        patch["name"] = _require_text(body["name"], "Group name")
    if "description" in body:
        patch["description"] = body["description"].strip() if isinstance(body["description"], str) else ""
    if "isActive" in body:
        if not isinstance(body["isActive"], bool):
            raise AdminAuthError("validation", "Active state must be boolean.", 400)
        patch["is_active"] = body["isActive"]
    if not patch:
        raise AdminAuthError("validation", "No group changes were supplied.", 400)
    try:
        group = await update_group(db, group_id, patch)
    except IntegrityError as error:
        await db.rollback()
        if is_unique_violation(error):
            return _error(request, "conflict", "A group with that name already exists.", 409)
        raise
    if group is None:
        return _error(request, "not_found", "Group not found.", 404)
    await write_audit_event(
        db,
        actor.user["id"],
        "groups.update",
        "group",
        group_id,
        "success",
        _request_id(request),
        {"fields": list(patch)},
    )
    await db.commit()
    return JSONResponse({"success": True, "group": group, "requestId": _request_id(request)})


@router.delete("/groups/{group_id}")
async def remove_group(
    request: Request,
    group_id: str,
    db: Database,
    actor: Annotated[AdminContext, Depends(require_permission("groups.delete"))],
) -> Response:
    existing = await get_group(db, group_id)
    if existing is None:
        return _error(request, "not_found", "Group not found.", 404)
    if existing["is_protected"]:
        return _error(
            request, "protected_group", "The built-in group cannot be deleted.", 409
        )
    await delete_group(db, group_id)
    await write_audit_event(
        db, actor.user["id"], "groups.delete", "group", group_id, "success", _request_id(request)
    )
    await db.commit()
    return JSONResponse({"success": True, "requestId": _request_id(request)})


@router.put("/groups/{group_id}/members")
async def put_group_members(
    request: Request,
    group_id: str,
    db: Database,
    actor: Annotated[AdminContext, Depends(require_permission("groups.members.manage"))],
) -> Response:
    body = await _json_body(request)
    user_ids = body.get("userIds")
    if not isinstance(user_ids, list) or not all(isinstance(item, str) for item in user_ids):
        raise AdminAuthError("validation", "userIds must be an array of IDs.", 400)
    group = await get_group(db, group_id)
    if group is None:
        return _error(request, "not_found", "Group not found.", 404)
    try:
        normalized = [str(UUID(value)) for value in user_ids]
    except ValueError as error:
        raise AdminAuthError("validation", "One or more user IDs are invalid.", 400) from error
    try:
        await replace_group_members(db, group_id, normalized)
    except IntegrityError as error:
        await db.rollback()
        if is_foreign_key_violation(error):
            return _error(request, "validation", "One or more user IDs are invalid.", 400)
        raise
    await write_audit_event(
        db,
        actor.user["id"],
        "groups.members.manage",
        "group",
        group_id,
        "success",
        _request_id(request),
        {"memberCount": len(normalized)},
    )
    await db.commit()
    return JSONResponse({"success": True, "requestId": _request_id(request)})


@router.put("/groups/{group_id}/permissions")
async def put_group_permissions(
    request: Request,
    group_id: str,
    db: Database,
    actor: Annotated[AdminContext, Depends(require_permission("groups.permissions.manage"))],
) -> Response:
    if actor.user["role"]["name"] != "Super Admin":
        return _error(
            request,
            "forbidden",
            "Only a Super Admin may change group permissions.",
            403,
        )
    body = await _json_body(request)
    permissions = body.get("permissions")
    if not isinstance(permissions, list):
        raise AdminAuthError("validation", "permissions must be an array.", 400)
    if not all(
        isinstance(entry, dict)
        and isinstance(entry.get("permissionKey"), str)
        and entry.get("effect") in {"allow", "deny"}
        for entry in permissions
    ):
        raise AdminAuthError("validation", "Invalid permission entry.", 400)
    group = await get_group(db, group_id)
    if group is None:
        return _error(request, "not_found", "Group not found.", 404)
    if group["is_protected"]:
        return _error(
            request,
            "protected_group",
            "The built-in group permissions cannot be changed.",
            409,
        )
    try:
        await replace_group_permissions(db, group_id, permissions)
    except ValueError as error:
        raise AdminAuthError("validation", "One or more permission keys are invalid.", 400) from error
    await write_audit_event(
        db,
        actor.user["id"],
        "groups.permissions.manage",
        "group",
        group_id,
        "success",
        _request_id(request),
        {"permissionCount": len(permissions)},
    )
    await db.commit()
    return JSONResponse({"success": True, "requestId": _request_id(request)})


@router.get("/audit")
async def get_audit(
    request: Request,
    db: Database,
    _: Annotated[AdminContext, Depends(require_permission("audit.read"))],
    limit: int | None = Query(default=100),
) -> Response:
    limit = min(limit or 100, 200) if limit and limit > 0 else 100
    return JSONResponse(
        {
            "success": True,
            "events": await list_audit_events(db, limit),
            "requestId": _request_id(request),
        },
        headers={"Cache-Control": "no-store, max-age=0"},
    )


async def _upload_files(
    request: Request,
    files: list[UploadFile],
    collection: str,
    category: str,
    actor: AdminContext,
    db: AsyncSession,
) -> Response:
    if not files:
        raise ImageManagementError("missing_file", "Choose at least one image file.", 400)
    if len(files) == 1:
        file = files[0]
        data = await file.read(get_settings().max_upload_bytes + 1)
        image = await add_uploaded_image(
            db, collection, category, file.filename or "image", data, actor.user["id"]
        )
        image.pop("_converted", None)
        try:
            await write_audit_event(
                db,
                actor.user["id"],
                f"{collection}_images.upload",
                collection,
                category,
                "success",
                _request_id(request),
                {"sourceType": "upload"},
            )
            await db.commit()
            await invalidate_image_caches(collection, category)
        except Exception:
            if image.get("path"):
                try:
                    await delete_object(str(image["path"]))
                except APIError:
                    logger.exception(
                        "Could not clean up an image object after upload transaction failure."
                    )
            raise
        if storage_cleanup and storage_cleanup.get("record_id"):
            remaining = await get_managed_image(
                db, collection, category, str(storage_cleanup["record_id"])
            )
            if remaining is not None:
                raise ImageManagementError(
                    "database_delete_unverified",
                    "The Storage object was removed, but the image mapping still exists.",
                    503,
                )
        return JSONResponse(
            {
                "success": True,
                "requestId": _request_id(request),
                "category": category,
                "image": image,
            },
            status_code=201,
        )

    results: list[dict[str, Any]] = []
    failure_statuses: list[int] = []
    for file in files:
        try:
            data = await file.read(get_settings().max_upload_bytes + 1)
            image = await add_uploaded_image(
                db, collection, category, file.filename or "image", data, actor.user["id"]
            )
            converted = bool(image.pop("_converted", False))
            results.append(
                {
                    "originalName": file.filename or "unknown",
                    "storedName": image.get("filename") or "image.webp",
                    "format": "webp",
                    "converted": converted,
                    "success": True,
                    "path": image.get("path") or "",
                    "url": image.get("url") or "",
                }
            )
        except APIError as error:
            failure_statuses.append(error.status_code)
            results.append(
                {
                    "originalName": file.filename or "unknown",
                    "storedName": "",
                    "format": "",
                    "converted": False,
                    "success": False,
                    "path": "",
                    "url": "",
                    "error": {"code": error.code, "message": str(error)},
                }
            )
    processed = sum(1 for item in results if item["success"])
    failed = len(results) - processed
    try:
        await write_audit_event(
            db,
            actor.user["id"],
            f"{collection}_images.upload",
            collection,
            category,
            "success" if failed == 0 else "partial",
            _request_id(request),
            {"files": len(results), "success": processed, "failed": failed},
        )
        await db.commit()
        await invalidate_image_caches(collection, category)
    except Exception:
        for result in results:
            if result["success"] and result["path"]:
                try:
                    await delete_object(str(result["path"]))
                except APIError:
                    logger.exception(
                        "Could not clean up a batch image object after upload transaction failure."
                    )
        raise
    status = (
        201
        if failed == 0
        else 207
        if processed > 0
        else max(failure_statuses, default=400)
    )
    return JSONResponse(
        {
            "success": failed == 0,
            "requestId": _request_id(request),
            "category": category,
            "total": len(results),
            "processed": processed,
            "converted": sum(1 for item in results if item["success"] and item["converted"]),
            "alreadyWebp": sum(1 for item in results if item["success"] and not item["converted"]),
            "failed": failed,
            "files": results,
        },
        status_code=status,
    )


def _image_router(collection: str) -> None:
    singular = f"{collection}-images"

    async def get_images(
        request: Request,
        db: Database,
        context: Annotated[AdminContext, Depends(require_permission(f"{collection}_images.read"))],
        category: str | None = Query(default=None, alias="type"),
    ) -> Response:
        if not category:
            raise ImageManagementError("invalid_category", "The image category is invalid.", 400)
        images, hidden_ids = await list_images(db, collection, category)
        await write_audit_event(
            db,
            context.user["id"],
            f"{collection}_images.read",
            collection,
            category,
            "success",
            _request_id(request),
        )
        await db.commit()
        return JSONResponse(
            {
                "success": True,
                "requestId": _request_id(request),
                "category": category,
                "images": images,
                "disabledBundledIds": hidden_ids,
            },
            headers={"Cache-Control": "no-store, max-age=0"},
        )

    async def create_image(
        request: Request,
        db: Database,
        category: str | None = Query(default=None, alias="type"),
    ) -> Response:
        content_type = request.headers.get("content-type", "").lower()
        permission = (
            f"{collection}_images.upload"
            if "multipart/form-data" in content_type
            else f"{collection}_images.add_url"
        )
        from app.core.dependencies import optional_admin_context

        actor = await optional_admin_context(request, db)
        if actor is None:
            raise AdminAuthError("unauthorized", "Authentication is required.", 401)
        if permission not in actor.permissions:
            raise AdminAuthError(
                "forbidden", "You do not have permission to perform this action.", 403
            )
        if "multipart/form-data" in content_type:
            form = await request.form()
            form_category = form.get("category")
            selected_category = str(form_category).strip() if form_category else category
            uploads = [
                value
                for key in ("file", "files")
                for value in form.getlist(key)
                if isinstance(value, UploadFile)
            ]
            if not selected_category:
                raise ImageManagementError(
                    "invalid_category", "The image category is invalid.", 400
                )
            return await _upload_files(
                request, uploads, collection, selected_category, actor, db
            )
        body = await _json_body(request)
        body_category = body.get("category")
        image_url = body.get("imageUrl")
        if not isinstance(body_category, str) or not isinstance(image_url, str):
            raise ImageManagementError(
                "invalid_payload", "A category and image URL are required.", 400
            )
        image = await add_external_image(
            db, collection, body_category.strip(), image_url.strip(), actor.user["id"]
        )
        await write_audit_event(
            db,
            actor.user["id"],
            f"{collection}_images.add_url",
            collection,
            body_category.strip(),
            "success",
            _request_id(request),
            {"sourceType": "external"},
        )
        await db.commit()
        await invalidate_image_caches(collection, body_category.strip())
        return JSONResponse(
            {
                "success": True,
                "requestId": _request_id(request),
                "category": body_category.strip(),
                "image": image,
            },
            status_code=201,
        )

    async def delete_image(
        request: Request,
        image_id: str,
        db: Database,
        context: Annotated[
            AdminContext, Depends(require_permission(f"{collection}_images.delete"))
        ],
        category: str | None = Query(default=None, alias="type"),
    ) -> Response:
        if not category:
            raise ImageManagementError("invalid_category", "The image category is invalid.", 400)
        storage_cleanup = await delete_managed_image(db, collection, category, image_id)
        try:
            await write_audit_event(
                db,
                context.user["id"],
                f"{collection}_images.delete",
                collection,
                image_id,
                "success",
                _request_id(request),
            )
            await db.commit()
            await invalidate_image_caches(collection, category)
        except Exception:
            if storage_cleanup and storage_cleanup.get("backup") is not None:
                try:
                    await restore_object(
                        str(storage_cleanup["storage_path"]),
                        storage_cleanup["backup"],
                    )
                except APIError:
                    logger.exception(
                        "Could not restore a Storage object after image deletion could not be committed."
                    )
            raise
        return JSONResponse(
            {
                "success": True,
                "requestId": _request_id(request),
                "category": category,
                "id": image_id,
            }
        )

    get_images.__annotations__["context"] = Annotated[
        AdminContext, Depends(require_permission(f"{collection}_images.read"))
    ]
    delete_image.__annotations__["context"] = Annotated[
        AdminContext, Depends(require_permission(f"{collection}_images.delete"))
    ]

    router.add_api_route(f"/{singular}", get_images, methods=["GET"])
    router.add_api_route(f"/{singular}", create_image, methods=["POST"])
    router.add_api_route(
        f"/{singular}/{{image_id}}", delete_image, methods=["DELETE"]
    )


_image_router("room")
_image_router("dining")


@router.patch("/images/{image_id}")
async def patch_managed_image(
    request: Request,
    image_id: str,
    db: Database,
) -> Response:
    body = await _json_body(request)
    category = body.get("categoryType")
    permission = (
        "room_images.upload"
        if category == "room"
        else "dining_images.upload"
        if category == "dining"
        else None
    )
    if permission is None:
        raise AdminAuthError("validation", "Category type is invalid.", 400)
    from app.core.dependencies import optional_admin_context

    actor = await optional_admin_context(request, db)
    if actor is None:
        raise AdminAuthError("unauthorized", "Authentication is required.", 401)
    if permission not in actor.permissions:
        raise AdminAuthError("forbidden", "You do not have permission to perform this action.", 403)
    patch: dict[str, Any] = {}
    if "displayLocation" in body:
        patch["display_location"] = _require_text(body["displayLocation"], "Display location")
    if "displayOrder" in body:
        if not isinstance(body["displayOrder"], int) or body["displayOrder"] < 0:
            raise AdminAuthError(
                "validation", "Display order must be a non-negative integer.", 400
            )
        patch["display_order"] = body["displayOrder"]
    if "isActive" in body:
        if not isinstance(body["isActive"], bool):
            raise AdminAuthError("validation", "Active state must be boolean.", 400)
        patch["is_active"] = body["isActive"]
    if "selections" in body:
        selections = body["selections"]
        allowed_selections = (
            {"homepage", "roomsPage", "gallery"}
            if category == "room"
            else {"homepage", "diningPage", "diningHero", "aboutPage", "gallery"}
        )
        if not isinstance(selections, dict) or not selections:
            raise AdminAuthError("validation", "Image selections must be a non-empty object.", 400)
        if any(key not in allowed_selections for key in selections):
            raise AdminAuthError("validation", "One or more image destinations are invalid.", 400)
        if any(not isinstance(value, bool) for value in selections.values()):
            raise AdminAuthError("validation", "Image selections must be boolean.", 400)
        patch.update(selections)
    if not patch:
        raise AdminAuthError("validation", "No image changes were supplied.", 400)
    image = await patch_image(db, category, image_id, patch)
    if image is None:
        return _error(request, "not_found", "Image not found.", 404)
    await write_audit_event(
        db,
        actor.user["id"],
        "images.placement.update",
        "image",
        image_id,
        "success",
        _request_id(request),
        {"fields": list(patch)},
    )
    await db.commit()
    await invalidate_image_caches(category, str(image.get("category") or ""))
    return JSONResponse(
        {"success": True, "image": image, "requestId": _request_id(request)}
    )
