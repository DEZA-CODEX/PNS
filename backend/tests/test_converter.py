from __future__ import annotations

import io
import json
import zipfile
from collections.abc import Iterator
from copy import deepcopy
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.api import converter as converter_api
from app.celery_app import celery_app
from app.core.config import Settings
from app.main import app, fastapi_app
from app.tasks import converter_tasks
from app.services.converter_service import (
    ConverterImageError,
    convert_image,
    output_filename,
)


def image_bytes(image_format: str = "PNG", *, transparent: bool = False) -> bytes:
    output = io.BytesIO()
    mode = "RGBA" if transparent else "RGB"
    color = (18, 40, 90, 0) if transparent else (18, 40, 90)
    Image.new(mode, (4, 3), color=color).save(output, format=image_format)
    return output.getvalue()


class FakeConverterStore:
    def __init__(self) -> None:
        self.batches: dict[str, dict[str, Any]] = {}
        self.files: dict[tuple[str, str], dict[str, Any]] = {}
        self.data: dict[tuple[str, str], bytes] = {}
        self.originals: dict[tuple[str, str], bytes] = {}

    async def create_batch(self, batch_id: str, metadata: dict[str, Any]) -> None:
        self.batches[batch_id] = deepcopy(metadata)

    async def create_file(
        self,
        batch_id: str,
        file_id: str,
        metadata: dict[str, Any],
    ) -> None:
        self.files[(batch_id, file_id)] = deepcopy(metadata)

    async def get_batch(self, batch_id: str) -> dict[str, Any] | None:
        batch = self.batches.get(batch_id)
        return deepcopy(batch) if batch is not None else None

    async def save_original(self, batch_id: str, file_id: str, data: bytes) -> None:
        self.originals[(batch_id, file_id)] = data

    async def update_batch(self, batch_id: str, updates: dict[str, Any]) -> dict[str, Any]:
        if batch_id not in self.batches:
            raise RuntimeError("batch expired")
        self.batches[batch_id].update(deepcopy(updates))
        return deepcopy(self.batches[batch_id])

    async def save_file(
        self,
        batch_id: str,
        file_id: str,
        metadata: dict[str, Any],
        data: bytes,
    ) -> None:
        self.files[(batch_id, file_id)] = deepcopy(metadata)
        self.data[(batch_id, file_id)] = data

    async def get_file(self, batch_id: str, file_id: str) -> dict[str, Any] | None:
        metadata = self.files.get((batch_id, file_id))
        return deepcopy(metadata) if metadata is not None else None

    async def get_file_data(self, batch_id: str, file_id: str) -> bytes | None:
        return self.data.get((batch_id, file_id))

    async def update_file(
        self,
        batch_id: str,
        file_id: str,
        updates: dict[str, Any],
    ) -> dict[str, Any]:
        metadata = self.files[(batch_id, file_id)]
        metadata.update(deepcopy(updates))
        return deepcopy(metadata)

    async def delete_batch(self, batch_id: str) -> None:
        self.batches.pop(batch_id, None)
        for key in list(self.files):
            if key[0] == batch_id:
                self.files.pop(key)
                self.data.pop(key, None)
        for key in list(self.originals):
            if key[0] == batch_id:
                self.originals.pop(key)

    async def cancel_batch(self, batch_id: str) -> dict[str, Any]:
        self.batches[batch_id]["status"] = "cancelled"
        return deepcopy(self.batches[batch_id])


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    store = FakeConverterStore()
    monkeypatch.setattr(converter_api, "create_batch", store.create_batch)
    monkeypatch.setattr(converter_api, "create_file", store.create_file)
    monkeypatch.setattr(converter_api, "get_batch", store.get_batch)
    monkeypatch.setattr(converter_api, "update_batch", store.update_batch)
    monkeypatch.setattr(converter_api, "save_original", store.save_original)
    monkeypatch.setattr(converter_api, "get_file", store.get_file)
    monkeypatch.setattr(converter_api, "get_file_data", store.get_file_data)
    monkeypatch.setattr(converter_api, "delete_batch", store.delete_batch)
    monkeypatch.setattr(converter_api, "cancel_batch", store.cancel_batch)
    monkeypatch.setattr(
        converter_api.celery_app,
        "send_task",
        lambda *args, **kwargs: type("Published", (), {"id": kwargs.get("task_id")})(),
    )
    fastapi_app.dependency_overrides.clear()
    with TestClient(app, base_url="https://testserver") as test_client:
        test_client.converter_store = store
        yield test_client
    fastapi_app.dependency_overrides.clear()


