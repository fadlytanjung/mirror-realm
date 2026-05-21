#!/usr/bin/env bash
# infra/deploy-api.sh
# docs: 11-deployment-guide.md#deploy-api-first
# Builds + deploys apps/api to Cloud Run (Cloud Build via --source). Idempotent.
set -euo pipefail

PROJECT_ID="${MR_GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${MR_GCP_LOCATION:-asia-southeast2}"
RUNTIME_SA="mirror-realm-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
SCHEDULER_SA="mirror-realm-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Deploying mirror-realm-api to ${PROJECT_ID} / ${REGION}"
gcloud run deploy mirror-realm-api \
  --source "${ROOT}/apps/api" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --service-account "${RUNTIME_SA}" \
  --allow-unauthenticated \
  --max-instances 5 \
  --memory 512Mi \
  --cpu 1 \
  --timeout 60 \
  --concurrency 80 \
  --set-env-vars="MR_GCP_PROJECT=${PROJECT_ID},MR_GCP_LOCATION=${REGION},MR_GEMINI_MODEL=gemini-3.1-flash-lite,MR_CORS_ORIGINS=https://${PROJECT_ID}.web.app,MR_SCHEDULER_SA_EMAIL=${SCHEDULER_SA}"

API_URL="$(gcloud run services describe mirror-realm-api --region "${REGION}" --project "${PROJECT_ID}" --format='value(status.url)')"
echo "API: ${API_URL}"

# Pin the OIDC audience for daily-rotate, and let the scheduler SA invoke us.
gcloud run services update mirror-realm-api \
  --region "${REGION}" --project "${PROJECT_ID}" \
  --update-env-vars "MR_ROTATE_AUDIENCE=${API_URL}"

gcloud run services add-iam-policy-binding mirror-realm-api \
  --member "serviceAccount:${SCHEDULER_SA}" \
  --role roles/run.invoker --region "${REGION}" --project "${PROJECT_ID}" || true
