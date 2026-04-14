# EDGEai Gmail Webhook Service

Cloud Run microservice that receives Gmail Push Notifications via Google Cloud Pub/Sub,
classifies broker email replies using Claude, and triggers carrier SMS alerts.

## Architecture

```
Gmail (xtxtransport.com) → Pub/Sub Topic → Cloud Run Webhook
                                                    │
                          ┌─────────────────────────┤
                          ▼                         ▼
                    Gmail API               Supabase (brokers,
                 (fetch full email)          responses, load_wins)
                          │
                          ▼
                  Claude Haiku (classify)
                          │
                    load_offer?
                          │
                          ▼
                  Twilio SMS → Ken (+19726778688)
```

## Prerequisites

- Google Cloud project: `edgeai-493115`
- Google Workspace account for `xtxtransport.com`
- gcloud CLI authenticated: `gcloud auth login`
- Docker (or Cloud Build — no local Docker needed)

---

## Step 1 — Supabase Tables

Run these SQL statements in your Supabase SQL editor:

```sql
-- Track Gmail historyId per watched account
CREATE TABLE gmail_sync (
  email       TEXT PRIMARY KEY,
  history_id  TEXT NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- All processed broker replies
CREATE TABLE responses (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  gmail_message_id  TEXT UNIQUE NOT NULL,
  thread_id         TEXT,
  broker_email      TEXT,
  subject           TEXT,
  body              TEXT,
  classification    TEXT,
  carrier_uuid      UUID,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Confirmed load offers
CREATE TABLE load_wins (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  broker_email      TEXT,
  subject           TEXT,
  body              TEXT,
  gmail_message_id  TEXT,
  carrier_uuid      UUID,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Brokers table (add if not exists)
-- Must have at minimum: id, email, status, carrier_uuid, last_reply_at
ALTER TABLE brokers ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'prospect';
ALTER TABLE brokers ADD COLUMN IF NOT EXISTS last_reply_at TIMESTAMPTZ;
```

---

## Step 2 — Gmail Service Account (Domain-Wide Delegation)

1. Go to [Google Cloud Console → IAM → Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
2. Create a service account named `edgeai-gmail-reader`
3. Create a JSON key and download it as `service-account.json`
4. Base64-encode it:
   ```bash
   base64 -i service-account.json | tr -d '\n'
   # Windows PowerShell:
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("service-account.json"))
   ```
5. Go to [Google Workspace Admin → Security → API Controls → Domain-wide Delegation](https://admin.google.com/ac/owl/domainwidedelegation)
6. Add the service account's Client ID with scope:
   ```
   https://www.googleapis.com/auth/gmail.readonly
   ```

---

## Step 3 — Create Pub/Sub Topic

```bash
gcloud pubsub topics create edgeai-gmail-push --project edgeai-493115

# Grant Gmail permission to publish to your topic
gcloud pubsub topics add-iam-policy-binding edgeai-gmail-push \
  --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher" \
  --project edgeai-493115
```

---

## Step 4 — Set Environment Variables

```bash
cp .env.example .env
# Fill in all values in .env, then:
source .env
```

Generate a secure verification token:
```bash
openssl rand -hex 32
```

---

## Step 5 — Deploy to Cloud Run

```bash
chmod +x deploy.sh
./deploy.sh
```

The script prints your `WEBHOOK_URL` when complete.

---

## Step 6 — Create Pub/Sub Push Subscription

```bash
WEBHOOK_URL="https://YOUR-SERVICE-URL/webhook?token=YOUR_TOKEN"

gcloud pubsub subscriptions create edgeai-gmail-sub \
  --topic edgeai-gmail-push \
  --push-endpoint "${WEBHOOK_URL}" \
  --ack-deadline 30 \
  --project edgeai-493115
```

---

## Step 7 — Register Gmail Watch

Run this once (and re-run every 7 days — Gmail Watch expires):

```bash
# Install deps locally
pip install google-auth google-api-python-client

python3 - <<'EOF'
import os, json, base64
from google.oauth2 import service_account
from googleapiclient.discovery import build

creds_json = json.loads(base64.b64decode(os.environ["GMAIL_CREDENTIALS_B64"]))
creds = service_account.Credentials.from_service_account_info(
    creds_json,
    scopes=["https://www.googleapis.com/auth/gmail.readonly"],
).with_subject("contact@xtxtransport.com")

service = build("gmail", "v1", credentials=creds)
result = service.users().watch(
    userId="me",
    body={
        "topicName": "projects/edgeai-493115/topics/edgeai-gmail-push",
        "labelIds": ["INBOX"],
    }
).execute()
print("Watch registered:", result)
# Save result['historyId'] — the webhook will auto-seed it on first notification
EOF
```

---

## Step 8 — Seed historyId (First Run)

The webhook automatically seeds the historyId on the first Pub/Sub notification it receives.
No action required — just send a test email to any `@xtxtransport.com` alias.

---

## Monitoring

```bash
# Live logs
gcloud run services logs tail edgeai-gmail-webhook \
  --project edgeai-493115 --region us-central1

# Health check
curl https://YOUR-SERVICE-URL/health
```

---

## Email Aliases Covered

The service monitors `contact@xtxtransport.com` via Gmail API and catches replies to:
- `contact@xtxtransport.com`
- `loads@xtxtransport.com`
- `dispatch@xtxtransport.com`
- `ken@xtxtransport.com`

All aliases land in the same Gmail inbox. The Watch covers the entire inbox.

---

## Classification Labels

| Label | Meaning | Broker Status | SMS Alert |
|-------|---------|---------------|-----------|
| `load_offer` | Broker offering a specific load | `hot` | Yes |
| `positive` | Interested, wants more info | `warm` | No |
| `negative` | Not interested / DNC | `cold` | No |
| `question` | Asking a clarifying question | unchanged | No |
| `unknown` | Unclear intent | unchanged | No |

---

## Gmail Watch Renewal

Gmail Watch expires every 7 days. Set a weekly Cloud Scheduler job:

```bash
gcloud scheduler jobs create http edgeai-gmail-watch-renewal \
  --schedule "0 9 * * MON" \
  --uri "https://YOUR-SERVICE-URL/renew-watch" \
  --http-method POST \
  --project edgeai-493115 \
  --location us-central1
```

(Add a `/renew-watch` endpoint to main.py if you want automated renewal.)
