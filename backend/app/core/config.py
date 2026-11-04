from __future__ import annotations

import os
from functools import lru_cache
from typing import Annotated, Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import AliasChoices, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_ignore_empty=True,
        extra="ignore",
        populate_by_name=True,
    )

    app_env: str = "development"
    frontend_url: str = ""
    database_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices("DATABASE_URL", "SUPABASE_DB_URL"),
    )
    redis_url: str | None = Field(default=None, validation_alias="REDIS_URL")
    supabase_url: str | None = Field(default=None, validation_alias="SUPABASE_URL")
    supabase_publishable_key: str | None = Field(
        default=None, validation_alias="SUPABASE_PUBLISHABLE_KEY"
    )
    supabase_service_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE"
        ),
    )
    supabase_jwks_url: str | None = Field(default=None, validation_alias="SUPABASE_JWKS_URL")
    storage_bucket: str | None = Field(
        default=None, validation_alias="PNS_IMAGE_STORAGE_BUCKET"
    )
    image_storage_dir: str = Field(
        default="../public/uploads", validation_alias="PNS_IMAGE_STORAGE_DIR"
    )
    image_storage_backend: str = Field(
        default="file", validation_alias="PNS_IMAGE_BACKEND"
    )
    session_cookie_name: str = "pns_admin_session"
    secure_cookies: bool | None = Field(
        default=None, validation_alias="PNS_SECURE_COOKIES"
    )
    cookie_samesite: str = Field(default="lax", validation_alias="PNS_COOKIE_SAMESITE")
    cookie_domain: str | None = Field(default=None, validation_alias="PNS_COOKIE_DOMAIN")
    api_docs_enabled: bool = Field(default=False, validation_alias="PNS_API_DOCS_ENABLED")
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=list,
        validation_alias=AliasChoices("CORS_ORIGINS", "PNS_CORS_ORIGINS"),
    )
    allowed_hosts: Annotated[list[str], NoDecode] = Field(
        default_factory=list,
        validation_alias="PNS_ALLOWED_HOSTS",
    )
    max_upload_bytes: int = 8 * 1024 * 1024
    max_image_pixels: int = 64_000_000

    @field_validator("cors_origins", "allowed_hosts", mode="before")
    @classmethod
    def parse_csv_list(cls, value: Any) -> Any:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("cors_origins")
    @classmethod
    def reject_wildcard_cors_origin(cls, origins: list[str]) -> list[str]:
        if "*" in origins:
            raise ValueError("CORS_ORIGINS cannot include '*' when credentials are enabled.")
        return origins

    @field_validator("cookie_samesite")
    @classmethod
    def validate_cookie_samesite(cls, value: str) -> str:
        normalized = value.lower()
        if normalized not in {"lax", "strict", "none"}:
            raise ValueError("PNS_COOKIE_SAMESITE must be 'lax', 'strict', or 'none'.")
        return normalized

    @model_validator(mode="before")
    @classmethod
    def derive_secure_cookie_default(cls, values: Any) -> Any:
        if isinstance(values, dict):
            secure_keys = {"secure_cookies", "PNS_SECURE_COOKIES"}
            if not any(key in values for key in secure_keys):
                app_env = values.get("app_env", values.get("APP_ENV", os.getenv("APP_ENV", "")))
                values["secure_cookies"] = str(app_env).lower() == "production"
        return values

    @model_validator(mode="after")
    def normalize_settings(self) -> Settings:
        self.supabase_url = self.supabase_url.rstrip("/") if self.supabase_url else None
        requested_backend = self.image_storage_backend.strip().lower()
        if requested_backend in {"file", "filesystem"}:
            self.image_storage_backend = "file"
        elif requested_backend == "supabase" or self.storage_bucket:
            self.image_storage_backend = "supabase"
        if self.cookie_samesite == "none" and not self.secure_cookies:
            raise ValueError("PNS_COOKIE_SAMESITE=none requires PNS_SECURE_COOKIES=true.")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


def database_url_for_asyncpg(url: str) -> str:
    parts = urlsplit(url)
    if parts.scheme not in {"postgres", "postgresql", "postgresql+asyncpg"}:
        raise ValueError("DATABASE_URL must be a PostgreSQL connection URL.")
    query = parse_qsl(parts.query, keep_blank_values=True)
    asyncpg_query: list[tuple[str, str]] = []
    for key, value in query:
        if key == "sslmode":
            asyncpg_query.append(("ssl", value))
        elif key != "pgbouncer":
            asyncpg_query.append((key, value))
    return urlunsplit(
        parts._replace(
            scheme="postgresql+asyncpg",
            query=urlencode(asyncpg_query),
        )
    )
