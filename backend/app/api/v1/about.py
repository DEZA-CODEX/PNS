from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import get_json, set_json
from app.core.config import get_settings
from app.core.database import get_db_session
from app.core.responses import JSONResponse
from app.services.image_service import list_about_images

router = APIRouter()
Database = Annotated[AsyncSession, Depends(get_db_session)]


@router.get("/about")
async def about(request: Request, db: Database) -> JSONResponse:
    return JSONResponse(
        {
            "success": True,
            "requestId": getattr(request.state, "request_id", "unknown"),
            "hotel": "PNS Nakshatra",
            "introduction": "Hotel PNS Nakshatra is a contemporary 3-star luxury hotel in Vellore.",
            **await list_about_images(db),
        },
        headers={"Cache-Control": "no-store"},
    )


@router.get("/images/about")
async def about_images(request: Request, db: Database) -> JSONResponse:
    payload = await get_json("images:about")
    if payload is None:
        payload = await list_about_images(db)
        await set_json("images:about", payload, get_settings().image_cache_ttl_seconds)
    return JSONResponse(
        {"success": True, "requestId": getattr(request.state, "request_id", "unknown"), **payload},
        headers={"Cache-Control": "no-store"},
    )
