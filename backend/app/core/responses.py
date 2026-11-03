from __future__ import annotations

from typing import Any

from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse as FastAPIJSONResponse


class JSONResponse(FastAPIJSONResponse):
    def render(self, content: Any) -> bytes:
        return super().render(jsonable_encoder(content))
