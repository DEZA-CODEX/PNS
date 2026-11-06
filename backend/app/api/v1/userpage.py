from __future__ import annotations

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import Response

from app.core.dependencies import AdminContext, require_permission
from app.core.database import get_db_session
from app.core.exceptions import AdminAuthError
from app.core.responses import JSONResponse
from app.repositories.admin_repository import (
    count_active_super_admin_users,
    create_admin_user,
    create_group,
    delete_group,
    find_admin_by_id,
    find_admin_by_email,
    get_assignable_groups,
    get_group,
    get_user_details,
    is_foreign_key_violation,
    is_unique_violation,
    list_access_levels,
    list_groups,
    list_permissions,
    list_userpage_users,
    replace_user_groups,
    replace_group_permissions,
    set_user_group_membership,
    update_admin_user,
    update_group,
    write_audit_event,
)
from app.services.admin_service import create_password_hash
from app.schemas.userpage import AddUserRequest

router = APIRouter(prefix="/userpage")
Database = Annotated[AsyncSession, Depends(get_db_session)]


def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", "unknown")


def _error(request: Request, code: str, message: str, status_code: int) -> JSONResponse:
    return JSONResponse(
        {
            "success": False,
            "requestId": _request_id(request),
            "error": {"code": code, "message": message},
        },
        status_code=status_code,
    )


async def _body(request: Request) -> dict[str, Any]:
    try:
        body = await request.json()
    except (ValueError, UnicodeDecodeError) as error:
        raise AdminAuthError("validation", "A valid JSON request body is required.", 422) from error
    if not isinstance(body, dict):
        raise AdminAuthError("validation", "The request body must be an object.", 422)
    return body


def _text(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise AdminAuthError("validation", f"{label} is required.", 422)
    return value.strip()


def _group_ids(value: Any, *, allow_empty: bool = False) -> list[str]:
    if not isinstance(value, list) or (not value and not allow_empty):
        raise AdminAuthError("validation", "Please select a user group.", 422)
    try:
        if not all(isinstance(item, str) for item in value):
            raise ValueError("group IDs must be strings")
        normalized = [str(UUID(item)) for item in value]
        if len(normalized) != len(set(normalized)):
            raise ValueError("group IDs must be unique")
        return normalized
    except ValueError as error:
        raise AdminAuthError("validation", "The selected group is invalid.", 422) from error


async def _validate_assignable_groups(
    db: AsyncSession, group_ids: list[str]
) -> None:
    if not group_ids:
        return
    groups = await get_assignable_groups(db, group_ids)
    if len(groups) != len(group_ids) or any(not group["is_active"] for group in groups):
        raise AdminAuthError("validation", "The selected group is unavailable.", 422)
    if any(group["is_protected"] for group in groups):
        raise AdminAuthError(
            "forbidden", "Protected system group membership cannot be changed.", 403
        )


@router.get("/users")
async def get_users(
    request: Request,
    db: Database,
    _: Annotated[AdminContext, Depends(require_permission("users.read"))],
    search: str | None = Query(default=None),
    group_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
    access_level: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
) -> Response:
    if status and status not in {"active", "disabled"}:
        raise AdminAuthError("validation", "Status must be active or disabled.", 422)
    if group_id:
        try:
            group_id = str(UUID(group_id))
        except ValueError as error:
            raise AdminAuthError("validation", "The selected group is invalid.", 422) from error
    users, total = await list_userpage_users(
        db,
        search.strip() if search else None,
        group_id,
        status,
        access_level.strip() if access_level else None,
        (page - 1) * page_size,
        page_size,
    )
    return JSONResponse(
        {
            "success": True,
            "items": users,
            "users": users,
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total_items": total,
                "total_pages": (total + page_size - 1) // page_size,
            },
            "requestId": _request_id(request),
        },
        headers={"Cache-Control": "no-store, max-age=0"},
    )


@router.get("/users/{user_id}")
async def get_user(
    request: Request,
    user_id: str,
    db: Database,
    _: Annotated[AdminContext, Depends(require_permission("users.read"))],
) -> Response:
    details = await get_user_details(db, user_id)
    if details is None:
        return _error(request, "not_found", "The requested user could not be found.", 404)
    return JSONResponse({"success": True, **details, "requestId": _request_id(request)})


