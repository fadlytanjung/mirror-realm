# apps/api/tests/unit/test_level_invariants.py
# docs: 04-domain-model.md#invariants
from app.agents.schemas import Point
from app.domain.level import validate_endpoints
from tests.conftest import good_level


def test_good_level_has_no_violations() -> None:
    assert validate_endpoints(good_level()) == []


def test_goal_too_close_violates_i3() -> None:
    level = good_level()
    level.goal = Point(x=level.spawn.x + 100, y=440)
    violations = validate_endpoints(level)
    assert any("goal.x must be" in v for v in violations)


def test_spawn_without_ground_violates_i7() -> None:
    level = good_level()
    # Move spawn high above every platform.
    level.spawn = Point(x=50, y=0)
    level.platforms[0].y = 400  # remove ground beneath the (new) spawn
    violations = validate_endpoints(level)
    assert any("nothing to stand on" in v for v in violations)
