#!/usr/bin/env bash
# infra/grant-iam.sh
# docs: 11-deployment-guide.md#iam · 13-security.md#iam
# Idempotent: creates the two service accounts and binds least-privilege roles.
set -euo pipefail

PROJECT_ID="${MR_GCP_PROJECT:-halo-expert}"
RUNTIME_SA="mirror-realm-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
SCHEDULER_SA="mirror-realm-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"

ensure_sa() {
  local name="$1" display="$2"
  gcloud iam service-accounts describe "${name}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --project "${PROJECT_ID}" >/dev/null 2>&1 ||
    gcloud iam service-accounts create "${name}" --display-name "${display}" --project "${PROJECT_ID}"
}

ensure_sa mirror-realm-runtime "Mirror Realm runtime"
ensure_sa mirror-realm-scheduler "Mirror Realm scheduler"

ENV_SECRET="${MR_ENV_SECRET:-mirror-realm}"

# Runtime SA project-level roles (least privilege — docs/13 §2).
for ROLE in \
  roles/datastore.user \
  roles/storage.objectAdmin \
  roles/cloudtrace.agent \
  roles/logging.logWriter \
  roles/billing.projectManager; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member "serviceAccount:${RUNTIME_SA}" --role "${ROLE}" --condition=None >/dev/null
done

# Read the app config (full .env, incl. the Gemini key) — scoped to the one secret,
# not project-wide (docs/13 §3).
gcloud secrets add-iam-policy-binding "${ENV_SECRET}" \
  --member "serviceAccount:${RUNTIME_SA}" \
  --role roles/secretmanager.secretAccessor \
  --project "${PROJECT_ID}" >/dev/null

echo "IAM bindings applied for ${RUNTIME_SA} and ${SCHEDULER_SA}."
echo "Note: scheduler run.invoker binding is applied by deploy-api.sh after first deploy."