@router.post("/adduser", status_code=201)
async def add_user(
    request: Request,
    db: Database,
    actor: Annotated[AdminContext, Depends(require_permission("users.create"))],
    body: AddUserRequest,
) -> Response:
    if "groups.members.manage" not in actor.permissions:
        raise AdminAuthError(
            "forbidden", "You do not have permission to assign group memberships.", 403
        )
    group_ids = [str(body.group_id)]
    await _validate_assignable_groups(db, group_ids)
    if await find_admin_by_email(db, body.email):
        return _error(request, "conflict", "A user with this email already exists.", 409)
    try:
        user = await create_admin_user(
            db,
            body.email,
            body.display_name,
            create_password_hash(body.password),
            group_ids,
        )
        await write_audit_event(
            db, actor.user["id"], "users.create", "user", user["id"], "success", _request_id(request)
        )
        await db.commit()
    except IntegrityError as error:
        await db.rollback()
        if is_unique_violation(error):
            return _error(request, "conflict", "A user with this email already exists.", 409)
        if is_foreign_key_violation(error):
            return _error(request, "validation", "The selected group is invalid.", 422)
        raise
    return JSONResponse({"success": True, "user": user, "requestId": _request_id(request)}, status_code=201)


@router.delete("/deluser/{user_id}")
async def delete_user(
    request: Request,
    user_id: str,
    db: Database,
    actor: Annotated[AdminContext, Depends(require_permission("users.disable"))],
) -> Response:
    existing = await find_admin_by_id(db, user_id)
    if existing is None:
        return _error(request, "not_found", "The requested user could not be found.", 404)
    if str(existing["id"]) == str(actor.user["id"]):
        return _error(request, "protected_user", "You cannot delete your own account.", 409)
    if existing["role_name"] == "Super Admin" and await count_active_super_admin_users(db) <= 1:
        return _error(request, "protected_user", "The last active Super Admin cannot be deleted.", 409)
    await update_admin_user(db, user_id, {"status": "disabled"})
    await write_audit_event(
        db, actor.user["id"], "users.disable", "user", user_id, "success", _request_id(request)
    )
    await db.commit()
    return JSONResponse({"success": True, "message": "User deleted successfully.", "requestId": _request_id(request)})


async def _edit_access(
    request: Request,
    user_id: str,
    db: AsyncSession,
    actor: AdminContext,
    body: dict[str, Any],
) -> Response:
    existing = await find_admin_by_id(db, user_id)
    if existing is None:
        return _error(request, "not_found", "The requested user could not be found.", 404)
    if "group_ids" in body or "group_id" in body:
        if "groups.members.manage" not in actor.permissions:
            raise AdminAuthError("forbidden", "You do not have permission to assign group memberships.", 403)
        raw_group_ids = body.get("group_ids", [body.get("group_id")])
        group_ids = _group_ids(raw_group_ids, allow_empty="group_ids" in body)
        await _validate_assignable_groups(db, group_ids)
        await replace_user_groups(db, user_id, group_ids)
    patch: dict[str, Any] = {}
    if "status" in body:
        if "users.disable" not in actor.permissions:
            raise AdminAuthError("forbidden", "You do not have permission to update user status.", 403)
        if body["status"] not in {"active", "disabled"}:
            raise AdminAuthError("validation", "Status must be active or disabled.", 422)
        if body["status"] == "disabled" and str(existing["id"]) == str(actor.user["id"]):
            return _error(request, "protected_user", "You cannot disable your own account.", 409)
        if body["status"] == "disabled" and existing["role_name"] == "Super Admin":
            if await count_active_super_admin_users(db) <= 1:
                return _error(request, "protected_user", "The last active Super Admin cannot be disabled.", 409)
        patch["status"] = body["status"]
    if not ("group_ids" in body or "group_id" in body or patch):
        raise AdminAuthError("validation", "No user access changes were supplied.", 422)
    user = await update_admin_user(db, user_id, patch) if patch else None
    await write_audit_event(
        db, actor.user["id"], "users.access.update", "user", user_id, "success", _request_id(request)
    )
    await db.commit()
    return JSONResponse({"success": True, "user": user or (await get_user_details(db, user_id))["user"], "requestId": _request_id(request)})


