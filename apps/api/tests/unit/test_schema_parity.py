# apps/api/tests/unit/test_schema_parity.py
# docs: 02-repository-structure.md#shared · 04-domain-model.md#vibes
# Guards that the Python models stay in sync with the canonical JSON Schema.
import json
from pathlib import Path

from app.agents.schemas import Level
from app.domain.vibes import VIBE_IDS

SCHEMA = Path(__file__).resolve().parents[4] / "packages" / "shared" / "level.schema.json"


def _schema() -> dict:
    return json.loads(SCHEMA.read_text(encoding="utf-8"))


def test_vibe_enum_matches_schema() -> None:
    schema_vibes = tuple(_schema()["properties"]["vibe"]["enum"])
    assert VIBE_IDS == schema_vibes


def test_platform_bounds_match_schema() -> None:
    schema = _schema()
    plats = schema["properties"]["platforms"]
    assert plats["minItems"] == 4
    assert plats["maxItems"] == 12
    # Pydantic enforces the same min/max on the platforms field.
    field = Level.model_fields["platforms"]
    metadata = {type(m).__name__: m for m in field.metadata}
    assert any(getattr(m, "min_length", None) == 4 for m in field.metadata)
    assert any(getattr(m, "max_length", None) == 12 for m in field.metadata)
    assert metadata  # sanity: constraints are present
