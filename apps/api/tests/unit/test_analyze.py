# apps/api/tests/unit/test_analyze.py
# docs: 07-api-contracts.md#analyze · 06-ai-agent-layer.md#retry
from __future__ import annotations

from base64 import b64encode
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.agents.schemas import Level
from app.main import app
from app.routers.analyze import get_agent_runner
from app.services.cost_guard import cost_guard_service
from tests.conftest import good_level, unreachable_level
from tests.fakes.agent_fake import FakeAgent, FakeCostGuard


def _client(scripted: list[Level]) -> tuple[TestClient, FakeAgent]:
    fake = FakeAgent(scripted)
    app.dependency_overrides[get_agent_runner] = lambda: fake
    app.dependency_overrides[cost_guard_service] = lambda: FakeCostGuard()
    return TestClient(app), fake


@pytest.fixture(autouse=True)
def _clear_overrides() -> Iterator[None]:
    yield
    app.dependency_overrides.clear()


def _photo() -> str:
    return b64encode(b"\xff\xd8" + b"\x00" * 120).decode("ascii")


BODY = {"photo": _photo(), "deviceHash": "0123456789abcdef"}


def test_first_attempt_succeeds() -> None:
    client, fake = _client([good_level()])
    res = client.post("/api/analyze", json=BODY)
    assert res.status_code == 200
    body = res.json()
    assert body["wasUnreachableOnFirstAttempt"] is False
    assert body["level"]["vibe"] == "cozy"
    assert len(fake.calls) == 1
    assert res.headers["X-MR-API-Version"] == "1"


def test_retry_recovers_unreachable() -> None:
    client, fake = _client([unreachable_level(), good_level()])
    res = client.post("/api/analyze", json=BODY)
    assert res.status_code == 200
    assert res.json()["wasUnreachableOnFirstAttempt"] is False
    assert len(fake.calls) == 2
    assert fake.calls[1][1] is not None  # retry carried violation strings


def test_still_bad_after_retry_is_flagged() -> None:
    client, fake = _client([unreachable_level(), unreachable_level()])
    res = client.post("/api/analyze", json=BODY)
    assert res.status_code == 200
    assert res.json()["wasUnreachableOnFirstAttempt"] is True
    assert len(fake.calls) == 2


def test_non_jpeg_photo_is_rejected() -> None:
    client, fake = _client([good_level()])
    bad = {"photo": b64encode(b"not-a-jpeg" * 20).decode("ascii"), "deviceHash": "0123456789abcdef"}
    res = client.post("/api/analyze", json=bad)
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "validation_failed"
    assert len(fake.calls) == 0