@router.patch("/editaccess/{user_id}")
async def edit_access(
    request: Request,
    user_id: str,
    db: Database,
    actor: Annotated[AdminContext, Depends(require_permission("users.update"))],
) -> Response:
    return await _edit_access(request, user_id, db, actor, await _body(request))


@router.patch("/edituser/{user_id}")
async def edit_user(
    request: Request,
    user_id: str,
    db: Database,
    actor: Annotated[AdminContext, Depends(require_permission("users.update"))],
) -> Response:
    body = await _body(request)
    patch = {"display_name": _text(body["display_name"], "Display name")} if "display_name" in body else {}
    if not patch:
        raise AdminAuthError("validation", "No user changes were supplied.", 422)
    user = await update_admin_user(db, user_id, patch)
    if user is None:
        return _error(request, "not_found", "The requested user could not be found.", 404)
    await write_audit_event(db, actor.user["id"], "users.update", "user", user_id, "success", _request_id(request))
    await db.commit()
    return JSONResponse({"success": True, "user": user, "requestId": _request_id(request)})


async def _set_status(request: Request, user_id: str, db: AsyncSession, actor: AdminContext, status: str) -> Response:
    return await _edit_access(request, user_id, db, actor, {"status": status})


@router.patch("/enableuser/{user_id}")
async def enable_user(request: Request, user_id: str, db: Database, actor: Annotated[AdminContext, Depends(require_permission("users.disable"))]) -> Response:
    return await _set_status(request, user_id, db, actor, "active")


@router.patch("/disableuser/{user_id}")
async def disable_user(request: Request, user_id: str, db: Database, actor: Annotated[AdminContext, Depends(require_permission("users.disable"))]) -> Response:
    return await _set_status(request, user_id, db, actor, "disabled")


@router.get("/groups")
async def get_groups(request: Request, db: Database, _: Annotated[AdminContext, Depends(require_permission("groups.read"))]) -> Response:
    return JSONResponse({"success": True, "groups": await list_groups(db), "requestId": _request_id(request)})


@router.get("/groups/{group_id}")
async def get_group_details(request: Request, group_id: str, db: Database, _: Annotated[AdminContext, Depends(require_permission("groups.read"))]) -> Response:
    group = await get_group(db, group_id)
    if group is None:
        return _error(request, "not_found", "The requested group could not be found.", 404)
    return JSONResponse({"success": True, "group": group, "requestId": _request_id(request)})


@router.post("/creategroup", status_code=201)
async def create_group_endpoint(request: Request, db: Database, actor: Annotated[AdminContext, Depends(require_permission("groups.create"))]) -> Response:
    body = await _body(request)
    description = body.get("description", "")
    if not isinstance(description, str):
        raise AdminAuthError("validation", "Description must be text.", 422)
    try:
        group = await create_group(db, _text(body.get("name"), "Group name"), description.strip())
        await write_audit_event(db, actor.user["id"], "groups.create", "group", group["id"], "success", _request_id(request))
        await db.commit()
    except IntegrityError as error:
        await db.rollback()
        if is_unique_violation(error):
            return _error(request, "conflict", "A group with that name already exists.", 409)
        raise
    return JSONResponse({"success": True, "group": group, "requestId": _request_id(request)}, status_code=201)


@router.patch("/editgroup/{group_id}")
async def edit_group(request: Request, group_id: str, db: Database, actor: Annotated[AdminContext, Depends(require_permission("groups.update"))]) -> Response:
    body = await _body(request)
    patch = {}
    if "name" in body:
        patch["name"] = _text(body["name"], "Group name")
    if "description" in body:
        patch["description"] = body["description"].strip() if isinstance(body["description"], str) else ""
    group = await update_group(db, group_id, patch)
    if group is None:
        return _error(request, "not_found", "The requested group could not be found.", 404)
    await write_audit_event(db, actor.user["id"], "groups.update", "group", group_id, "success", _request_id(request))
    await db.commit()
    return JSONResponse({"success": True, "group": group, "requestId": _request_id(request)})


