# XEdge / EDGEai — SESSION HANDOFF NOTE
## April 25, 2026 | Read This First | Before Doing Anything Else

### PURPOSE
Bring the next Claude session up to speed instantly. Upload this doc + Runbook_v7.1.md + PRD_v4.4.md as your first message.

Claude Code entry: `cd C:\Users\korbs\EDGEai\dashboard` then `claude` (two separate commands)

---

## 1. Who I Am

- **Founder:** Ken Korbel — Dallas-Fort Worth TX
- **Company:** XTX LLC DBA XTX-ai — Wyoming — Ken sole member
- **GitHub:** KenXEdge / repo: edgeai-private / branch: master
- **Email:** korbs827@gmail.com | **Support:** ken@xtxtec.com
- **Live domain:** xtxtec.com
- **AI stack:** Claude Code (primary dev tool) | Node.js only — Python NOT installed on dev machine

---

## 2. System Status — April 25 2026

| Component | Status | Detail |
|-----------|--------|--------|
| xtxtec.com | LIVE | Vercel — primary domain (migrated from xedge-ai.com April 23) |
| xedge-ai.com | REDIRECTING | 301 → xtxtec.com via vercel.json |
| www.xedge-ai.com | REDIRECTING | 301 → xtxtec.com via vercel.json |
| www.xtxtec.com | REDIRECTING | 301 → xtxtec.com via vercel.json |
| home.html | LIVE | Landing page — inline OTP signup flow (8-digit code, card + modal) |
| /auth (Login.jsx) | LIVE | Sign in — navigates to /dashboard on success |
| /verify (verify.html) | LIVE | Email confirmation gate |
| /subscribe | LIVE | Tier selection → Stripe checkout — navigates to /onboard on success |
| /onboard | LIVE | Gated — carrier profile setup — partially wired |
| /dashboard | LIVE | Gated — active subscription required — replaced /carrier route April 25 |
| /api/stripe-webhook | LIVE | Vercel serverless — checkout.session.completed + customer.subscription.deleted |
| /api/create-checkout-session | LIVE | Vercel serverless — creates Stripe checkout session |
| Cloud Run | STABLE | edgeai-gmail-webhook revision 00071-hj8 |
| Supabase | LIVE | siafwhlzazefyoevslde.supabase.co |
| Stripe | TEST MODE | Do not flip to live until Ken instructs |
| SMS | DISABLED | SMS_ENABLED=false — Twilio terminated — Telnyx pending |
| n8n | ARCHIVED | Do not touch |
| Google OAuth | PENDING | Needs Privacy Policy + Terms pages first |
| Custom SMTP | PENDING | Supabase auth emails still from supabase.io — needs xtxtec.com sender |

---

## 3. All Changes Made This Session — April 25 2026

| # | Change | Files | Commits |
|---|--------|-------|---------|
| 1 | home.html OTP card flow fixed | dashboard/public/home.html | e4ffa3f |
| 2 | verifyOtp type 'email' → 'signup' | dashboard/public/home.html | e4ffa3f |
| 3 | OTP error + success console logging | dashboard/public/home.html | 02ebfbf |
| 4 | verifyOtp full error JSON logging | dashboard/public/home.html | 20a0a53 |
| 5 | OTP maxlength 6 → 8; copy 6-digit → 8-digit; length guard updated | dashboard/public/home.html | 6c1a419, 20a0a53 |
| 6 | /carrier route removed from App.jsx | dashboard/src/App.jsx | c48abfb |
| 7 | Login.jsx navigate → /dashboard | dashboard/src/pages/Login.jsx | c48abfb |
| 8 | ResetPassword.jsx navigate → /dashboard | dashboard/src/pages/ResetPassword.jsx | c48abfb |
| 9 | Subscribe.jsx navigate → /onboard | dashboard/src/pages/Subscribe.jsx | c48abfb |
| 10 | App.jsx catch-all Navigate → /dashboard | dashboard/src/App.jsx | c48abfb |
| 11 | Layout.jsx home nav link → /dashboard | dashboard/src/components/Layout.jsx | c48abfb |

---

## 4. Critical Values — All Current

| Item | Value |
|------|-------|
| Live domain | https://xtxtec.com |
| Dashboard route | /dashboard |
| CORS origin | https://xtxtec.com |
| Support email | ken@xtxtec.com |
| Stripe success_url | https://xtxtec.com/onboard?session_id={CHECKOUT_SESSION_ID} |
| Stripe cancel_url | https://xtxtec.com/subscribe?cancelled=true |
| Cloud Run service | edgeai-gmail-webhook |
| Active revision | 00071-hj8 |
| GCP project | edgeai-493115 |
| Pub/Sub topic | projects/edgeai-493115/topics/edgeai-gmail |
| Supabase | siafwhlzazefyoevslde.supabase.co |
| GitHub | KenXEdge/edgeai-private — master |
| Claude model (classify) | claude-haiku-4-5-20251001 |
| Stripe Base price | price_1TN2Y5**** |
| Stripe Custom price | price_1TN2Yh**** |
| Stripe Premium price | price_1TN2dg**** |
| Ken's carriers row | e84dfb58**** — DO NOT ALTER |

---

## 5. Known Pending Items (Not Yet Done)

### Vercel Environment Variables
Confirm present in Vercel dashboard → Settings → Environment Variables → **Project tab** (NOT Shared tab):
- `SUPABASE_URL`
- `SUPABASE_KEY` (service_role JWT)
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

