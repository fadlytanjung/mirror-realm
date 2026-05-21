# apps/api/app/settings.py
# docs: 10-local-development.md#env · 03-tech-stack.md
from __future__ import annotations

from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All config comes from MR_*-prefixed env vars (or apps/api/.env locally)."""

    model_config = SettingsConfigDict(env_prefix="MR_", env_file=".env", extra="ignore")

    gcp_project: str = "local-dev"
    gcp_location: str = "asia-southeast2"
    firestore_database: str = "(default)"

    gemini_model: str = "gemini-3.1-flash-lite"

    daily_gemini_call_cap: int = 300
    daily_gemini_usd_cap: float = 1.0
    daily_submission_cap_per_device: int = 5

    scheduler_sa_email: str = "mirror-realm-scheduler@local-dev.iam.gserviceaccount.com"
    allow_unauth_rotate: bool = False
    rotate_audience: str = ""  # Cloud Run URL; OIDC audience for /api/daily-rotate

    # Public hosting origin for minted /l/{hash} share URLs (docs/07 §4).
    public_base_url: str = ""

    cors_origins: list[str] = ["http://localhost:5173"]

    trace_enabled: bool = True
    git_sha: str = "local-dev"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, v: object) -> object:
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