def test_converter_preserves_transparency_and_outputs_webp() -> None:
    converted = convert_image(image_bytes(transparent=True))
    with Image.open(io.BytesIO(converted)) as image:
        assert image.format == "WEBP"
        assert image.mode == "RGBA"


@pytest.mark.parametrize("image_format", ["JPEG", "PNG", "WEBP", "GIF", "TIFF", "BMP"])
def test_converter_supports_static_formats(image_format: str) -> None:
    converted = convert_image(image_bytes(image_format))
    with Image.open(io.BytesIO(converted)) as image:
        assert image.format == "WEBP"


def test_converter_rejects_corrupt_and_unsupported_content() -> None:
    with pytest.raises(ConverterImageError, match="valid image"):
        convert_image(b"not an image")
    unsupported = io.BytesIO()
    Image.new("RGB", (4, 3), color=(18, 40, 90)).save(unsupported, format="PPM")
    with pytest.raises(ConverterImageError, match="Use"):
        convert_image(unsupported.getvalue())


def test_output_names_are_safe_and_unique() -> None:
    used: set[str] = set()
    assert output_filename(r"..\holiday photo.png", used) == "holiday-photo.webp"
    assert output_filename("holiday photo.jpg", used) == "holiday-photo-2.webp"


def test_converter_accepts_more_than_twenty_files_and_processes_fifo(client: TestClient) -> None:
    files = [
        ("files", (f"image-{index}.png", image_bytes(), "image/png"))
        for index in range(21)
    ]
    response = client.post("/convert/", files=files)

    assert response.status_code == 202
    body = response.json()
    assert body["status"] == "queued"
    assert body["total_images"] == 21
    status = client.get(f"/convert/{body['batch_id']}/status")
    assert status.status_code == 200
    assert [item["original_name"] for item in status.json()["images"]] == [
        f"image-{index}.png" for index in range(21)
    ]


def test_converter_continues_after_one_file_fails(client: TestClient) -> None:
    response = client.post(
        "/convert/",
        files=[
            ("files", ("first.png", image_bytes(), "image/png")),
            ("files", ("broken.png", b"broken", "image/png")),
            ("files", ("last.jpg", image_bytes("JPEG"), "image/jpeg")),
        ],
    )

    assert response.status_code == 202
    assert response.json()["status"] == "queued"


def test_individual_and_zip_downloads_and_cleanup(client: TestClient) -> None:
    response = client.post(
        "/convert/",
        files=[
            ("files", ("same.png", image_bytes(), "image/png")),
            ("files", ("same.png", image_bytes("JPEG"), "image/jpeg")),
        ],
    )
    assert response.status_code == 202
    batch_id = response.json()["batch_id"]
    store = client.converter_store
    items = store.batches[batch_id]["items"]
    for item in items:
        converted = convert_image(image_bytes())
        item.update({"status": "completed", "converted_size": len(converted)})
        store.files[(batch_id, item["file_id"])] = deepcopy(item)
        store.data[(batch_id, item["file_id"])] = converted

    individual = client.get(f"/convert/{batch_id}/files/{items[0]['file_id']}")
    assert individual.status_code == 200
    assert individual.headers["content-type"] == "image/webp"
    assert individual.content.startswith(b"RIFF")

    archive = client.get(f"/convert/{batch_id}/download-all")
    assert archive.status_code == 200
    with zipfile.ZipFile(io.BytesIO(archive.content)) as converted_zip:
        assert converted_zip.namelist() == ["same.webp", "same-2.webp"]

    assert client.get("/convert/not-a-batch/status").status_code == 404
    assert (
        client.get(f"/convert/{batch_id}/files/not-a-file").status_code == 404
    )
    assert client.delete(f"/convert/{batch_id}").status_code == 200
    assert client.get(f"/convert/{batch_id}/status").status_code == 200
    assert client.get(f"/convert/{batch_id}/status").json()["status"] == "cancelled"


