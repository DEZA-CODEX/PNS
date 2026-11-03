from fastapi import APIRouter

from app.api.v1.admin import router as admin_router
from app.api.v1.images import router as images_router

router = APIRouter()
router.include_router(admin_router, prefix="/admin", tags=["admin"])
router.include_router(images_router, tags=["images"])
