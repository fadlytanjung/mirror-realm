# apps/api/tests/conftest.py
# docs: 06-ai-agent-layer.md#local-test · 14-testing-strategy.md
from __future__ import annotations

from base64 import b64encode

import pytest

from app.agents.schemas import Level, Point, Rect


def _rect(x: int, y: int, w: int, h: int) -> Rect:
    return Rect(x=x, y=y, w=w, h=h)


def good_level() -> Level:
    """Passes invariants I2-I7 and reachability: a descending stair to the goal."""
    return Level(
        vibe="cozy",
        platforms=[
            _rect(0, 80, 300, 40),       # ground beneath spawn (I7)
            _rect(480, 160, 160, 32),
            _rect(820, 260, 160, 32),
            _rect(1160, 360, 160, 32),
            _rect(1500, 440, 160, 32),
            _rect(1700, 480, 220, 48),   # goal platform
        ],
        hazards=[],
        decorations=[],
        spawn=Point(x=50, y=50),
        goal=Point(x=1860, y=440),
    )


def unreachable_level() -> Level:
    """Valid endpoints but a >220px gap after the spawn ground — fails I5."""
    return Level(
        vibe="neon",
        platforms=[
            _rect(0, 80, 300, 40),       # spawn ground
            _rect(700, 80, 160, 40),     # gap 400px from previous — unjumpable
            _rect(1100, 80, 160, 40),
            _rect(1700, 480, 220, 48),   # goal platform (isolated)
        ],
        hazards=[],
        decorations=[],
        spawn=Point(x=50, y=50),
        goal=Point(x=1860, y=440),
    )


@pytest.fixture
def good() -> Level:
    return good_level()


@pytest.fixture
def unreachable() -> Level:
    return unreachable_level()


@pytest.fixture
def fake_photo() -> str:
    # base64 of bytes starting with the JPEG magic, long enough to pass min_length.
    return b64encode(b"\xff\xd8" + b"\x00" * 120).decode("ascii")


@pytest.fixture
def device_hash() -> str:
    return "0123456789abcdef"
