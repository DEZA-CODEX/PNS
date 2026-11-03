from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.exceptions import ImageManagementError
from app.core.responses import JSONResponse
from app.services.image_service import list_images

router = APIRouter()
Database = Annotated[AsyncSession, Depends(get_db_session)]


@router.get("/images/{collection}")
async def public_images(
    request: Request,
    collection: str,
    db: Database,
    category: str | None = Query(default=None, alias="type"),
    location: str | None = Query(default=None),
) -> JSONResponse:
    if collection not in {"room", "dining"}:
        raise ImageManagementError("invalid_collection", "The image collection is invalid.", 400)
    if not category:
        raise ImageManagementError("invalid_category", "The image category is invalid.", 400)
    images, hidden_ids = await list_images(db, collection, category, location)
    return JSONResponse(
        {
            "success": True,
            "requestId": getattr(request.state, "request_id", "unknown"),
            "category": category,
            "images": images,
            "disabledBundledIds": hidden_ids,
        },
        headers={"Cache-Control": "no-store"},
    )
