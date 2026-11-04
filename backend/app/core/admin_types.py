from __future__ import annotations

from dataclasses import dataclass

ADMIN_PERMISSIONS = (
    "room_images.read",
    "room_images.upload",
    "room_images.add_url",
    "room_images.delete",
    "dining_images.read",
    "dining_images.upload",
    "dining_images.add_url",
    "dining_images.delete",
    "users.read",
    "users.create",
    "users.update",
    "users.disable",
    "groups.read",
    "groups.create",
    "groups.update",
    "groups.delete",
    "groups.members.manage",
    "groups.permissions.manage",
    "audit.read",
)


@dataclass(frozen=True)
class AdminContext:
    user: dict
    permissions: frozenset[str]
    request_id: str
