from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db_session
from app.core.cache import get_json, set_json
from app.core.responses import JSONResponse
from app.services.image_service import list_homepage_images

router = APIRouter()
Database = Annotated[AsyncSession, Depends(get_db_session)]


@router.get("/images/homepage")
async def homepage_images(request: Request, db: Database) -> JSONResponse:
    cache_key = "images:homepage"
    payload = await get_json(cache_key)
    if payload is None:
        payload = await list_homepage_images(db)
        await set_json(cache_key, payload, get_settings().image_cache_ttl_seconds)
    return JSONResponse(
        {
            "success": True,
            "requestId": getattr(request.state, "request_id", "unknown"),
            **payload,
        },
        headers={"Cache-Control": "public, max-age=30, stale-while-revalidate=60"},
    )
