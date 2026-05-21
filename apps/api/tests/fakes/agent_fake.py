# apps/api/tests/fakes/agent_fake.py
# docs: 06-ai-agent-layer.md#local-test
from __future__ import annotations

from app.agents.level_designer import AgentRun
from app.agents.schemas import Level


class FakeAgent:
    """Scripted stand-in for run_level_designer — no Vertex calls."""

    def __init__(self, scripted_returns: list[Level]) -> None:
        self._returns = list(scripted_returns)
        self.calls: list[tuple[bytes, list[str] | None]] = []

    async def __call__(
        self,
        *,
        image_bytes: bytes,
        mime_type: str = "image/jpeg",
        violations_for_retry: list[str] | None = None,
    ) -> AgentRun:
        self.calls.append((image_bytes, violations_for_retry))
        level = self._returns.pop(0)
        return AgentRun(
            level=level,
            input_tokens=300,
            output_tokens=400,
            was_retry=violations_for_retry is not None,
        )


class FakeCostGuard:
    """No-op cost guard so analyze tests don't touch Firestore."""

    def __init__(self) -> None:
        self.runs = 0

    async def check_can_run_agent(self, _today: object) -> None:
        return None

    async def record_agent_run(
        self, _today: object, *, input_tokens: int, output_tokens: int
    ) -> None:
        self.runs += 1
