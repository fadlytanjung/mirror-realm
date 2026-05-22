# apps/api — Mirror Realm backend

FastAPI + Google ADK (Python 3.12). Specs:
[`docs/06-ai-agent-layer.md`](../../docs/06-ai-agent-layer.md) and
[`docs/07-api-contracts.md`](../../docs/07-api-contracts.md).

```bash
uv sync                                   # install deps into .venv
cp .env.example .env                      # then edit MR_GCP_PROJECT etc.
uv run uvicorn app.main:app --reload --port 8080
```

Quality gates:

```bash
uv run ruff check app
uv run mypy app
uv run pytest -q tests/unit
```

Unit tests use a fake agent + cost guard (no Vertex, no Firestore). Integration
tests run against the Firestore emulator — see
[`docs/10-local-development.md#emulator`](../../docs/10-local-development.md).
