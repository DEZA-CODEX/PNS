from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.responses import JSONResponse
from app.services.image_service import list_homepage_images

router = APIRouter()
Database = Annotated[AsyncSession, Depends(get_db_session)]


@router.get("/images/homepage")
async def homepage_images(request: Request, db: Database) -> JSONResponse:
    payload = await list_homepage_images(db)
    return JSONResponse(
        {
            "success": True,
            "requestId": getattr(request.state, "request_id", "unknown"),
            **payload,
        },
        headers={"Cache-Control": "no-store"},
    )
