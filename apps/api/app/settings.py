# apps/api/app/settings.py
# docs: 10-local-development.md#env · 03-tech-stack.md
from __future__ import annotations

import os
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All config comes from MR_*-prefixed env vars (or an env file).

    Locally that file is apps/api/.env. In prod the full env lives in one Secret
    Manager secret (`mirror-realm`) mounted as a file by Cloud Run; MR_ENV_FILE points
    pydantic at the mount path. See docs/13 §3.
    """

    model_config = SettingsConfigDict(
        env_prefix="MR_",
        env_file=os.environ.get("MR_ENV_FILE", ".env"),
        extra="ignore",
    )

    gcp_project: str = "local-dev"
    gcp_location: str = "asia-southeast2"
    firestore_database: str = "(default)"

    gemini_model: str = "gemini-3.5-flash"
    # AI Studio (Gemini Developer API) key. Injected from Secret Manager in prod
    # (docs/13 §3), read from apps/api/.env locally. Empty -> agent calls fail.
    gemini_api_key: str = ""

    daily_gemini_call_cap: int = 300
    daily_gemini_usd_cap: float = 1.0
    daily_submission_cap_per_device: int = 5

    scheduler_sa_email: str = "mirror-realm-scheduler@local-dev.iam.gserviceaccount.com"
    allow_unauth_rotate: bool = False
    rotate_audience: str = ""  # Cloud Run URL; OIDC audience for /api/daily-rotate

    # Public hosting origin for minted /l/{hash} share URLs (docs/07 §4).
    public_base_url: str = ""

    cors_origins_str: str = "http://localhost:5173"

    @property
    def cors_origins(self) -> list[str]:
        """Convert comma-separated string to list for CORS middleware."""
        return [o.strip() for o in self.cors_origins_str.split(",") if o.strip()]

    trace_enabled: bool = True
    git_sha: str = "local-dev"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