@router.delete("/delgroup/{group_id}")
async def remove_group(request: Request, group_id: str, db: Database, actor: Annotated[AdminContext, Depends(require_permission("groups.delete"))]) -> Response:
    group = await get_group(db, group_id)
    if group is None:
        return _error(request, "not_found", "The requested group could not be found.", 404)
    if group["is_protected"]:
        return _error(request, "protected_group", "The built-in group cannot be deleted.", 409)
    await delete_group(db, group_id)
    await write_audit_event(db, actor.user["id"], "groups.delete", "group", group_id, "success", _request_id(request))
    await db.commit()
    return JSONResponse({"success": True, "requestId": _request_id(request)})


@router.get("/grouppermissions/{group_id}")
async def group_permissions(request: Request, group_id: str, db: Database, _: Annotated[AdminContext, Depends(require_permission("groups.read"))]) -> Response:
    group = await get_group(db, group_id)
    if group is None:
        return _error(request, "not_found", "The requested group could not be found.", 404)
    groups = await list_groups(db)
    match = next(item for item in groups if item["id"] == group_id)
    return JSONResponse({"success": True, "permissions": match["permissions"], "requestId": _request_id(request)})


@router.patch("/editpermissions/{group_id}")
async def edit_permissions(request: Request, group_id: str, db: Database, actor: Annotated[AdminContext, Depends(require_permission("groups.permissions.manage"))]) -> Response:
    if actor.user["role"]["name"] != "Super Admin":
        raise AdminAuthError("forbidden", "You do not have permission to modify group permissions.", 403)
    body = await _body(request)
    permissions = body.get("permissions")
    if not isinstance(permissions, list) or not all(
        isinstance(item, dict)
        and isinstance(item.get("permissionKey"), str)
        and item.get("effect") in {"allow", "deny"}
        for item in permissions
    ):
        raise AdminAuthError("validation", "Permissions must be an array.", 422)
    group = await get_group(db, group_id)
    if group is None:
        return _error(request, "not_found", "The requested group could not be found.", 404)
    if group["is_protected"]:
        return _error(request, "protected_group", "The built-in group permissions cannot be changed.", 409)
    await replace_group_permissions(db, group_id, permissions)
    await write_audit_event(db, actor.user["id"], "groups.permissions.manage", "group", group_id, "success", _request_id(request))
    await db.commit()
    return JSONResponse({"success": True, "requestId": _request_id(request)})


@router.patch("/assigngroup/{user_id}")
async def assign_group(request: Request, user_id: str, db: Database, actor: Annotated[AdminContext, Depends(require_permission("groups.members.manage"))]) -> Response:
    existing_user = await find_admin_by_id(db, user_id)
    if existing_user is None:
        return _error(request, "not_found", "The requested user could not be found.", 404)
    body = await _body(request)
    try:
        group_id = str(UUID(body.get("group_id")))
    except (ValueError, TypeError) as error:
        raise AdminAuthError("validation", "The selected group is invalid.", 422) from error
    assigned = body.get("assigned")
    if not isinstance(assigned, bool):
        raise AdminAuthError("validation", "Assigned must be true or false.", 422)
    group = await get_group(db, group_id)
    if group is None:
        return _error(request, "not_found", "The requested group could not be found.", 404)
    if group["is_protected"]:
        return _error(request, "protected_group", "Protected system group membership cannot be changed.", 403)
    if assigned and not group["is_active"]:
        raise AdminAuthError("validation", "The selected group is unavailable.", 422)
    await set_user_group_membership(db, user_id, group_id, assigned)
    await write_audit_event(
        db,
        actor.user["id"],
        "groups.members.manage",
        "user",
        user_id,
        "success",
        _request_id(request),
        {"groupId": group_id, "assigned": assigned},
    )
    await db.commit()
    return JSONResponse({"success": True, "user": (await get_user_details(db, user_id))["user"], "requestId": _request_id(request)})


@router.get("/access-levels")
async def access_levels(request: Request, db: Database, _: Annotated[AdminContext, Depends(require_permission("users.read"))]) -> Response:
    return JSONResponse({"success": True, "accessLevels": await list_access_levels(db), "requestId": _request_id(request)})


@router.get("/permissions")
async def permissions_catalog(request: Request, db: Database, _: Annotated[AdminContext, Depends(require_permission("groups.read"))]) -> Response:
    return JSONResponse({"success": True, "permissions": await list_permissions(db), "requestId": _request_id(request)})
