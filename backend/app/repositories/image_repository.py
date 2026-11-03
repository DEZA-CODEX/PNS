from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


def _uuid_param(value: str | UUID | None) -> UUID | None:
    if value is None or isinstance(value, UUID):
        return value
    try:
        return UUID(str(value))
    except ValueError:
        return None


def _image(row: dict[str, Any]) -> dict[str, Any]:
    updated = row.get("updated_at")
    cache_version = str(updated or row["id"])
    url = str(row.get("public_url") or "")
    if url:
        separator = "&" if "?" in url else "?"
        url = f"{url}{separator}v={''.join(c for c in cache_version if c.isalnum() or c in '_-')}"
    storage_path = str(row["storage_path"]) if row.get("storage_path") else None
    return {
        "id": str(row["id"]),
        "category": str(row["category_id"]),
        "url": url,
        "path": storage_path,
        "sourceType": row["source_type"],
        "filename": storage_path.rsplit("/", 1)[-1] if storage_path else None,
        "displayLocation": row.get("display_location") or "gallery",
        "displayOrder": int(row.get("display_order") or 0),
        "active": bool(row.get("is_active", True)),
        "updatedAt": updated.isoformat() if hasattr(updated, "isoformat") else updated,
    }


async def list_managed_images(
    db: AsyncSession,
    collection: str,
    category: str,
    display_location: str | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    statement = """
        SELECT id, category_id, public_url, storage_path, source_type,
               display_location, display_order, is_active, updated_at
          FROM public.managed_images
         WHERE category_type = :collection AND category_id = :category AND is_active
    """
    params: dict[str, Any] = {"collection": collection, "category": category}
    if display_location:
        statement += " AND display_location = :display_location"
        params["display_location"] = display_location
    statement += " ORDER BY display_order, created_at"
    result = await db.execute(text(statement), params)
    images = [_image(dict(row)) for row in result.mappings()]

    hidden_result = await db.execute(
        text(
            """
            SELECT legacy_id
              FROM public.managed_images
             WHERE category_type = :collection AND category_id = :category
               AND source_type = 'bundled' AND NOT is_active AND legacy_id IS NOT NULL
            """
        ),
        {"collection": collection, "category": category},
    )
    hidden_bundled_ids = [str(row["legacy_id"]) for row in hidden_result.mappings()]
    return images, hidden_bundled_ids


async def get_managed_image(
    db: AsyncSession, collection: str, category: str, image_id: str
) -> dict[str, Any] | None:
    image_uuid = _uuid_param(image_id)
    if image_uuid is None:
        return None
    result = await db.execute(
        text(
            """
            SELECT id, category_id, public_url, storage_path, source_type,
                   display_location, display_order, is_active, updated_at, created_by
              FROM public.managed_images
             WHERE category_type = :collection AND category_id = :category AND id = :image_id
             LIMIT 1
            """
        ),
        {"collection": collection, "category": category, "image_id": image_uuid},
    )
    row = result.mappings().first()
    return dict(row) if row is not None else None


async def get_managed_image_for_patch(
    db: AsyncSession, collection: str, image_id: str
) -> dict[str, Any] | None:
    image_uuid = _uuid_param(image_id)
    if image_uuid is None:
        return None
    result = await db.execute(
        text(
            """
            SELECT id, category_type, category_id, public_url, storage_path, source_type,
                   display_location, display_order, is_active, updated_at
              FROM public.managed_images
             WHERE category_type = :collection AND id = :image_id
             LIMIT 1
            """
        ),
        {"collection": collection, "image_id": image_uuid},
    )
    row = result.mappings().first()
    return dict(row) if row is not None else None


async def save_managed_image(
    db: AsyncSession,
    *,
    collection: str,
    category: str,
    url: str,
    storage_path: str | None,
    source_type: str,
    created_by: str | None,
) -> dict[str, Any]:
    result = await db.execute(
        text(
            """
            INSERT INTO public.managed_images
                (category_type, category_id, public_url, storage_path, source_type, created_by)
            VALUES (:collection, :category, :url, :storage_path, :source_type, :created_by)
            RETURNING id, category_id, public_url, storage_path, source_type,
                      display_location, display_order, is_active, updated_at
            """
        ),
        {
            "collection": collection,
            "category": category,
            "url": url,
            "storage_path": storage_path,
            "source_type": source_type,
            "created_by": _uuid_param(created_by),
        },
    )
    row = result.mappings().one()
    return _image(dict(row))


async def disable_managed_image(
    db: AsyncSession, image_id: str, collection: str, category: str
) -> dict[str, Any] | None:
    image_uuid = _uuid_param(image_id)
    if image_uuid is None:
        return None
    result = await db.execute(
        text(
            """
            UPDATE public.managed_images
               SET is_active = false
             WHERE id = :image_id AND category_type = :collection
               AND category_id = :category AND is_active
            RETURNING id, category_type, category_id, public_url, storage_path,
                      source_type, display_location, display_order, is_active, updated_at
            """
        ),
        {"image_id": image_uuid, "collection": collection, "category": category},
    )
    row = result.mappings().first()
    return dict(row) if row is not None else None


async def disable_bundled_image(
    db: AsyncSession, image_id: str, collection: str, category: str
) -> None:
    await db.execute(
        text(
            """
            INSERT INTO public.managed_images
                (category_type, category_id, source_type, public_url, display_location,
                 is_active, legacy_id)
            VALUES (:collection, :category, 'bundled', '', 'gallery', false, :legacy_id)
            ON CONFLICT (legacy_id) DO UPDATE SET is_active = false
            """
        ),
        {"image_id": image_id, "collection": collection, "category": category,
         "legacy_id": image_id},
    )


async def update_managed_image(
    db: AsyncSession, collection: str, image_id: str, patch: dict[str, Any]
) -> dict[str, Any] | None:
    image_uuid = _uuid_param(image_id)
    if image_uuid is None:
        return None
    columns = {
        "display_location": "display_location",
        "display_order": "display_order",
        "is_active": "is_active",
    }
    selected = [(columns[key], value) for key, value in patch.items() if key in columns]
    if not selected:
        return None
    set_clause = ", ".join(
        f"{column} = :value_{index}" for index, (column, _) in enumerate(selected)
    )
    params = {f"value_{index}": value for index, (_, value) in enumerate(selected)}
    params.update({"collection": collection, "image_id": image_uuid})
    result = await db.execute(
        text(
            f"""
            UPDATE public.managed_images SET {set_clause}
             WHERE id = :image_id AND category_type = :collection
            RETURNING id, category_type, category_id, public_url, storage_path, source_type,
                      display_location, display_order, is_active
            """
        ),
        params,
    )
    row = result.mappings().first()
    return dict(row) if row is not None else None
