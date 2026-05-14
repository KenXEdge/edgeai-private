#!/usr/bin/env bash
# EDGEai Gmail Webhook — Cloud Run deployment script
# Usage: ./deploy.sh [--build-only]
set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────────
PROJECT_ID="edgeai-493115"
SERVICE_NAME="edgeai-gmail-webhook"
REGION="us-central1"
IMAGE="us-central1-docker.pkg.dev/${PROJECT_ID}/edgeai/${SERVICE_NAME}"

# ── Load .env if present ──────────────────────────────────────────────────────
if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# ── Validate required env vars are set ────────────────────────────────────────
REQUIRED_VARS=(
  SUPABASE_KEY
  ANTHROPIC_API_KEY
  TELNYX_API_KEY
  TELNYX_FROM
  TELNYX_TO
  GMAIL_CLIENT_ID
  GMAIL_CLIENT_SECRET
  GMAIL_OAUTH_REFRESH_TOKEN
  PUBSUB_VERIFICATION_TOKEN
)

echo "Checking required environment variables..."
for var in "${REQUIRED_VARS[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: $var is not set. Copy .env.example to .env and source it first."
    exit 1
  fi
done
echo "All required variables present."

# ── Ensure Artifact Registry repository exists ────────────────────────────────
echo ""
echo "Ensuring Artifact Registry repository exists..."
gcloud artifacts repositories create edgeai \
  --repository-format=docker \
  --location=us-central1 \
  --description="EDGEai container images" \
  --quiet 2>/dev/null || true

# ── Build and push container image ────────────────────────────────────────────
echo ""
echo "Building container image: ${IMAGE}"
gcloud builds submit \
  --tag "${IMAGE}" \
  --project "${PROJECT_ID}" \
  .

if [[ "${1:-}" == "--build-only" ]]; then
  echo "Build complete. Skipping deploy (--build-only)."
  exit 0
fi

# ── Deploy to Cloud Run ────────────────────────────────────────────────────────
echo ""
echo "Deploying to Cloud Run (${REGION})..."
gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE}" \
  --platform managed \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --allow-unauthenticated \
  --min-instances 1 \
  --max-instances 10 \
  --concurrency 80 \
  --timeout 3600s \
  --memory 512Mi \
  --cpu 1 \
  --set-env-vars "SUPABASE_URL=https://siafwhlzazefyoevslde.supabase.co" \
  --set-env-vars "SUPABASE_KEY=${SUPABASE_KEY}" \
  --set-env-vars "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}" \
  --set-env-vars "TELNYX_API_KEY=${TELNYX_API_KEY}" \
  --set-env-vars "TELNYX_FROM=${TELNYX_FROM}" \
  --set-env-vars "TELNYX_TO=${TELNYX_TO}" \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=edgeai-493115" \
  --set-env-vars "GMAIL_CLIENT_ID=${GMAIL_CLIENT_ID}" \
  --set-env-vars "GMAIL_CLIENT_SECRET=${GMAIL_CLIENT_SECRET}" \
  --set-env-vars "GMAIL_OAUTH_REFRESH_TOKEN=${GMAIL_OAUTH_REFRESH_TOKEN}" \
  --set-env-vars "GMAIL_USER=contact@xtxtransport.com" \
  --set-env-vars "PUBSUB_VERIFICATION_TOKEN=${PUBSUB_VERIFICATION_TOKEN}"

# ── Print service URL ──────────────────────────────────────────────────────────
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --platform managed \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --format "value(status.url)")

echo ""
echo "Deployment complete!"
echo "Service URL: ${SERVICE_URL}"
echo "Webhook URL: ${SERVICE_URL}/webhook?token=${PUBSUB_VERIFICATION_TOKEN}"
echo ""
echo "Next step — point your Pub/Sub push subscription at the webhook URL above."
echo "See README.md for full setup instructions."
