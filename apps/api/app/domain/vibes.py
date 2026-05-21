# apps/api/app/domain/vibes.py
# docs: 04-domain-model.md#vibes
from __future__ import annotations

from typing import get_args

from ..agents.schemas import Vibe

VIBE_IDS: tuple[str, ...] = get_args(Vibe)

# Fallback rule (docs/04 §3): substitute when a vibe is lost/invalid.
FALLBACK_VIBE: str = "cozy"


def is_valid_vibe(value: str) -> bool:
    return value in VIBE_IDS
