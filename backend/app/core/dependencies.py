from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.admin_types import AdminContext
from app.core.database import get_db_session
from app.core.exceptions import AdminAuthError
from app.repositories.admin_repository import get_admin_context, write_audit_event

DatabaseSession = Annotated[AsyncSession, Depends(get_db_session)]


async def optional_admin_context(
    request: Request,
    db: DatabaseSession,
) -> AdminContext | None:
    return await get_admin_context(
        db,
        request.cookies.get("pns_admin_session"),
        getattr(request.state, "request_id", None),
    )


def require_permission(permission: str):
    async def dependency(
        request: Request,
        db: DatabaseSession,
        context: Annotated[AdminContext | None, Depends(optional_admin_context)],
    ) -> AdminContext:
        if context is None:
            raise AdminAuthError("unauthorized", "Authentication is required.", 401)
        if permission not in context.permissions:
            await write_audit_event(
                db,
                context.user["id"],
                f"authorization.denied.{permission}",
                None,
                None,
                "denied",
                context.request_id,
            )
            raise AdminAuthError(
                "forbidden",
                "You do not have permission to perform this action.",
                403,
            )
        return context

    return dependency
