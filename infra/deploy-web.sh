#!/usr/bin/env bash
# infra/deploy-web.sh
# docs: 11-deployment-guide.md#deploy-web-first
# Builds apps/web against the live API URL and deploys to Firebase Hosting.
set -euo pipefail

PROJECT_ID="${MR_GCP_PROJECT:-halo-expert}"
REGION="${MR_GCP_LOCATION:-asia-southeast2}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

API_URL="${MR_API_URL:-$(gcloud run services describe mirror-realm-api --region "${REGION}" --project "${PROJECT_ID}" --format='value(status.url)')}"
echo "Building web against API: ${API_URL}"
echo "VITE_API_BASE_URL=${API_URL}" > "${ROOT}/apps/web/.env.production"

# Spec-parity gate (docs/00 success criteria): generated TS must match the schema.
pnpm gen:check
pnpm --filter web build
cd "${ROOT}/infra"
firebase deploy --only hosting --project "${PROJECT_ID}"
echo "Web: https://${PROJECT_ID}.web.app"
