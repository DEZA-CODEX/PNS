from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db_session
from app.core.cache import get_json, set_json
from app.core.responses import JSONResponse
from app.services.image_service import list_section_images

router = APIRouter()
Database = Annotated[AsyncSession, Depends(get_db_session)]
ROOM_CATEGORIES = ("vajra", "garuda", "arohana", "madhurya", "maayukha")


@router.get("/rooms")
@router.get("/images/rooms")
async def rooms(
    request: Request,
    db: Database,
    category: str | None = Query(default=None),
) -> JSONResponse:
    if category is not None and category not in ROOM_CATEGORIES:
        return JSONResponse(
            {"success": False, "error": {"code": "invalid_category", "message": "Unknown room category."}},
            status_code=400,
        )
    cache_key = "images:rooms"
    payload = await get_json(cache_key)
    if payload is None:
        payload = await list_section_images(db, "room", ROOM_CATEGORIES)
        await set_json(cache_key, payload, get_settings().image_cache_ttl_seconds)
    if category:
        payload["images"] = {category: payload["images"].get(category, [])}
        payload["disabledBundledIds"] = {category: payload["disabledBundledIds"].get(category, [])}
    return JSONResponse(
        {
            "success": True,
            "requestId": getattr(request.state, "request_id", "unknown"),
            "categories": list(ROOM_CATEGORIES),
            "rooms": [
                {"id": "vajra", "name": "Vajra", "category": "Premium Rooms"},
                {"id": "garuda", "name": "Garuda", "category": "Luxury Rooms"},
                {"id": "arohana", "name": "Arohana", "category": "Balcony Rooms"},
                {"id": "madhurya", "name": "Madhurya", "category": "Junior Suite"},
                {"id": "maayukha", "name": "Maayukha", "category": "Suite Rooms"},
            ],
            **payload,
        },
        headers={"Cache-Control": "no-store"},
    )
