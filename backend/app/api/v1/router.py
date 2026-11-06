from fastapi import APIRouter

from app.api.v1.admin import router as admin_router
from app.api.v1.about import router as about_router
from app.api.v1.banquet import router as banquet_router
from app.api.v1.contact import router as contact_router
from app.api.v1.dining import router as dining_router
from app.api.v1.images import router as images_router
from app.api.v1.rooms import router as rooms_router
from app.api.v1.API.homepage import router as homepage_router

router = APIRouter()
router.include_router(admin_router, prefix="/admin", tags=["admin"])
router.include_router(about_router, tags=["images"])
router.include_router(banquet_router, tags=["banquet"])
router.include_router(contact_router, tags=["contact"])
router.include_router(dining_router, tags=["dining"])
router.include_router(rooms_router, tags=["rooms"])
router.include_router(homepage_router, tags=["images"])
router.include_router(images_router, tags=["images"])
