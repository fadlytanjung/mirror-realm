#!/usr/bin/env bash
# infra/clean-firestore.sh
# docs: 11-deployment-guide.md#firestore · 13-security.md
#
# DESTRUCTIVE: deletes ALL documents in the Mirror Realm Firestore collections
# (levels, submissions, daily, costGuard) to reset to a clean slate for testing.
# The database itself, security rules, and indexes are kept.
#
# Usage:
#   ./infra/clean-firestore.sh           # prompts for confirmation
#   ./infra/clean-firestore.sh --yes     # no prompt (CI / scripted)
#   MR_FIRESTORE_COLLECTIONS=levels ./infra/clean-firestore.sh   # only some collections
set -euo pipefail

PROJECT_ID="${MR_GCP_PROJECT:-halo-expert}"
DATABASE="${MR_FIRESTORE_DATABASE:-(default)}"
COLLECTIONS="${MR_FIRESTORE_COLLECTIONS:-levels,submissions,daily,costGuard}"

echo "About to DELETE ALL documents in these Firestore collection groups:"
echo "  collections: ${COLLECTIONS}"
echo "  project:     ${PROJECT_ID}"
echo "  database:    ${DATABASE}"
echo "This cannot be undone (the database, rules, and indexes are preserved)."

if [[ "${1:-}" != "--yes" ]]; then
  read -r -p "Type 'yes' to continue: " ans
  [[ "${ans}" == "yes" ]] || { echo "Aborted."; exit 1; }
fi

# bulk-delete runs as a long-running operation; --async returns immediately.
gcloud firestore bulk-delete \
  --collection-ids="${COLLECTIONS}" \
  --project "${PROJECT_ID}" \
  --database "${DATABASE}" \
  --quiet

echo "Bulk-delete submitted for [${COLLECTIONS}] in ${PROJECT_ID}/${DATABASE}."
echo "It runs server-side and may take a moment. Verify with:"
echo "  gcloud firestore operations list --project ${PROJECT_ID}"
