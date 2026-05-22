#!/usr/bin/env bash
# infra/deploy-scheduler.sh
# docs: 11-deployment-guide.md#scheduler
# Creates/updates the daily-rotate Cloud Scheduler job (OIDC-authed). Idempotent.
set -euo pipefail

PROJECT_ID="${MR_GCP_PROJECT:-halo-expert}"
REGION="${MR_GCP_LOCATION:-asia-southeast2}"
SCHEDULER_SA="mirror-realm-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"
API_URL="${MR_API_URL:-$(gcloud run services describe mirror-realm-api --region "${REGION}" --project "${PROJECT_ID}" --format='value(status.url)')}"

ACTION=create
gcloud scheduler jobs describe daily-rotate --location "${REGION}" --project "${PROJECT_ID}" >/dev/null 2>&1 && ACTION=update

gcloud scheduler jobs "${ACTION}" http daily-rotate \
  --location "${REGION}" --project "${PROJECT_ID}" \
  --schedule "0 0 * * *" \
  --time-zone "UTC" \
  --uri "${API_URL}/api/daily-rotate" \
  --http-method POST \
  --oidc-service-account-email "${SCHEDULER_SA}" \
  --oidc-token-audience "${API_URL}" \
  --attempt-deadline "30s" \
  --max-retry-attempts 3 \
  --min-backoff "10s"

echo "Scheduler job daily-rotate ${ACTION}d for ${API_URL}"
