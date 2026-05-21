# apps/api/app/domain/level.py
# docs: 04-domain-model.md#invariants
#
# Domain invariants I2-I4, I7 (I1/I6/I8 are enforced by the Pydantic schema; I5
# lives in reachability.py). validate_endpoints returns human-readable violation
# strings — empty list means valid. The strings feed the agent retry prompt.
from __future__ import annotations

from ..agents.schemas import Level, Rect
from .physics import PLAYER_H, PLAYER_W

# Re-export so callers can `from ..domain.level import Level`.
__all__ = ["Level", "validate_endpoints"]

MIN_LATERAL = 800       # I3: goal.x >= spawn.x + 800
MAX_PENETRATION = 8     # I4: platform must not overlap an endpoint by > 8px
GROUND_TOLERANCE = 32   # I7: ground within 32px of the spawn's feet


def _penetration(box: tuple[int, int, int, int], rect: Rect) -> int:
    """Min overlap depth (px) between an AABB (x,y,w,h) and a platform rect; 0 if disjoint."""
    bx, by, bw, bh = box
    ox = min(bx + bw, rect.x + rect.w) - max(bx, rect.x)
    oy = min(by + bh, rect.y + rect.h) - max(by, rect.y)
    if ox <= 0 or oy <= 0:
        return 0
    return min(ox, oy)


def validate_endpoints(level: Level) -> list[str]:
    violations: list[str] = []
    spawn_box = (level.spawn.x, level.spawn.y, PLAYER_W, PLAYER_H)
    goal_box = (level.goal.x, level.goal.y, PLAYER_W, PLAYER_H)

    # I3 — force lateral traversal.
    if level.goal.x < level.spawn.x + MIN_LATERAL:
        violations.append(
            f"goal.x must be >= spawn.x + {MIN_LATERAL} — got goal.x={level.goal.x}, "
            f"spawn.x={level.spawn.x}."
        )

    # I2 + I4 — endpoints must not be buried inside a platform.
    for idx, p in enumerate(level.platforms):
        if _penetration(spawn_box, p) > MAX_PENETRATION:
            violations.append(f"Platform {idx} overlaps the spawn point by more than 8px.")
        if _penetration(goal_box, p) > MAX_PENETRATION:
            violations.append(f"Platform {idx} overlaps the goal point by more than 8px.")

    # I7 — there must be ground beneath the spawn to stand on.
    spawn_foot = level.spawn.y + PLAYER_H
    has_ground = any(
        abs(p.y - spawn_foot) <= GROUND_TOLERANCE
        and p.x <= level.spawn.x + PLAYER_W
        and p.x + p.w >= level.spawn.x
        for p in level.platforms
    )
    if not has_ground:
        violations.append(
            "No platform sits within 32px beneath the spawn — the player has nothing to stand on."
        )

    return violations
