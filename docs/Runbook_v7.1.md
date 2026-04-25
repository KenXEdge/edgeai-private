# EDGEai — Master Context Note
**Date:** April 25, 2026 | Paste-ready for next session

---

## Ken's Identity

- **Name:** Ken (KenXEdge on GitHub)
- **Role:** Founder, EDGEai — freight carrier automation platform
- **Company entity:** XTX LLC
- **GitHub:** KenXEdge / repo: edgeai-private
- **Email:** korbs827@gmail.com
- **Domain:** xtxtec.com (live platform domain), xtxtransport.com (established sender domain)
- **Support email:** ken@xtxtec.com
- **Production user:** Ken is onboarding as a real carrier on his own platform — $0 cost, founder account

---

## EDGEai System — What It Is

EDGEai is a freight carrier automation SaaS. It:
1. Connects to a carrier's Gmail via OAuth
2. Watches for broker emails using Gmail Push Notifications (Pub/Sub)
3. Classifies replies with Claude (load_offer / positive / negative / question / unknown)
4. Fires SMS alerts to the carrier on hot leads
5. Tracks broker relationships in Supabase
6. Handles load board emails (DAT, Truckstop, Spot, NTG) separately
7. Provides a Vercel-hosted dashboard for the carrier

ACE = Agentic Carrier Employee (the core Gmail → Claude → SMS pipeline)

---

## Locked System Values

| Key | Value |
|-----|-------|
| Repo | KenXEdge/edgeai-private |
| Branch | master |
| Cloud Run service | edgeai-gmail-webhook |
| Active revision | 00071-hj8 |
| GCP project | edgeai-493115 |
| Pub/Sub topic | projects/edgeai-493115/topics/edgeai-gmail |
| Live Domain | https://xtxtec.com |
| Dashboard URL | https://xtxtec.com/dashboard |
| CORS origin | https://xtxtec.com |
| Stripe price — Base | price_1TN2Y5PyMuFPyN5Gl2cTFgVj |
| Stripe price — Custom | price_1TN2YhPyMuFPyN5GChyx5zvT |
| Stripe price — Premium (setup fee) | price_1TN2dgPyMuFPyN5Ghu1erL5c |
| Claude model (classify) | claude-haiku-4-5-20251001 |
| main.py sync marker | 2026-04-17 22:15:26 |

---

## Architecture Stack

```
xtxtec.com           — Marketing / landing + dashboard (HTML/JS + React, Vite, Vercel)
  /auth              — Login.jsx (React, Vite, Vercel)
  /verify            — verify.html (post-signup + post-reset gate)
  /subscribe         — Tier selection → Stripe checkout
  /onboard           — Carrier profile setup
  /dashboard         — Main carrier dashboard
  /api/stripe-webhook — Stripe webhook handler (checkout.session.completed, customer.subscription.deleted)

edgeai-gmail-webhook — Cloud Run (Python/Flask)
  Supabase           — Postgres (carriers, brokers, responses, etc.)
  Gmail API          — Per-carrier OAuth (gmail_token on carrier row)
  Pub/Sub            — Gmail Watch push notifications
  Claude Haiku       — Email classification + broker enrichment
  Telnyx             — SMS alerts to carrier (pending — SMS_ENABLED=false)
  Stripe             — Subscription billing
```

---

## Supabase Tables

| Table | Purpose |
|-------|---------|
| carriers | One row per carrier. Has: id (UUID), gmail_token, subscription_status, subscription_tier, stripe_customer_id, equipment_type, home_base_zip, max_radius |
| brokers | Broker contacts per carrier. Has: carrier_id, email, name, company, status (hot/warm/cold), last_reply_at |
| responses | Every classified email. Has: gmail_message_id, carrier_id, broker_id, classification, load_accepted |
| load_wins | Confirmed won loads |
| unknown_brokers_inbox | Emails from senders not in brokers table — pending carrier review |
| gmail_sync | historyId tracking per email address |

---

## Onboarding Flow (Confirmed)

```
1. xtxtec.com landing → click CTA
2. /auth?mode=signup&first=...&last=...&email=... → Login.jsx
3. supabase.auth.signUp() → redirect to xtxtec.com/verify?first=...&email=...
4. User confirms email → session created
5. /subscribe → tier selection → Stripe checkout
6. Stripe webhook (xtxtec.com/api/stripe-webhook) → subscription_status = active in carriers table
7. /onboard → equipment type, home base zip, MC#
8. Gmail OAuth connect → gmail_token saved to carrier row
9. /extract-brokers → scans SENT mail → Claude enriches → import to brokers table
10. Gmail Watch started → ACE live
```

---

## Build Queue — Next Session Priorities

### 1. Stripe Coupon / Founder Activation (BLOCKER)
- Need either: Stripe 100% off coupon code applied at checkout, OR
- Direct Supabase SQL: `UPDATE carriers SET subscription_status = 'active', subscription_tier = 'base' WHERE id = '<ken_uuid>';`
- Do NOT charge Ken for his own account

### 2. Test Carrier End-to-End (BEFORE Ken onboards)
- Create a fake carrier account (test email)
- Run the full flow top to bottom
- Verify: UUID consistent, subscription activates, onboarding completes, Gmail OAuth connects, broker extraction runs, ACE fires SMS
- Confirm each Supabase table gets the right rows

