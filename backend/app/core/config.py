from __future__ import annotations

import ipaddress
import os
import re
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
    backend_public_url: str = Field(default="", validation_alias="BACKEND_PUBLIC_URL")
    diagnostics_token: str | None = Field(
        default=None, min_length=32, validation_alias="PNS_DIAGNOSTICS_TOKEN"
    )
    diagnostics_timeout_seconds: float = Field(
        default=3.0, validation_alias="PNS_DIAGNOSTICS_TIMEOUT_SECONDS", gt=0, le=5
    )
    database_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices("DATABASE_URL", "SUPABASE_DB_URL"),
    )
    supabase_url: str | None = Field(default=None, validation_alias="SUPABASE_URL")
    supabase_secret_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
    )
    supabase_storage_bucket: str | None = Field(
        default=None, validation_alias="SUPABASE_STORAGE_BUCKET"
    )
    supabase_storage_public: bool = Field(
        default=False, validation_alias="SUPABASE_STORAGE_PUBLIC"
    )
    database_pool_size: int = Field(
        default=1,
        validation_alias="PNS_DATABASE_POOL_SIZE",
        gt=0,
        le=10,
    )
    database_max_overflow: int = Field(
        default=0,
        validation_alias="PNS_DATABASE_MAX_OVERFLOW",
        ge=0,
        le=10,
    )
    database_pool_recycle_seconds: int = Field(
        default=300,
        validation_alias="PNS_DATABASE_POOL_RECYCLE_SECONDS",
        gt=0,
        le=3600,
    )
    database_pool_timeout_seconds: float = Field(
        default=5.0,
        validation_alias="PNS_DATABASE_POOL_TIMEOUT_SECONDS",
        gt=0,
        le=30,
    )
    redis_url: str | None = Field(default=None, validation_alias="REDIS_URL")
    upstash_redis_rest_url: str | None = Field(
        default=None, validation_alias="UPSTASH_REDIS_REST_URL"
    )
    upstash_redis_rest_token: str | None = Field(
        default=None, validation_alias="UPSTASH_REDIS_REST_TOKEN"
    )
    redis_key_prefix: str = Field(default="pns:backend:", validation_alias="REDIS_KEY_PREFIX")
    redis_default_ttl: int = Field(default=60, validation_alias="REDIS_DEFAULT_TTL", gt=0)
    redis_enabled: bool = Field(default=True, validation_alias="REDIS_ENABLED")
    image_storage_dir: str = Field(
        default="../public/uploads", validation_alias="PNS_IMAGE_STORAGE_DIR"
    )
    session_cookie_name: str = "pns_admin_session"
    session_duration_minutes: int = Field(
        default=8 * 60,
        validation_alias="PNS_SESSION_DURATION_MINUTES",
        gt=0,
    )
    remembered_session_duration_minutes: int = Field(
        default=30 * 24 * 60,
        validation_alias="PNS_REMEMBERED_SESSION_DURATION_MINUTES",
        gt=0,
    )
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

    @field_validator("frontend_url")
    @classmethod
    def normalize_frontend_url(cls, value: str) -> str:
        return _normalize_origin(value) if value.strip() else ""

    @field_validator("backend_public_url")
    @classmethod
    def normalize_backend_public_url(cls, value: str) -> str:
        return _normalize_origin(value) if value.strip() else ""

    @field_validator("cors_origins")
    @classmethod
    def normalize_cors_origins(cls, origins: list[str]) -> list[str]:
        if "*" in origins:
            raise ValueError("CORS_ORIGINS cannot include '*' when credentials are enabled.")
        return list(
            dict.fromkeys(
                _normalize_origin(origin, localhost_http=True) for origin in origins
            )
        )

    @field_validator("allowed_hosts")
    @classmethod
    def reject_wildcard_allowed_host(cls, hosts: list[str]) -> list[str]:
        normalized: list[str] = []
        for host in hosts:
            candidate = host.strip().rstrip(".").lower()
            if not candidate or "*" in candidate:
                raise ValueError(
                    "PNS_ALLOWED_HOSTS must contain exact hostnames, not wildcards."
                )
            try:
                address = ipaddress.ip_address(candidate)
            except ValueError as error:
                if len(candidate) > 253 or not all(
                    re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?", label)
                    for label in candidate.split(".")
                ):
                    raise ValueError(
                        "PNS_ALLOWED_HOSTS must contain hostnames only, without schemes, ports, or paths."
                    ) from error
            else:
                if address.is_unspecified:
                    raise ValueError(
                        "PNS_ALLOWED_HOSTS cannot contain unspecified bind addresses such as 0.0.0.0."
                    )
            normalized.append(candidate)
        return list(dict.fromkeys(normalized))

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
        if self.cookie_samesite == "none" and not self.secure_cookies:
            raise ValueError("PNS_COOKIE_SAMESITE=none requires PNS_SECURE_COOKIES=true.")
        return self


def _normalize_origin(value: str, *, localhost_http: bool = False) -> str:
    candidate = value.strip()
    if not candidate or "?" in candidate or "#" in candidate:
        raise ValueError("Origins must not include queries or fragments.")

    has_scheme = "://" in candidate
    if not has_scheme:
        if candidate.startswith("//"):
            raise ValueError("Origins must include a hostname, not a scheme-relative URL.")
        preliminary = urlsplit(f"https://{candidate}")
        local_origin = preliminary.hostname in {"localhost"}
        if preliminary.hostname:
            try:
                local_origin = local_origin or ipaddress.ip_address(
                    preliminary.hostname
                ).is_loopback
            except ValueError:
                pass
        scheme = "http" if localhost_http and local_origin else "https"
        candidate = f"{scheme}://{candidate}"

    candidate = candidate.rstrip("/")
    try:
        parsed = urlsplit(candidate)
        port = parsed.port
    except ValueError as error:
        raise ValueError("Origins must be valid HTTP(S) origins.") from error
    if (
        parsed.scheme.lower() not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.path
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError(
            "Origins must be complete HTTP(S) origins without paths, queries, or fragments."
        )

    try:
        hostname = parsed.hostname.encode("idna").decode("ascii").lower()
    except UnicodeError as error:
        raise ValueError("Origins must contain a valid hostname.") from error

    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        if len(hostname) > 253 or not all(
            re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?", label)
            for label in hostname.rstrip(".").split(".")
        ):
            raise ValueError("Origins must contain a valid hostname.")

    if ":" in hostname:
        hostname = f"[{hostname}]"
    if port is not None and not (
        (parsed.scheme.lower() == "http" and port == 80)
        or (parsed.scheme.lower() == "https" and port == 443)
    ):
        hostname = f"{hostname}:{port}"
    return f"{parsed.scheme.lower()}://{hostname}"


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
        normalized_key = key.lower()
        if normalized_key == "sslmode":
            asyncpg_query.append(("ssl", value))
        elif normalized_key in {
            "sslrootcert",
            "sslcert",
            "sslkey",
            "application_name",
            "connect_timeout",
            "options",
            "target_session_attrs",
            "channel_binding",
            "tcp_user_timeout",
            "keepalives",
            "keepalives_idle",
            "keepalives_interval",
            "keepalives_count",
        }:
            asyncpg_query.append((normalized_key, value))
        elif normalized_key not in {"pgbouncer", "pooler"}:
            asyncpg_query.append((key, value))
    return urlunsplit(
        parts._replace(
            scheme="postgresql+asyncpg",
            query=urlencode(asyncpg_query),
        )
    )
