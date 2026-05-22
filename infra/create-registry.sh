#!/usr/bin/env bash
# infra/create-registry.sh
# docs: 11-deployment-guide.md#registry
# Creates the Artifact Registry Docker repo that cloudbuild.yaml pushes to. Idempotent.
set -euo pipefail

PROJECT_ID="${MR_GCP_PROJECT:-halo-expert}"
REGION="${MR_GCP_LOCATION:-asia-southeast2}"
REPO="${MR_AR_REPO:-mirror-realm}"

gcloud services enable artifactregistry.googleapis.com --project "${PROJECT_ID}"

if gcloud artifacts repositories describe "${REPO}" \
  --location "${REGION}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  echo "Artifact Registry repo ${REPO} already exists in ${REGION}."
else
  gcloud artifacts repositories create "${REPO}" \
    --repository-format=docker \
    --location "${REGION}" \
    --project "${PROJECT_ID}" \
    --description "Mirror Realm container images"
  echo "Created ${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}"
fi
