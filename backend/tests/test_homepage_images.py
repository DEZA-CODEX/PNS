from __future__ import annotations

import asyncio
from typing import Any

from app.repositories.image_repository import (
    list_about_managed_images,
    list_homepage_managed_images,
)


class _Result:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def mappings(self) -> list[dict[str, Any]]:
        return self._rows


class _Session:
    def __init__(self) -> None:
        self.statements: list[str] = []

    async def execute(self, statement: Any, _params: Any = None) -> _Result:
        self.statements.append(str(statement))
        if len(self.statements) == 1:
            return _Result(
                [
                    {
                        "id": "room-2",
                        "category_type": "room",
                        "category_id": "vajra",
                        "public_url": "https://example.test/two.webp",
                        "storage_path": None,
                        "source_type": "external",
                        "has_database_content": False,
                        "display_location": "homepage",
                        "display_order": 2,
                        "is_active": True,
                        "updated_at": None,
                    },
                    {
                        "id": "room-1",
                        "category_type": "room",
                        "category_id": "vajra",
                        "public_url": "https://example.test/one.webp",
                        "storage_path": None,
                        "source_type": "external",
                        "has_database_content": False,
                        "display_location": "homepage",
                        "display_order": 1,
                        "is_active": True,
                        "updated_at": None,
                    },
                ]
            )
        return _Result(
            [
                {
                    "category_type": "dining",
                    "category_id": "cloud9",
                    "legacy_id": "cloud9:old.webp",
                }
            ]
        )


class _AboutSession:
    def __init__(self) -> None:
        self.statements: list[str] = []

    async def execute(self, statement: Any, _params: Any = None) -> _Result:
        self.statements.append(str(statement))
        if len(self.statements) == 1:
            return _Result(
                [
                    {
                        "id": "dining-1",
                        "category_type": "dining",
                        "category_id": "vrindavan",
                        "public_url": "https://example.test/vrindavan.webp",
                        "storage_path": None,
                        "source_type": "external",
                        "has_database_content": False,
                        "display_location": "aboutPage",
                        "display_order": 1,
                        "is_active": True,
                        "updated_at": None,
                    }
                ]
            )
        return _Result([])


def test_homepage_images_batches_metadata_and_overrides() -> None:
    session = _Session()
    payload = asyncio.run(list_homepage_managed_images(session))  # type: ignore[arg-type]

    assert len(session.statements) == 2
    assert payload["images"]["room"]["vajra"][0]["id"] == "room-2"
    assert payload["images"]["room"]["vajra"][1]["id"] == "room-1"
    assert payload["images"]["dining"] == {}
    assert payload["disabledBundledIds"]["dining"]["cloud9"] == ["cloud9:old.webp"]
    assert "SELECT image_data" not in session.statements[0]


def test_about_images_batches_dining_metadata_and_overrides() -> None:
    session = _AboutSession()
    payload = asyncio.run(list_about_managed_images(session))  # type: ignore[arg-type]

    assert len(session.statements) == 2
    assert payload["images"]["dining"]["vrindavan"][0]["id"] == "dining-1"
    assert payload["disabledBundledIds"]["dining"] == {}
