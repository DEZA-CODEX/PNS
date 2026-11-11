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
DINING_CATEGORIES = ("vrindavan", "cloud9", "clinq")


async def _dining_payload(db: AsyncSession, category: str | None) -> dict:
    payload = await list_section_images(db, "dining", DINING_CATEGORIES)
    if category:
        payload["images"] = {category: payload["images"].get(category, [])}
        payload["disabledBundledIds"] = {
            category: payload["disabledBundledIds"].get(category, [])
        }
    return {
        "categories": list(DINING_CATEGORIES),
        "restaurants": [
            {"id": "vrindavan", "name": "Vrindavan", "category": "Pure Vegetarian Fine Dining"},
            {"id": "cloud9", "name": "Cloud 9", "category": "Rooftop Multi-Cuisine Restaurant"},
            {"id": "clinq", "name": "Clinq", "category": "Lounge & Bar"},
        ],
        "images": payload["images"],
        "disabledBundledIds": payload["disabledBundledIds"],
    }


@router.get("/dining")
@router.get("/images/dining")
async def dining(
    request: Request,
    db: Database,
    category: str | None = Query(default=None),
) -> JSONResponse:
    if category is not None and category not in DINING_CATEGORIES:
        return JSONResponse(
            {"success": False, "error": {"code": "invalid_category", "message": "Unknown dining category."}},
            status_code=400,
        )
    cache_key = "images:dining"
    payload = await get_json(cache_key)
    if payload is None:
        payload = await _dining_payload(db, None)
        await set_json(cache_key, payload, get_settings().image_cache_ttl_seconds)
    if category:
        payload = {
            **payload,
            "images": {category: payload["images"].get(category, [])},
            "disabledBundledIds": {category: payload["disabledBundledIds"].get(category, [])},
        }
    return JSONResponse(
        {"success": True, "requestId": getattr(request.state, "request_id", "unknown"), **payload},
        headers={"Cache-Control": "no-store"},
    )
