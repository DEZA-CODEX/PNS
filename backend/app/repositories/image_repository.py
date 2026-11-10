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
    is_database_image = bool(row.get("has_database_content"))
    storage_path = str(row["storage_path"]) if row.get("storage_path") else None
    is_storage_image = (
        row.get("source_type") == "upload"
        and not is_database_image
        and storage_path is not None
    )
    url = str(row.get("public_url") or "")
    if is_database_image:
        url = f"/api/v1/images/content/{row['id']}"
    elif is_storage_image:
        url = ""
    elif row.get("source_type") != "external" and url:
        separator = "&" if "?" in url else "?"
        url = f"{url}{separator}v={''.join(c for c in cache_version if c.isalnum() or c in '_-')}"
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
        SELECT id, category_id, public_url, storage_path, source_type, content_type,
               image_data IS NOT NULL AS has_database_content,
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


async def list_collection_managed_images(
    db: AsyncSession,
    collection: str,
    categories: tuple[str, ...],
) -> dict[str, dict[str, list[dict[str, Any]]] | list[str]]:
    """Load all active images and bundled overrides for a collection in two queries."""
    category_params = {f"category_{index}": category for index, category in enumerate(categories)}
    placeholders = ", ".join(f":category_{index}" for index in range(len(categories)))
    params = {"collection": collection, **category_params}
    result = await db.execute(
        text(
            f"""
            SELECT id, category_id, public_url, storage_path, source_type, content_type,
                   image_data IS NOT NULL AS has_database_content,
                   display_location, display_order, is_active, updated_at
              FROM public.managed_images
             WHERE category_type = :collection
               AND category_id IN ({placeholders})
               AND is_active
             ORDER BY category_id, display_order, created_at
            """
        ),
        params,
    )
    images: dict[str, list[dict[str, Any]]] = {category: [] for category in categories}
    for row in result.mappings():
        mapped = dict(row)
        images.setdefault(str(mapped["category_id"]), []).append(_image(mapped))

    hidden_result = await db.execute(
        text(
            f"""
            SELECT category_id, legacy_id
              FROM public.managed_images
             WHERE category_type = :collection
               AND category_id IN ({placeholders})
               AND source_type = 'bundled'
               AND NOT is_active
               AND legacy_id IS NOT NULL
             ORDER BY category_id, legacy_id
            """
        ),
        params,
    )
    disabled: dict[str, list[str]] = {category: [] for category in categories}
    for row in hidden_result.mappings():
        mapped = dict(row)
        disabled.setdefault(str(mapped["category_id"]), []).append(str(mapped["legacy_id"]))
    return {"images": images, "disabledBundledIds": disabled}


async def list_homepage_managed_images(
    db: AsyncSession,
) -> dict[str, dict[str, dict[str, list[dict[str, Any]]]]]:
    result = await db.execute(
        text(
            """
            SELECT id, category_type, category_id, public_url, storage_path, source_type, content_type,
                   image_data IS NOT NULL AS has_database_content,
                   display_location, display_order, is_active, updated_at
              FROM public.managed_images
             WHERE category_type IN ('room', 'dining') AND is_active
             ORDER BY category_type, category_id, display_order, created_at
            """
        )
    )
    images: dict[str, dict[str, list[dict[str, Any]]]] = {"room": {}, "dining": {}}
    for row in result.mappings():
        mapped = dict(row)
        collection = str(mapped["category_type"])
        category = str(mapped["category_id"])
        images[collection].setdefault(category, []).append(_image(mapped))

    hidden_result = await db.execute(
        text(
            """
            SELECT category_type, category_id, legacy_id
              FROM public.managed_images
             WHERE category_type IN ('room', 'dining')
               AND source_type = 'bundled' AND NOT is_active AND legacy_id IS NOT NULL
             ORDER BY category_type, category_id, legacy_id
            """
        )
    )
    disabled: dict[str, dict[str, list[str]]] = {"room": {}, "dining": {}}
    for row in hidden_result.mappings():
        mapped = dict(row)
        collection = str(mapped["category_type"])
        category = str(mapped["category_id"])
        disabled[collection].setdefault(category, []).append(str(mapped["legacy_id"]))

    return {
        "images": images,
        "disabledBundledIds": disabled,
    }


async def list_about_managed_images(
    db: AsyncSession,
) -> dict[str, dict[str, dict[str, list[dict[str, Any]]]]]:
    result = await db.execute(
        text(
            """
            SELECT id, category_type, category_id, public_url, storage_path, source_type, content_type,
                   image_data IS NOT NULL AS has_database_content,
                   display_location, display_order, is_active, updated_at
              FROM public.managed_images
             WHERE category_type = 'dining' AND is_active
             ORDER BY category_id, display_order, created_at
            """
        )
    )
    images: dict[str, dict[str, list[dict[str, Any]]]] = {"dining": {}}
    for row in result.mappings():
        mapped = dict(row)
        category = str(mapped["category_id"])
        images["dining"].setdefault(category, []).append(_image(mapped))

    hidden_result = await db.execute(
        text(
            """
            SELECT category_type, category_id, legacy_id
              FROM public.managed_images
             WHERE category_type = 'dining'
               AND source_type = 'bundled' AND NOT is_active AND legacy_id IS NOT NULL
             ORDER BY category_id, legacy_id
            """
        )
    )
    disabled: dict[str, dict[str, list[str]]] = {"dining": {}}
    for row in hidden_result.mappings():
        mapped = dict(row)
        category = str(mapped["category_id"])
        disabled["dining"].setdefault(category, []).append(str(mapped["legacy_id"]))

    return {"images": images, "disabledBundledIds": disabled}


async def get_managed_image(
    db: AsyncSession, collection: str, category: str, image_id: str
) -> dict[str, Any] | None:
    image_uuid = _uuid_param(image_id)
    if image_uuid is None:
        return None
    result = await db.execute(
        text(
            """
            SELECT id, category_id, public_url, storage_path, source_type, content_type,
                   image_data IS NOT NULL AS has_database_content,
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
    image_data: bytes | None = None,
    content_type: str | None = None,
) -> dict[str, Any]:
    result = await db.execute(
        text(
            """
            INSERT INTO public.managed_images
                (category_type, category_id, public_url, storage_path, source_type,
                 created_by, image_data, content_type)
            VALUES (:collection, :category, :url, :storage_path, :source_type,
                    :created_by, :image_data, :content_type)
            RETURNING id, category_id, public_url, storage_path, source_type, content_type,
                      image_data IS NOT NULL AS has_database_content,
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
            "image_data": image_data,
            "content_type": content_type,
        },
    )
    row = result.mappings().one()
    return _image(dict(row))


async def get_managed_image_content(db: AsyncSession, image_id: str) -> dict[str, Any] | None:
    image_uuid = _uuid_param(image_id)
    if image_uuid is None:
        return None
    result = await db.execute(
        text(
            """
                        SELECT image_data, content_type, source_type, storage_path,
                                     category_type, category_id
              FROM public.managed_images
             WHERE id = :image_id AND source_type = 'upload'
               AND is_active AND (image_data IS NOT NULL OR storage_path IS NOT NULL)
             LIMIT 1
            """
        ),
        {"image_id": image_uuid},
    )
    row = result.mappings().first()
    if row is None:
        return None
    image = dict(row)
    if image["image_data"] is not None:
        image["image_data"] = bytes(image["image_data"])
    return image


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
