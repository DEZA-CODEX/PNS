from __future__ import annotations

from fastapi import APIRouter, Request

from app.core.responses import JSONResponse

router = APIRouter()


@router.get("/contact")
async def contact(request: Request) -> JSONResponse:
    return JSONResponse(
        {
            "success": True,
            "requestId": getattr(request.state, "request_id", "unknown"),
            "hotel": "PNS Nakshatra",
            "address": "Katpadi Road, Vellore 632004, Tamil Nadu",
            "phone": "+91 416 222 2222",
            "whatsapp": "https://wa.me/914162222222",
            "email": "stay@pnsnakshatra.com",
            "map": "https://www.google.com/maps?q=Katpadi%20Road%2C%20Vellore%20632004&output=embed",
        }
    )
