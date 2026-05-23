# apps/api/app/agents/schemas.py
# docs: 04-domain-model.md#level
# Checked-in artifact equivalent to the output of
#   uv run python packages/shared/codegen/generate-py.py
# (datamodel-codegen). Regenerate from packages/shared/level.schema.json when the
# schema changes; do not hand-edit field constraints out of sync with the schema.
from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field

# Coordinate/size constraints mirror level.schema.json $defs exactly.
WorldX = Annotated[int, Field(ge=0, le=1920)]
WorldY = Annotated[int, Field(ge=0, le=540)]
SizeW = Annotated[int, Field(ge=16, le=1920)]
SizeH = Annotated[int, Field(ge=16, le=540)]
Label = Annotated[str, Field(max_length=64)]

Vibe = Literal[
    "cozy",
    "neon",
    "ruined",
    "forest",
    "vapor",
    "desert",
    "industrial",
    "snow",
    "underwater",
    "library",
    "cosmic",
    "monochrome",
]

Experience = Literal["platformer", "pixel", "animation"]


class Rect(BaseModel):
    model_config = {"extra": "forbid"}
    x: WorldX
    y: WorldY
    w: SizeW
    h: SizeH
    label: Label | None = None


class Decoration(BaseModel):
    model_config = {"extra": "forbid"}
    x: WorldX
    y: WorldY
    label: Label | None = None


class Point(BaseModel):
    model_config = {"extra": "forbid"}
    x: WorldX
    y: WorldY


class Level(BaseModel):
    model_config = {"extra": "forbid"}
    schemaVersion: Literal["1.0.0"] = "1.0.0"
    vibe: Vibe
    experience: Experience = "platformer"
    platforms: Annotated[list[Rect], Field(min_length=4, max_length=12)]
    hazards: Annotated[list[Rect], Field(max_length=3)] = Field(default_factory=list)
    decorations: Annotated[list[Decoration], Field(max_length=16)] = Field(default_factory=list)
    spawn: Point
    goal: Point
