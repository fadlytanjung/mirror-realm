#!/usr/bin/env bash
# infra/deploy-web.sh
# docs: 11-deployment-guide.md#deploy-web-first
# Builds apps/web against the live API URL and deploys to Firebase Hosting.
set -euo pipefail

PROJECT_ID="${MR_GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${MR_GCP_LOCATION:-asia-southeast2}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

API_URL="${MR_API_URL:-$(gcloud run services describe mirror-realm-api --region "${REGION}" --project "${PROJECT_ID}" --format='value(status.url)')}"
echo "Building web against API: ${API_URL}"
echo "VITE_API_BASE_URL=${API_URL}" > "${ROOT}/apps/web/.env.production"

pnpm --filter web build
firebase deploy --only hosting --config "${ROOT}/infra/firebase.json" --project "${PROJECT_ID}"
echo "Web: https://${PROJECT_ID}.web.app"
