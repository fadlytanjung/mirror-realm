#!/usr/bin/env bash
# infra/deploy-api.sh
# docs: 11-deployment-guide.md#deploy-api-first
# Local/manual equivalent of infra/cloudbuild.yaml: build the Docker image, push
# to Artifact Registry, deploy to Cloud Run. CI normally runs cloudbuild.yaml
# (triggered from the GCP console). Idempotent.
set -euo pipefail

PROJECT_ID="${MR_GCP_PROJECT:-halo-expert}"
REGION="${MR_GCP_LOCATION:-asia-southeast2}"
REPO="${MR_AR_REPO:-mirror-realm}"
SERVICE="mirror-realm-api"
RUNTIME_SA="mirror-realm-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
SCHEDULER_SA="mirror-realm-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}"
TAG="$(git -C "${ROOT}" rev-parse --short HEAD 2>/dev/null || date +%s)"

"${ROOT}/infra/create-registry.sh"
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

echo "Building ${IMAGE}:${TAG} (linux/amd64)"
# Build for linux/amd64 (Cloud Run's platform) even on Apple Silicon, and disable
# provenance so the result is a single-arch image — not an OCI image index, which
# Cloud Run rejects ("manifest type ...image.index... must support amd64/linux").
# buildx --push builds + pushes in one step (the amd64 image isn't loaded locally).
docker buildx build \
  --platform linux/amd64 \
  --provenance=false \
  -f "${ROOT}/apps/api/Dockerfile" \
  -t "${IMAGE}:${TAG}" -t "${IMAGE}:latest" \
  --push \
  "${ROOT}/apps/api"

# All app config lives in ONE Secret Manager secret holding a full .env. Cloud Run
# mounts it as a file and MR_ENV_FILE points pydantic-settings at it — so updating
# config means adding a secret version, with no redeploy of env flags (docs/13 §3).
ENV_SECRET="${MR_ENV_SECRET:-mirror-realm}"

gcloud run deploy "${SERVICE}" \
  --image "${IMAGE}:${TAG}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --service-account "${RUNTIME_SA}" \
  --allow-unauthenticated \
  --max-instances 5 --memory 512Mi --cpu 1 --timeout 60 --concurrency 80 \
  --set-env-vars="MR_ENV_FILE=/secrets/.env" \
  --set-secrets="/secrets/.env=${ENV_SECRET}:latest"

API_URL="$(gcloud run services describe "${SERVICE}" --region "${REGION}" --project "${PROJECT_ID}" --format='value(status.url)')"
echo "API: ${API_URL}"

# Let the scheduler SA invoke the daily-rotate endpoint.
gcloud run services add-iam-policy-binding "${SERVICE}" \
  --member "serviceAccount:${SCHEDULER_SA}" \
  --role roles/run.invoker --region "${REGION}" --project "${PROJECT_ID}" || true
