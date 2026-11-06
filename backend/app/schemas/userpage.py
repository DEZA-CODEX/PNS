from __future__ import annotations

import re
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator


class AddUserRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: str
    email: str
    group_id: UUID
    password: str

    @field_validator("display_name")
    @classmethod
    def validate_display_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Display name is required.")
        if len(value) > 150:
            raise ValueError("Display name must be 150 characters or fewer.")
        return value

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not value:
            raise ValueError("Email is required.")
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Enter a valid email address.")
        return value

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if not value:
            raise ValueError("Password is required.")
        if len(value) < 8:
            raise ValueError("Password must be at least 8 characters.")
        if len(value.encode("utf-8")) > 4096:
            raise ValueError("Password must be 4096 bytes or fewer.")
        return value
