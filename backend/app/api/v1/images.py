from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.exceptions import ImageManagementError
from app.core.responses import JSONResponse
from app.services.image_service import image_content, list_images

router = APIRouter()
Database = Annotated[AsyncSession, Depends(get_db_session)]


@router.get(
    "/images/content/{image_id}",
    name="managed_image_content",
    include_in_schema=False,
)
async def managed_image_content(image_id: str, db: Database) -> Response:
    image = await image_content(db, image_id)
    if image is None:
        raise ImageManagementError("not_found", "The image was not found.", 404)
    return Response(
        content=image["image_data"],
        media_type=image["content_type"] or "application/octet-stream",
        headers={
            "Cache-Control": "public, max-age=3600",
            "X-Content-Type-Options": "nosniff",
        },
    )


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