### 3. Delete Test Carrier Record
- After successful flow confirmation, delete test carrier row from Supabase
- Clean up: carriers, brokers, gmail_sync, responses tables

### 4. Ken's Production Onboarding
- Clean UUID (no test data collision)
- subscription_status = active at $0
- Real broker list loaded
- Gmail OAuth connected (Ken's carrier Gmail)
- ACE Base live and receiving emails

### 5. Email Deliverability
- Custom SMTP in Supabase Auth → noreply@xtxtec.com
- Evaluate xtxtransport.com as established sender domain for platform emails

---

## Standing Notes

- `CARRIER_UUID` env var in Cloud Run must always match the carrier's actual `id` in Supabase — this is the current single-carrier limitation; multi-carrier routing is the next architecture step
- Gmail Watch expires every 7 days — Cloud Scheduler calls `/renew-watches` weekly
- All Pub/Sub deliveries always return HTTP 200 — any non-200 causes infinite retry loops
- Deduplication runs before any Claude/SMS calls — `is_duplicate()` checks both `responses` and `unknown_brokers_inbox`
- Load board emails (DAT, Truckstop, Spot, NTG) are intercepted before broker lookup and sent to a separate SMS path

---

## Files of Interest

| File | Purpose |
|------|---------|
| `services/gmail-webhook/main.py` | Core backend — all Flask routes, Claude, Telnyx, Stripe, Gmail logic |
| `dashboard/src/pages/Login.jsx` | Auth UI — signin, signup, forgot password |
| `dashboard/src/pages/` | All dashboard React pages |
| `dashboard/api/stripe-webhook.js` | Stripe webhook — activates/deactivates carriers on payment events |
| `dashboard/api/create-checkout-session.js` | Creates Stripe checkout session |
| `dashboard/vercel.json` | Routing, redirects, trailingSlash:false |
| `dashboard/public/home.html` | Landing page — inline OTP signup flow |

---

## Session Changelog — April 23 2026

| # | Change | Detail |
|---|--------|--------|
| 1 | Domain migrated | xedge-ai.com → xtxtec.com across all files and configs |
| 2 | Stripe webhook built | `dashboard/api/stripe-webhook.js` — handles `checkout.session.completed` and `customer.subscription.deleted` |
| 3 | Vercel env vars added | `STRIPE_WEBHOOK_SECRET`, `SUPABASE_URL`, `SUPABASE_KEY` added to Vercel Production |
| 4 | vercel.json updated | `trailingSlash: false`; `routes` → `rewrites`; 301 redirects added |
| 5 | DNS — DKIM + DMARC | Added to xtxtec.com DNS |
| 6 | Support email | Updated to ken@xtxtec.com |
| 7 | Webhook env convention | `SUPABASE_KEY` confirmed correct for service_role JWT |

## Session Changelog — April 25 2026

| # | Change | Detail |
|---|--------|--------|
| 1 | home.html OTP card flow fixed | Broken `.form-row:first-of-type` selector replaced with `#card-form-view` wrapper — OTP block now renders after signInWithOtp() succeeds |
| 2 | verifyOtp type fixed | `type: 'email'` → `type: 'signup'` |
| 3 | OTP debug logging | `console.error` on signInWithOtp failure; `console.log('OTP sent successfully')`; `JSON.stringify` on verifyOtp error |
| 4 | OTP maxlength + copy | maxlength set to 8; all "6-digit" copy updated to "8-digit"; token.length guard updated |
| 5 | /carrier route removed | App.jsx route definition deleted entirely |
| 6 | navigate('/carrier') replaced | Login.jsx + ResetPassword.jsx → `/dashboard`; Subscribe.jsx → `/onboard`; App.jsx catch-all → `/dashboard` |
| 7 | Layout.jsx nav link | `/carrier` → `/dashboard` |

---

## Troubleshooting Log

### [RESOLVED] Stripe webhook returning 307 on POST to xtxtec.com/api/stripe-webhook

**Date:** April 23 2026

**Root Cause:** Vercel trailing slash enforcement redirects POST with 307. Stripe does not follow redirects.

**Resolution:** `"trailingSlash": false` in `vercel.json`. Commit `226b565`.

**Related:** Any Vercel API route accepting POST from a third-party must have `trailingSlash: false`.

---

### [RESOLVED] Stripe webhook env vars missing from Vercel production

**Date:** April 23 2026

**Root Cause:** Vars added under Vercel Shared tab instead of Project tab — serverless functions do not receive Shared tab vars.

**Resolution:** Re-added all vars under Project tab. Always use Project tab, not Shared tab.

---

### [RESOLVED] home.html card OTP block never rendered after signInWithOtp()

**Date:** April 25 2026

**Root Cause:** `document.querySelector('.hero-card .form-row:first-of-type')` returned null — `:first-of-type` matches by tag type, not class. The first `div` in `.hero-card` is `.card-tag`, not `.form-row`. Null reference threw TypeError, halting execution before the OTP block was appended.

**Resolution:** Wrapped hero card form fields in `<div id="card-form-view">`. Replaced broken selector chain with `document.getElementById('card-form-view').style.display = 'none'`. Commit `e4ffa3f`.
