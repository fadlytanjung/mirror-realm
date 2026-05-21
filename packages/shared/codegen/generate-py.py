# packages/shared/codegen/generate-py.py
# docs: 02-repository-structure.md#shared
#
# Generates apps/api/app/agents/schemas.py from packages/shared/level.schema.json
# using datamodel-code-generator. Run from the backend venv:
#
#   cd apps/api && uv run python ../../packages/shared/codegen/generate-py.py
#
# Edit the SOURCE schema, never the generated schemas.py.
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SHARED = HERE.parent
SCHEMA = SHARED / "level.schema.json"
OUT = SHARED.parent.parent / "apps" / "api" / "app" / "agents" / "schemas.py"

BANNER = (
    "# apps/api/app/agents/schemas.py\n"
    "# docs: 04-domain-model.md#level\n"
    "# DO NOT EDIT BY HAND — generated from packages/shared/level.schema.json by\n"
    "# `uv run python packages/shared/codegen/generate-py.py`.\n"
)


def main() -> int:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "datamodel-codegen",
        "--input",
        str(SCHEMA),
        "--input-file-type",
        "jsonschema",
        "--output",
        str(OUT),
        "--output-model-type",
        "pydantic_v2.BaseModel",
        "--use-annotated",
        "--field-constraints",
        "--target-python-version",
        "3.12",
        "--class-name",
        "Level",
        "--use-default-kwarg",
        "--disable-timestamp",
    ]
    result = subprocess.run(cmd)
    if result.returncode != 0:
        return result.returncode
    # Prepend our banner + forbid-extra config note for traceability.
    body = OUT.read_text(encoding="utf-8")
    OUT.write_text(BANNER + "\n" + body, encoding="utf-8")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