Run `vercel env ls` to confirm all four are present under Production.

### Stripe Webhook Registration
Register `https://xtxtec.com/api/stripe-webhook` in Stripe Dashboard → Developers → Webhooks.
Events: `checkout.session.completed` and `customer.subscription.deleted`.

### main.py commit pending
`services/gmail-webhook/main.py` — `xtxtec.com` added to domain exclusion list. Needs commit + Cloud Run redeploy.

### Backend .env — SUPABASE_SERVICE_ROLE_KEY
`services/gmail-webhook/.env` has SUPABASE_SERVICE_ROLE_KEY incorrectly set to anon JWT. Backend uses SUPABASE_KEY correctly. Low risk but should be corrected.

---

## 6. Build Queue — Next Session — Priority Order

### PRIORITY 1 — Commit main.py + Redeploy Cloud Run
```
cd C:\Users\korbs\EDGEai
git add services/gmail-webhook/main.py
git commit -m "Add xtxtec.com to domain exclusion list in main.py"
```
Then redeploy Cloud Run with the updated main.py.

### PRIORITY 2 — Confirm Vercel Env Vars Live
Run: `vercel env ls` — confirm SUPABASE_URL, SUPABASE_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET all present under Production.

### PRIORITY 3 — Register Stripe Webhook
Stripe Dashboard → Developers → Webhooks → Add endpoint
URL: `https://xtxtec.com/api/stripe-webhook`
Events: checkout.session.completed, customer.subscription.deleted

### PRIORITY 4 — Founder Account Activation (BLOCKER for onboarding)
Option A: Stripe 100% off coupon at checkout
Option B: `UPDATE carriers SET subscription_status = 'active', subscription_tier = 'base' WHERE id = '<ken_uuid>';`
Do NOT charge Ken for his own account.

### PRIORITY 5 — Test Carrier End-to-End
Full flow: landing → OTP signup → /subscribe → Stripe → /onboard → Gmail OAuth → broker extraction → ACE live
Verify UUID consistency across all Supabase tables. Delete test carrier after confirmation.

### PRIORITY 6 — Ken's Production Onboarding
Only after test carrier confirmed. Clean UUID, $0 subscription, real broker list, ACE Base live.

### PRIORITY 7 — Email Deliverability
Custom SMTP in Supabase Auth → noreply@xtxtec.com
Evaluate xtxtransport.com as sending alias for platform emails.

### PRIORITY 8 — Infrastructure
- Telnyx SMS — flip SMS_ENABLED=true when live and tested
- Privacy Policy page — required before Google OAuth verification
- Terms of Service page — required before Google OAuth verification
- Google OAuth verification submit
- Stripe flip to live mode (Ken instructs when ready)

---

## 7. Deploy Commands

**Dashboard (auto-deploys via Vercel on git push):**
```
cd C:\Users\korbs\EDGEai
git add .
git commit -m "description"
git push
```

**Cloud Run build:**
```
gcloud builds submit --tag us-central1-docker.pkg.dev/edgeai-493115/edgeai/edgeai-gmail-webhook --project edgeai-493115 .
```

**Cloud Run deploy:**
```
gcloud run deploy edgeai-gmail-webhook --image us-central1-docker.pkg.dev/edgeai-493115/edgeai/edgeai-gmail-webhook --platform managed --region us-central1 --project edgeai-493115
```

**Cloud Run logs:**
```
gcloud run services logs read edgeai-gmail-webhook --region=us-central1 --project=edgeai-493115 --limit=20
```

**Cloud Run rollback to stable:**
```
gcloud run services update-traffic edgeai-gmail-webhook --to-revisions=edgeai-gmail-webhook-00071-hj8=100 --region=us-central1 --project=edgeai-493115
```

**Claude Code entry:**
```
cd C:\Users\korbs\EDGEai\dashboard
claude
```

---

## 8. Stripe Webhook — How It Works (Critical Reference)

- File: `dashboard/api/stripe-webhook.js`
- Uses `STRIPE_WEBHOOK_SECRET` for signature verification
- Uses `SUPABASE_KEY` (service_role JWT) — NOT `SUPABASE_SERVICE_ROLE_KEY`
- `bodyParser: false` required — reads raw body for Stripe signature check
- Returns HTTP 200 on all paths
- `trailingSlash: false` in vercel.json — required to prevent 307 redirect on POST

**Vercel routing note:** `routes` and `rewrites` cannot coexist in vercel.json. Current config uses only `rewrites` + `redirects`.

---

## 9. Standing Rules for Claude

- Never push to git without Ken approval — unless brand new standalone page
- Never display credentials — truncate to first 4 + **** + last 4
- Never recreate logo geometry — always use PNG files (logo-edge-white.png, logo-edge-black.png)
- Never set height/width on logo img tag
- Node.js only — Python NOT installed on dev machine
- SMS_ENABLED=false — do not flip until Telnyx live and tested
- Stripe TEST mode — do not flip to live until Ken instructs
- n8n ARCHIVED — do not unarchive
- Never alter Ken's carriers row e84dfb58**** — all broker/response/outreach history tied to it
- Never cross-contaminate or delete production data without explicit Ken approval
- PowerShell does not support && — always use two separate commands
- End of session — generate updated .docx versions of all 4 docs and upload to Google Drive folder 1D8W9wUjjCbL2myxlBLlTgulQXeihUZ1h

---

*XEdge Transition Note | April 25 2026 | XTX LLC | Upload with Runbook_v7.1.md + PRD_v4.4.md*
