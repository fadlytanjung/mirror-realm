# apps/api/app/routers/health.py
# docs: 07-api-contracts.md#health
from __future__ import annotations

from fastapi import APIRouter, Response

from ..adapters.firestore_client import firestore_client
from ..adapters.vertex_client import check_vertex_credentials
from ..repositories.cost_guard import CostGuardRepository

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readyz")
async def readyz(response: Response) -> dict[str, object]:
    checks: dict[str, bool] = {}

    try:
        col = firestore_client().collection(CostGuardRepository.COLLECTION)
        await col.limit(1).get()
        checks["firestore"] = True
    except Exception:
        checks["firestore"] = False

    checks["vertex_auth"] = check_vertex_credentials()

    if all(checks.values()):
        return {"status": "ok", "checks": checks}
    response.status_code = 503
    return {"status": "not_ready", "checks": checks}