def test_converter_task_is_registered_and_routed_to_dedicated_queue() -> None:
    assert "pns.tasks.convert_image_batch" in celery_app.tasks
    assert celery_app.conf.task_routes["pns.tasks.convert_image_batch"] == {
        "queue": "pns-converter"
    }
    assert any(queue.name == "pns-converter" for queue in celery_app.conf.task_queues)


def test_settings_accept_vercel_upstash_redis_environment_names(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name in (
        "UPSTASH_REDIS_REST_URL",
        "UPSTASH_REDIS_REST_TOKEN",
        "REDIS_KV_REST_API_URL",
        "REDIS_KV_REST_API_TOKEN",
        "KV_REST_API_URL",
        "KV_REST_API_TOKEN",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("REDIS_KV_REST_API_URL", "https://redis.example.test")
    monkeypatch.setenv("REDIS_KV_REST_API_TOKEN", "test-token")
    monkeypatch.setenv("REDIS_KV_URL", "rediss://redis.example.test:6379")

    settings = Settings(_env_file=None)

    assert settings.upstash_redis_rest_url == "https://redis.example.test"
    assert settings.upstash_redis_rest_token == "test-token"
    assert settings.redis_url == "rediss://redis.example.test:6379"


def test_converter_task_processes_fifo_and_resumes_completed_items(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    batch = {
        "batch_id": "batch-1",
        "status": "queued",
        "file_ids": ["one", "two", "three"],
        "items": [
            {"index": 0, "file_id": "one", "original_size": 1, "status": "waiting"},
            {"index": 1, "file_id": "two", "original_size": 1, "status": "waiting"},
            {"index": 2, "file_id": "three", "original_size": 1, "status": "waiting"},
        ],
    }
    files = {
        ("batch-1", "one"): {"status": "waiting"},
        ("batch-1", "two"): {"status": "completed", "converted_size": 1},
        ("batch-1", "three"): {"status": "waiting"},
    }
    originals = {
        ("batch-1", "one"): b"one",
        ("batch-1", "three"): b"three",
    }
    conversion_order: list[bytes] = []

    def get_batch(batch_id: str) -> dict[str, Any]:
        return deepcopy(batch)

    def update_batch(batch_id: str, updates: dict[str, Any]) -> dict[str, Any]:
        batch.update(deepcopy(updates))
        return deepcopy(batch)

    def get_file(batch_id: str, file_id: str) -> dict[str, Any] | None:
        return deepcopy(files.get((batch_id, file_id)))

    def get_original(batch_id: str, file_id: str) -> bytes | None:
        return originals.get((batch_id, file_id))

    def update_file(batch_id: str, file_id: str, updates: dict[str, Any]) -> dict[str, Any]:
        files[(batch_id, file_id)] = {**files[(batch_id, file_id)], **deepcopy(updates)}
        return deepcopy(files[(batch_id, file_id)])

    def save_result(batch_id: str, file_id: str, metadata: dict[str, Any], data: bytes) -> None:
        conversion_order.append(originals[(batch_id, file_id)])
        files[(batch_id, file_id)] = deepcopy(metadata)

    monkeypatch.setattr(converter_tasks, "sync_get_batch", get_batch)
    monkeypatch.setattr(converter_tasks, "sync_update_batch", update_batch)
    monkeypatch.setattr(converter_tasks, "sync_get_file", get_file)
    monkeypatch.setattr(converter_tasks, "sync_get_original", get_original)
    monkeypatch.setattr(converter_tasks, "sync_update_file", update_file)
    monkeypatch.setattr(converter_tasks, "sync_save_result", save_result)
    monkeypatch.setattr(converter_tasks, "sync_release_active_batch", lambda batch_id: None)
    monkeypatch.setattr(converter_tasks, "convert_image", lambda data, settings: b"webp")

    result = converter_tasks.convert_image_batch.apply(args=["batch-1"]).get()

    assert result["status"] == "completed"
    assert conversion_order == [b"one", b"three"]
    assert batch["status"] == "completed"
