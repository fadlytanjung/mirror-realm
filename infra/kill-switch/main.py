# infra/kill-switch/main.py
# docs: 11-deployment-guide.md#budget · 15-cost-and-limits.md
# Pub/Sub-triggered Cloud Function: disables billing on the project when the
# budget alert crosses 100%. Re-enabling is manual, by design.
import base64
import json
import os

from googleapiclient import discovery

PROJECT_ID = os.environ["GCP_PROJECT"]
KILL_AT_FRACTION = 1.0  # 100% of budget


def handle_billing_alert(event, _context):
    raw = base64.b64decode(event["data"]).decode("utf-8")
    msg = json.loads(raw)
    cost = float(msg.get("costAmount", 0))
    budget = float(msg.get("budgetAmount", 1))
    if cost < budget * KILL_AT_FRACTION:
        print(f"cost {cost} below threshold {budget * KILL_AT_FRACTION}; no action")
        return
    billing = discovery.build("cloudbilling", "v1", cache_discovery=False)
    project = f"projects/{PROJECT_ID}"
    billing.projects().updateBillingInfo(
        name=project,
        body={"billingAccountName": ""},
    ).execute()
    print(f"DISABLED billing for {project} at cost={cost} budget={budget}")
