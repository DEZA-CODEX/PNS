from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.admin_types import ADMIN_PERMISSIONS, AdminContext
from app.core.security import hash_session_token


def _mapping(result) -> dict[str, Any] | None:
    row = result.mappings().first()
    return dict(row) if row is not None else None


def _uuid_param(value: str | UUID | None) -> UUID | None:
    if value is None or isinstance(value, UUID):
        return value
    try:
        return UUID(str(value))
    except ValueError:
        return None


def _user_row(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    result = dict(row)
    role_name = result.pop("role_name", None) or "Administrator"
    result.pop("role_id", None)
    result["role"] = {"name": role_name}
    for key in ("id",):
        if result.get(key) is not None:
            result[key] = str(result[key])
    return result


def public_user(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "email": row["email"],
        "displayName": row["display_name"],
        "status": row["status"],
        "roleName": (row.get("role") or {}).get("name", "Administrator"),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "lastLoginAt": row.get("last_login_at"),
    }


async def find_admin_by_email(db: AsyncSession, email: str) -> dict[str, Any] | None:
    result = await db.execute(
        text(
            """
            SELECT u.id, u.email, u.display_name, u.password_hash, u.status::text AS status,
                   u.created_at, u.updated_at, u.last_login_at, r.id AS role_id, r.name AS role_name
              FROM public.admin_users AS u
              JOIN public.admin_roles AS r ON r.id = u.role_id
             WHERE lower(u.email) = :email
             LIMIT 1
            """
        ),
        {"email": email},
    )
    return _mapping(result)


async def find_admin_by_id(db: AsyncSession, user_id: str) -> dict[str, Any] | None:
    result = await db.execute(
        text(
            """
            SELECT u.id, u.email, u.display_name, u.password_hash, u.status::text AS status,
                   u.created_at, u.updated_at, u.last_login_at, r.id AS role_id, r.name AS role_name
              FROM public.admin_users AS u
              JOIN public.admin_roles AS r ON r.id = u.role_id
             WHERE u.id = :user_id
             LIMIT 1
            """
        ),
        {"user_id": _uuid_param(user_id)},
    )
    return _mapping(result)


async def find_super_admin_by_email(db: AsyncSession, email: str) -> dict[str, Any] | None:
    result = await db.execute(
        text(
            """
            SELECT id, email, password_hash, is_active, created_at, updated_at, last_login_at
              FROM public.super_admins
             WHERE lower(email) = :email
             LIMIT 1
            """
        ),
        {"email": email},
    )
    return _mapping(result)


async def ensure_super_admin_user(
    db: AsyncSession, super_admin: dict[str, Any]
) -> dict[str, Any]:
    role_result = await db.execute(
        text("SELECT id FROM public.admin_roles WHERE name = 'Super Admin' LIMIT 1")
    )
    role = _mapping(role_result)
    if role is None:
        raise RuntimeError("The Super Admin role is missing from the database.")

    existing = await find_admin_by_email(db, super_admin["email"].lower())
    display_name = (
        existing["display_name"] if existing else super_admin["email"].split("@", 1)[0]
    )
    if existing is None:
        result = await db.execute(
            text(
                """
                INSERT INTO public.admin_users
                    (email, display_name, password_hash, status, role_id)
                VALUES (:email, :display_name, :password_hash, 'active', :role_id)
                RETURNING id
                """
            ),
            {
                "email": super_admin["email"],
                "display_name": display_name,
                "password_hash": super_admin["password_hash"],
                "role_id": role["id"],
            },
        )
        inserted = _mapping(result)
        if inserted is None:
            raise RuntimeError("The Super Admin account could not be linked.")
        group_result = await db.execute(
            text("SELECT id FROM public.admin_groups WHERE name = 'Super Admins' LIMIT 1")
        )
        group = _mapping(group_result)
        if group is not None:
            await db.execute(
                text(
                    """
                    INSERT INTO public.admin_user_groups (user_id, group_id)
                    VALUES (:user_id, :group_id)
                    ON CONFLICT (user_id, group_id) DO NOTHING
                    """
                ),
                {"user_id": inserted["id"], "group_id": group["id"]},
            )
        return _user_row(await find_admin_by_id(db, str(inserted["id"]))) or {}

    await db.execute(
        text(
            """
            UPDATE public.admin_users
               SET display_name = :display_name,
                   password_hash = :password_hash,
                   role_id = :role_id
             WHERE id = :user_id
            """
        ),
        {
            "display_name": display_name,
            "password_hash": super_admin["password_hash"],
            "role_id": role["id"],
            "user_id": existing["id"],
        },
    )
    return _user_row(await find_admin_by_id(db, str(existing["id"]))) or {}


async def create_admin_session(
    db: AsyncSession, user_id: str, token_hash: str, expires_at: datetime
) -> None:
    await db.execute(
        text(
            """
            INSERT INTO public.admin_sessions (user_id, token_hash, expires_at)
            VALUES (:user_id, :token_hash, :expires_at)
            """
        ),
        {
            "user_id": _uuid_param(user_id),
            "token_hash": token_hash,
            "expires_at": expires_at,
        },
    )


async def update_admin_login(db: AsyncSession, user_id: str) -> None:
    await db.execute(
        text("UPDATE public.admin_users SET last_login_at = now() WHERE id = :user_id"),
        {"user_id": _uuid_param(user_id)},
    )


async def delete_admin_session(db: AsyncSession, token_hash: str | None) -> None:
    if token_hash:
        await db.execute(
            text("DELETE FROM public.admin_sessions WHERE token_hash = :token_hash"),
            {"token_hash": token_hash},
        )


async def invalidate_admin_sessions(
    db: AsyncSession, user_id: str, keep_token_hash: str | None = None
) -> None:
    query = "DELETE FROM public.admin_sessions WHERE user_id = :user_id"
    parameters: dict[str, Any] = {"user_id": _uuid_param(user_id)}
    if keep_token_hash:
        query += " AND token_hash <> :token_hash"
        parameters["token_hash"] = keep_token_hash
    await db.execute(text(query), parameters)


async def _effective_permissions(
    db: AsyncSession, user_id: str, role_name: str
) -> frozenset[str]:
    if role_name == "Super Admin":
        return frozenset(ADMIN_PERMISSIONS)
    group_result = await db.execute(
        text(
            """
            SELECT p.permission_key, gp.effect::text AS effect
              FROM public.admin_user_groups AS ug
              JOIN public.admin_groups AS g ON g.id = ug.group_id AND g.is_active
              JOIN public.admin_group_permissions AS gp ON gp.group_id = g.id
              JOIN public.admin_permissions AS p ON p.id = gp.permission_id
             WHERE ug.user_id = :user_id
            """
        ),
        {"user_id": _uuid_param(user_id)},
    )
    group_effects: dict[str, str] = {}
    for row in group_result.mappings():
        key, effect = row["permission_key"], row["effect"]
        if effect == "deny":
            group_effects[key] = "deny"
        elif key not in group_effects:
            group_effects[key] = effect

    direct_result = await db.execute(
        text(
            """
            SELECT p.permission_key, up.effect::text AS effect
              FROM public.admin_user_permissions AS up
              JOIN public.admin_permissions AS p ON p.id = up.permission_id
             WHERE up.user_id = :user_id
            """
        ),
        {"user_id": _uuid_param(user_id)},
    )
    direct_effects = {
        row["permission_key"]: row["effect"] for row in direct_result.mappings()
    }
    keys = group_effects.keys() | direct_effects.keys()
    return frozenset(
        key
        for key in keys
        if direct_effects.get(key, group_effects.get(key)) == "allow"
    )


async def get_admin_context(
    db: AsyncSession, token: str | None, request_id: str | None = None
) -> AdminContext | None:
    if not token:
        return None
    session_result = await db.execute(
        text(
            """
            SELECT user_id
              FROM public.admin_sessions
             WHERE token_hash = :token_hash AND expires_at > now()
             LIMIT 1
            """
        ),
        {"token_hash": hash_session_token(token)},
    )
    session_row = _mapping(session_result)
    if session_row is None:
        return None
    raw_user = await find_admin_by_id(db, str(session_row["user_id"]))
    if raw_user is None or raw_user["status"] != "active":
        return None
    user = _user_row(raw_user) or {}
    role_name = user["role"]["name"]
    user = {
        "id": user["id"],
        "email": user["email"],
        "displayName": user["display_name"],
        "status": user["status"],
        "roleName": role_name,
        "createdAt": user["created_at"],
        "updatedAt": user["updated_at"],
        "lastLoginAt": user["last_login_at"],
        "role": {"name": role_name},
    }
    permissions = await _effective_permissions(
        db, str(user["id"]), role_name
    )
    return AdminContext(
        user=user,
        permissions=permissions,
        request_id=request_id or str(uuid4()),
    )


async def write_audit_event(
    db: AsyncSession,
    actor_user_id: str | None,
    action: str,
    target_type: str | None,
    target_id: str | None,
    outcome: str,
    request_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    await db.execute(
        text(
            """
            INSERT INTO public.admin_audit_events
                (actor_user_id, action, target_type, target_id, outcome, request_id, metadata)
            VALUES (:actor_user_id, :action, :target_type, :target_id, :outcome,
                    :request_id, CAST(:metadata AS jsonb))
            """
        ),
        {
            "actor_user_id": _uuid_param(actor_user_id),
            "action": action,
            "target_type": target_type,
            "target_id": target_id,
            "outcome": outcome,
            "request_id": request_id,
            "metadata": json.dumps(metadata or {}),
        },
    )


async def list_users(db: AsyncSession, search: str | None) -> list[dict[str, Any]]:
    statement = """
        SELECT u.id, u.email, u.display_name, u.status::text AS status,
               u.created_at, u.updated_at, u.last_login_at, r.name AS role_name
          FROM public.admin_users AS u
          JOIN public.admin_roles AS r ON r.id = u.role_id
    """
    params: dict[str, Any] = {}
    if search:
        statement += " WHERE u.email ILIKE :search OR u.display_name ILIKE :search"
        params["search"] = f"%{search}%"
    statement += " ORDER BY u.created_at DESC"
    result = await db.execute(text(statement), params)
    return [
        public_user(_user_row(dict(row)) or {})
        for row in result.mappings()
    ]


async def list_userpage_users(
    db: AsyncSession,
    search: str | None,
    group_id: str | None,
    status: str | None,
    access_level: str | None,
    offset: int,
    limit: int,
) -> tuple[list[dict[str, Any]], int]:
    filters = ["1 = 1"]
    params: dict[str, Any] = {"offset": offset, "limit": limit}
    if search:
        filters.append("(u.email ILIKE :search OR u.display_name ILIKE :search)")
        params["search"] = f"%{search}%"
    if group_id:
        filters.append(
            "EXISTS (SELECT 1 FROM public.admin_user_groups ug_filter "
            "WHERE ug_filter.user_id = u.id AND ug_filter.group_id = :group_id)"
        )
        params["group_id"] = _uuid_param(group_id)
    if status:
        filters.append("u.status::text = :status")
        params["status"] = status
    if access_level:
        filters.append("r.name = :access_level")
        params["access_level"] = access_level
    where_clause = " AND ".join(filters)
    count_result = await db.execute(
        text(
            f"""
            SELECT count(*) AS total
              FROM public.admin_users AS u
              JOIN public.admin_roles AS r ON r.id = u.role_id
             WHERE {where_clause}
            """
        ),
        params,
    )
    total = int(_mapping(count_result)["total"])
    result = await db.execute(
        text(
            f"""
            SELECT u.id, u.email, u.display_name, u.status::text AS status,
                   u.created_at, u.updated_at, u.last_login_at, r.name AS role_name,
                   COALESCE(
                     jsonb_agg(
                       DISTINCT jsonb_build_object('id', g.id, 'name', g.name)
                     ) FILTER (WHERE g.id IS NOT NULL),
                     '[]'::jsonb
                   ) AS groups
              FROM public.admin_users AS u
              JOIN public.admin_roles AS r ON r.id = u.role_id
              LEFT JOIN public.admin_user_groups AS ug ON ug.user_id = u.id
              LEFT JOIN public.admin_groups AS g ON g.id = ug.group_id
             WHERE {where_clause}
             GROUP BY u.id, u.email, u.display_name, u.status, u.created_at,
                      u.updated_at, u.last_login_at, r.name
             ORDER BY u.created_at DESC, u.id
             OFFSET :offset LIMIT :limit
            """
        ),
        params,
    )
    users = []
    for row in result.mappings():
        item = public_user(_user_row(dict(row)) or {})
        item["groups"] = [
            {"id": str(group["id"]), "name": group["name"]}
            for group in (row["groups"] or [])
        ]
        item["accessLevel"] = row["role_name"] or "Administrator"
        users.append(item)
    return users, total


async def create_admin_user(
    db: AsyncSession,
    email: str,
    display_name: str,
    password_hash: str,
    group_ids: list[str] | None,
) -> dict[str, Any]:
    role_result = await db.execute(
        text("SELECT id FROM public.admin_roles WHERE name = 'Administrator' LIMIT 1")
    )
    role = _mapping(role_result)
    if role is None:
        raise RuntimeError("The Administrator role is missing from the database.")
    inserted_result = await db.execute(
        text(
            """
            INSERT INTO public.admin_users (email, display_name, password_hash, role_id)
            VALUES (:email, :display_name, :password_hash, :role_id)
            RETURNING id
            """
        ),
        {
            "email": email,
            "display_name": display_name,
            "password_hash": password_hash,
            "role_id": role["id"],
        },
    )
    inserted = _mapping(inserted_result)
    if inserted is None:
        raise RuntimeError("The user account could not be created.")
    if group_ids:
        await db.execute(
            text(
                """
                INSERT INTO public.admin_user_groups (user_id, group_id)
                SELECT :user_id, item.group_id
                  FROM unnest(CAST(:group_ids AS uuid[])) AS item(group_id)
                """
            ),
            {"user_id": inserted["id"], "group_ids": [UUID(group_id) for group_id in group_ids]},
        )
    user = await find_admin_by_id(db, str(inserted["id"]))
    if user is None:
        raise RuntimeError("The user account could not be loaded after creation.")
    return public_user(_user_row(user) or {})


async def get_user_details(db: AsyncSession, user_id: str) -> dict[str, Any] | None:
    raw = await find_admin_by_id(db, user_id)
    user = _user_row(raw)
    if user is None:
        return None
    memberships_result = await db.execute(
        text(
            """
            SELECT jsonb_build_object(
                       'group', jsonb_build_object(
                           'id', g.id, 'name', g.name, 'description', g.description,
                           'is_active', g.is_active
                       )
                   ) AS membership
              FROM public.admin_user_groups AS ug
              JOIN public.admin_groups AS g ON g.id = ug.group_id
             WHERE ug.user_id = :user_id
             ORDER BY g.name
            """
        ),
        {"user_id": _uuid_param(user_id)},
    )
    direct_result = await db.execute(
        text(
            """
            SELECT jsonb_build_object(
                       'effect', up.effect::text,
                       'permission', jsonb_build_object(
                           'permission_key', p.permission_key, 'label', p.label, 'area', p.area
                       )
                   ) AS permission
              FROM public.admin_user_permissions AS up
              JOIN public.admin_permissions AS p ON p.id = up.permission_id
             WHERE up.user_id = :user_id
             ORDER BY p.permission_key
            """
        ),
        {"user_id": _uuid_param(user_id)},
    )
    return {
        "user": user,
        "memberships": [row["membership"] for row in memberships_result.mappings()],
        "directPermissions": [row["permission"] for row in direct_result.mappings()],
    }


async def list_access_levels(db: AsyncSession) -> list[str]:
    result = await db.execute(
        text("SELECT name FROM public.admin_roles ORDER BY name")
    )
    return [row["name"] for row in result.mappings()]


async def count_active_super_admin_users(db: AsyncSession) -> int:
    result = await db.execute(
        text(
            """
            SELECT count(*) AS total
              FROM public.admin_users AS u
              JOIN public.admin_roles AS r ON r.id = u.role_id
             WHERE u.status = 'active' AND r.name = 'Super Admin'
            """
        )
    )
    return int(_mapping(result)["total"])


async def update_admin_user(
    db: AsyncSession, user_id: str, patch: dict[str, Any]
) -> dict[str, Any] | None:
    columns = {
        "display_name": "display_name",
        "password_hash": "password_hash",
        "status": "status",
    }
    selected = [(columns[key], value) for key, value in patch.items() if key in columns]
    if not selected:
        return None
    set_clause = ", ".join(f"{column} = :value_{index}" for index, (column, _) in enumerate(selected))
    params = {f"value_{index}": value for index, (_, value) in enumerate(selected)}
    params["user_id"] = _uuid_param(user_id)
    result = await db.execute(
        text(f"UPDATE public.admin_users SET {set_clause} WHERE id = :user_id"),
        params,
    )
    if result.rowcount == 0:
        return None
    return _user_row(await find_admin_by_id(db, user_id))


async def update_super_admin_login(db: AsyncSession, super_admin_id: str) -> None:
    await db.execute(
        text("UPDATE public.super_admins SET last_login_at = now() WHERE id = :id"),
        {"id": _uuid_param(super_admin_id)},
    )


async def create_super_admin(
    db: AsyncSession, email: str, password_hash: str
) -> dict[str, Any]:
    result = await db.execute(
        text(
            """
            INSERT INTO public.super_admins (email, password_hash, is_active)
            VALUES (:email, :password_hash, true)
            RETURNING id, email, is_active, created_at, updated_at, last_login_at
            """
        ),
        {"email": email, "password_hash": password_hash},
    )
    row = _mapping(result)
    if row is None:
        raise RuntimeError("The Super Admin account could not be created.")
    return {
        "id": str(row["id"]),
        "email": row["email"],
        "isActive": row["is_active"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "lastLoginAt": row["last_login_at"],
    }


async def create_group(db: AsyncSession, name: str, description: str) -> dict[str, Any]:
    result = await db.execute(
        text(
            """
            INSERT INTO public.admin_groups (name, description)
            VALUES (:name, :description)
            RETURNING id, name, description, is_active, is_protected, created_at, updated_at
            """
        ),
        {"name": name, "description": description},
    )
    row = _mapping(result)
    if row is None:
        raise RuntimeError("The group could not be created.")
    row["id"] = str(row["id"])
    return row


async def list_groups(db: AsyncSession) -> list[dict[str, Any]]:
    result = await db.execute(
        text(
            """
            SELECT g.id, g.name, g.description, g.is_active, g.is_protected,
                   g.created_at, g.updated_at,
                   count(DISTINCT ug.user_id) AS member_count,
                   COALESCE(
                     jsonb_agg(DISTINCT jsonb_build_object('user_id', ug.user_id))
                       FILTER (WHERE ug.user_id IS NOT NULL), '[]'::jsonb
                   ) AS members,
                   COALESCE(
                     jsonb_agg(DISTINCT jsonb_build_object(
                       'effect', gp.effect::text,
                       'permission', jsonb_build_object(
                         'permission_key', p.permission_key,
                         'label', p.label,
                         'area', p.area
                       )
                     )) FILTER (WHERE p.id IS NOT NULL), '[]'::jsonb
                   ) AS permissions
              FROM public.admin_groups AS g
              LEFT JOIN public.admin_user_groups AS ug ON ug.group_id = g.id
              LEFT JOIN public.admin_group_permissions AS gp ON gp.group_id = g.id
              LEFT JOIN public.admin_permissions AS p ON p.id = gp.permission_id
             GROUP BY g.id
             ORDER BY g.name
            """
        )
    )
    groups = []
    for row in result.mappings():
        group = dict(row)
        group["id"] = str(group["id"])
        groups.append(group)
    return groups


async def list_permissions(db: AsyncSession) -> list[dict[str, str]]:
    result = await db.execute(
        text(
            """
            SELECT permission_key, label, area
              FROM public.admin_permissions
             ORDER BY area, permission_key
            """
        )
    )
    return [dict(row) for row in result.mappings()]


async def get_assignable_groups(
    db: AsyncSession, group_ids: list[str]
) -> list[dict[str, Any]]:
    result = await db.execute(
        text(
            """
            SELECT id, name, is_active, is_protected
              FROM public.admin_groups
             WHERE id = ANY(CAST(:group_ids AS uuid[]))
            """
        ),
        {"group_ids": [UUID(value) for value in group_ids]},
    )
    return [dict(row) for row in result.mappings()]


async def get_group(db: AsyncSession, group_id: str) -> dict[str, Any] | None:
    result = await db.execute(
        text(
            """
            SELECT id, name, description, is_active, is_protected, created_at, updated_at
              FROM public.admin_groups WHERE id = :group_id LIMIT 1
            """
        ),
        {"group_id": _uuid_param(group_id)},
    )
    return _mapping(result)


async def update_group(
    db: AsyncSession, group_id: str, patch: dict[str, Any]
) -> dict[str, Any] | None:
    columns = {
        "name": "name",
        "description": "description",
        "is_active": "is_active",
    }
    selected = [(columns[key], value) for key, value in patch.items() if key in columns]
    if not selected:
        return None
    set_clause = ", ".join(f"{column} = :value_{index}" for index, (column, _) in enumerate(selected))
    params = {f"value_{index}": value for index, (_, value) in enumerate(selected)}
    params["group_id"] = _uuid_param(group_id)
    await db.execute(
        text(f"UPDATE public.admin_groups SET {set_clause} WHERE id = :group_id"),
        params,
    )
    return await get_group(db, group_id)


async def delete_group(db: AsyncSession, group_id: str) -> None:
    await db.execute(
        text("DELETE FROM public.admin_groups WHERE id = :group_id"),
        {"group_id": _uuid_param(group_id)},
    )


async def replace_group_members(
    db: AsyncSession, group_id: str, user_ids: list[str]
) -> None:
    await db.execute(
        text("DELETE FROM public.admin_user_groups WHERE group_id = :group_id"),
        {"group_id": _uuid_param(group_id)},
    )
    if user_ids:
        await db.execute(
            text(
                """
                INSERT INTO public.admin_user_groups (group_id, user_id)
                SELECT :group_id, item.user_id
                  FROM unnest(CAST(:user_ids AS uuid[])) AS item(user_id)
                """
            ),
            {
                "group_id": _uuid_param(group_id),
                "user_ids": [UUID(value) for value in user_ids],
            },
        )


async def replace_user_groups(
    db: AsyncSession, user_id: str, group_ids: list[str]
) -> None:
    protected_result = await db.execute(
        text(
            """
            SELECT g.id
              FROM public.admin_user_groups AS ug
              JOIN public.admin_groups AS g ON g.id = ug.group_id
             WHERE ug.user_id = :user_id AND g.is_protected
            """
        ),
        {"user_id": _uuid_param(user_id)},
    )
    preserved_ids = [row["id"] for row in protected_result.mappings()]
    desired_ids = list(dict.fromkeys([UUID(value) for value in group_ids] + preserved_ids))
    await db.execute(
        text("DELETE FROM public.admin_user_groups WHERE user_id = :user_id"),
        {"user_id": _uuid_param(user_id)},
    )
    if desired_ids:
        await db.execute(
            text(
                """
                INSERT INTO public.admin_user_groups (user_id, group_id)
                SELECT :user_id, item.group_id
                  FROM unnest(CAST(:group_ids AS uuid[])) AS item(group_id)
                """
            ),
            {
                "user_id": _uuid_param(user_id),
                "group_ids": desired_ids,
            },
        )


async def get_user_group_ids(db: AsyncSession, user_id: str) -> list[str]:
    result = await db.execute(
        text("SELECT group_id FROM public.admin_user_groups WHERE user_id = :user_id"),
        {"user_id": _uuid_param(user_id)},
    )
    return [str(row["group_id"]) for row in result.mappings()]


async def set_user_group_membership(
    db: AsyncSession, user_id: str, group_id: str, assigned: bool
) -> None:
    if assigned:
        await db.execute(
            text(
                """
                INSERT INTO public.admin_user_groups (user_id, group_id)
                VALUES (:user_id, :group_id)
                ON CONFLICT (user_id, group_id) DO NOTHING
                """
            ),
            {"user_id": _uuid_param(user_id), "group_id": _uuid_param(group_id)},
        )
    else:
        await db.execute(
            text(
                """
                DELETE FROM public.admin_user_groups
                 WHERE user_id = :user_id AND group_id = :group_id
                """
            ),
            {"user_id": _uuid_param(user_id), "group_id": _uuid_param(group_id)},
        )


async def replace_group_permissions(
    db: AsyncSession, group_id: str, permissions: list[dict[str, str]]
) -> None:
    keys = [entry["permissionKey"] for entry in permissions]
    result = await db.execute(
        text(
            """
            SELECT id, permission_key FROM public.admin_permissions
             WHERE permission_key = ANY(CAST(:keys AS text[]))
            """
        ),
        {"keys": keys},
    )
    permission_ids = {row["permission_key"]: row["id"] for row in result.mappings()}
    if len(permission_ids) != len(keys):
        raise ValueError("unknown permission key")
    await db.execute(
        text("DELETE FROM public.admin_group_permissions WHERE group_id = :group_id"),
        {"group_id": _uuid_param(group_id)},
    )
    if permissions:
        for entry in permissions:
            await db.execute(
                text(
                    """
                    INSERT INTO public.admin_group_permissions (group_id, permission_id, effect)
                    VALUES (:group_id, :permission_id, :effect)
                    """
                ),
                {
                    "group_id": _uuid_param(group_id),
                    "permission_id": permission_ids[entry["permissionKey"]],
                    "effect": entry["effect"],
                },
            )


async def list_audit_events(db: AsyncSession, limit: int) -> list[dict[str, Any]]:
    result = await db.execute(
        text(
            """
            SELECT id, actor_user_id, action, target_type, target_id, outcome,
                   request_id, metadata, created_at
              FROM public.admin_audit_events
             ORDER BY created_at DESC LIMIT :limit
            """
        ),
        {"limit": limit},
    )
    rows = []
    for row in result.mappings():
        item = dict(row)
        item["id"] = str(item["id"])
        item["actor_user_id"] = str(item["actor_user_id"]) if item["actor_user_id"] else None
        rows.append(item)
    return rows


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def is_unique_violation(error: IntegrityError) -> bool:
    return getattr(getattr(error, "orig", None), "sqlstate", None) == "23505"


def is_foreign_key_violation(error: IntegrityError) -> bool:
    return getattr(getattr(error, "orig", None), "sqlstate", None) == "23503"
