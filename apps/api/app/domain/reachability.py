# apps/api/app/domain/reachability.py
# docs: 04-domain-model.md#invariants (I5) · 06-ai-agent-layer.md#retry
#
# Reachability check (I5). We model each platform's TOP edge as a walkable
# surface and build a jump graph: you can hop surface A -> B when the horizontal
# gap is within MAX_JUMP_DISTANCE and the upward rise is within MAX_JUMP_HEIGHT
# (drops of any height are always allowed). BFS from the spawn surface to a
# surface from which the goal is one jump away. Fast (<<200ms) and deterministic.
from __future__ import annotations

from collections import deque
from dataclasses import dataclass

from ..agents.schemas import Level
from .physics import MAX_JUMP_DISTANCE, MAX_JUMP_HEIGHT, PLAYER_H


@dataclass(frozen=True)
class Surface:
    x0: int
    x1: int
    top: int


def _surfaces(level: Level) -> list[Surface]:
    return [Surface(p.x, p.x + p.w, p.y) for p in level.platforms]


def _hgap_segments(a: Surface, b: Surface) -> float:
    if a.x1 >= b.x0 and b.x1 >= a.x0:
        return 0.0
    return float(min(abs(a.x1 - b.x0), abs(b.x1 - a.x0)))


def _hgap_point(s: Surface, px: int) -> float:
    if s.x0 <= px <= s.x1:
        return 0.0
    return float(min(abs(s.x0 - px), abs(s.x1 - px)))


def _can_hop(a: Surface, b: Surface) -> bool:
    if _hgap_segments(a, b) > MAX_JUMP_DISTANCE:
        return False
    rise = a.top - b.top  # positive => b is higher than a
    return rise <= MAX_JUMP_HEIGHT


def check_reachable(level: Level) -> bool:
    surfaces = _surfaces(level)
    if not surfaces:
        return False

    spawn_foot = level.spawn.y + PLAYER_H
    # Start surfaces: those the player can stand on at spawn, or land on from spawn.
    starts = [
        i
        for i, s in enumerate(surfaces)
        if _hgap_point(s, level.spawn.x) <= MAX_JUMP_DISTANCE
        and abs(s.top - spawn_foot) <= MAX_JUMP_HEIGHT
    ]
    if not starts:
        return False

    # Goal surfaces: those from which the goal point is within one jump.
    goals = {
        i
        for i, s in enumerate(surfaces)
        if _hgap_point(s, level.goal.x) <= MAX_JUMP_DISTANCE
        and abs(s.top - level.goal.y) <= MAX_JUMP_HEIGHT * 1.5
    }
    if not goals:
        return False

    adjacency: list[list[int]] = [[] for _ in surfaces]
    for i, a in enumerate(surfaces):
        for j, b in enumerate(surfaces):
            if i != j and _can_hop(a, b):
                adjacency[i].append(j)

    seen = set(starts)
    queue: deque[int] = deque(starts)
    while queue:
        cur = queue.popleft()
        if cur in goals:
            return True
        for nxt in adjacency[cur]:
            if nxt not in seen:
                seen.add(nxt)
                queue.append(nxt)
    return False
