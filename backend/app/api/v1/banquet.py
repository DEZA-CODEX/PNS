from __future__ import annotations

from fastapi import APIRouter, Request

from app.core.responses import JSONResponse

router = APIRouter()


@router.get("/banquet")
async def banquet(request: Request) -> JSONResponse:
    return JSONResponse(
        {
            "success": True,
            "requestId": getattr(request.state, "request_id", "unknown"),
            "managedImages": [],
            "managedImagesSupported": False,
            "halls": [
                {
                    "name": "Tamara",
                    "capacity": "600 guests",
                    "use": "Weddings & receptions",
                    "description": "An elegant setting for memorable celebrations and gatherings.",
                },
                {
                    "name": "Tavisha",
                    "capacity": "300 guests",
                    "use": "Engagements & socials",
                    "description": "A welcoming venue for family, friends, and colleagues.",
                },
                {
                    "name": "Titiksha",
                    "capacity": "60 guests",
                    "use": "Board meetings",
                    "description": "A versatile space for private, social, and professional events.",
                },
            ],
        }
    )
