# apps/api/app/services/share_codec.py
# docs: 09-features.md#f4-open-shared · 07-api-contracts.md#save · #submit
#
# Canonical hashing for share/submit. The inline `/p/<lz>` payload is decoded on
# the CLIENT (services/compression.ts) and never reaches the server; `/api/level/save`
# and `/api/submit` receive a full Level, so the server only needs deterministic
# content hashing here (sha256 over canonical JSON), not an lz-string port.
from __future__ import annotations

import hashlib
import json

from ..agents.schemas import Level


def canonical_json(level: Level) -> str:
    """Stable JSON: sorted keys, no insignificant whitespace. Matches the client."""
    return json.dumps(level.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))


def _sha256_hex(level: Level) -> str:
    return hashlib.sha256(canonical_json(level).encode("utf-8")).hexdigest()


def short_hash(level: Level, length: int = 6) -> str:
    """Short id for /l/{hash} URLs (docs/07 §4)."""
    return _sha256_hex(level)[:length]


def content_hash(level: Level) -> str:
    """12-char content hash for submission idempotency (docs/04 §submission)."""
    return _sha256_hex(level)[:12]
