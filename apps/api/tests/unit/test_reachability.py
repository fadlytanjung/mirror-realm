# apps/api/tests/unit/test_reachability.py
# docs: 04-domain-model.md#invariants (I5)
from app.domain.reachability import check_reachable
from tests.conftest import good_level, unreachable_level


def test_good_level_is_reachable() -> None:
    assert check_reachable(good_level()) is True


def test_big_gap_is_unreachable() -> None:
    assert check_reachable(unreachable_level()) is False
