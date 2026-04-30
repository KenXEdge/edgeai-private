# EDGEai — Master Context Note (Runbook)
**Version:** 7.0 | **Date:** April 25, 2026 | Paste-ready for next session

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
4. Fires Telnyx SMS alerts to the carrier on hot leads
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
| Stripe price — Base | price_1TN2Y5**** |
| Stripe price — Custom | price_1TN2Yh**** |
| Stripe price — Premium (setup fee) | price_1TN2dg**** |
| Claude model (classify) | claude-haiku-4-5-20251001 |
| Supabase | siafwhlzazefyoevslde.supabase.co |
| SMTP provider | Resend — sender domain xtxtransport.com |
| Ken's carriers row | carrier UUID = auth.users.id for that carrier — never hardcode |

---

## Architecture Stack

```
xtxtec.com           — Marketing / landing + dashboard (HTML/JS + React, Vite, Vercel)
  /auth              — Login.jsx (React, Vite, Vercel)
  /verify            — verify.html (post-signup + post-reset gate)
  /subscribe         — Tier selection → Stripe checkout
  /onboard           — Carrier profile setup (step 1: truck info)
  /onboard/lanes     — Lane preferences
  /onboard/rates     — Rate floors
  /onboard/gmail     — Gmail OAuth connect
  /dashboard         — Main carrier dashboard (dashboard.html) — /carrier retired

edgeai-gmail-webhook — Cloud Run (Python/Flask)
  Supabase           — Postgres (carriers, brokers, responses, etc.)
  Gmail API          — Per-carrier OAuth (gmail_token on carrier row)
  Pub/Sub            — Gmail Watch push notifications
  Claude Haiku       — Email classification + broker enrichment
  Telnyx             — SMS alerts to carrier (SMS_ENABLED=false — pending setup)
  Stripe             — Subscription billing
  Resend             — Transactional email via xtxtransport.com
```

---

## Supabase Tables

| Table | Purpose |
|-------|---------|
| carriers | One row per carrier — see column list below |
| brokers | Broker contacts per carrier. carrier_id, email, name, company, status (hot/warm/cold), last_reply_at |
| responses | Every classified email. gmail_message_id, carrier_id, broker_id, classification, load_accepted |
| load_wins | Confirmed won loads |
| unknown_brokers_inbox | Emails from senders not in brokers table — pending carrier review |
| gmail_sync | historyId tracking per email address |

### carriers table — full column list

| Column | Purpose |
|--------|---------|
| id | UUID — matches auth.users.id |
| email | Carrier email |
| gmail_token | OAuth refresh token |
| subscription_status | active / inactive / trialing |
| subscription_tier | base / custom / premium |
| stripe_customer_id | Stripe customer ID |
| equipment_type | Truck type from onboarding |
| home_base_zip | Home base ZIP from onboarding |
| max_radius | Max deadhead radius |
| active_focus_zip | Current focus ZIP — overrides home_base_zip for classification routing |
| active_focus_city | Display city for active focus zone |
| active_focus_state | Display state for active focus zone |
| focus_updated_at | Timestamp when focus zone was last set |
| outreach_time | Time of day for ACE Morning Brief SMS |

**RLS:** Disabled on carriers table — enforced at application layer.

---

## ACE Morning Brief

Daily SMS sent to carrier at their configured `outreach_time`. Triggered via n8n Cloud Scheduler.

**Content:** Active focus zone summary + top broker activity for the day.

**Input paths — two ways to set active focus zone:**
1. **SMS:** Carrier texts a city/state or ZIP → inbound SMS parser extracts location → updates `active_focus_zip`, `active_focus_city`, `active_focus_state` on carrier row
2. **Dashboard:** Focus zone input field on dashboard.html → PATCH to carriers table

**Active focus behavior:**
- `active_focus_zip` overrides `home_base_zip` for email classification routing when set
- Resets to home base at midnight if not updated
- Classification filter uses `active_focus_zip` (not `home_base_zip`) when populated

---

## Onboarding Flow (Confirmed)

```
1. xtxtec.com landing → inline OTP signup card (home.html)
2. signInWithOtp({ email }) → 8-digit code sent via Resend (xtxtransport.com)
3. verifyOtp() → Supabase session created → /subscribe?first=...&last=...
4. /subscribe → tier selection → Stripe checkout
5. Stripe webhook → subscription_status = active in carriers table  ✓ confirmed working
6. /onboard → equipment type, home base ZIP, MC# (step 1)
7. /onboard/lanes → preferred states + radius + load types (step 2)
8. /onboard/rates → rate floor, min load value, deadhead miles (step 3)
9. /onboard/gmail → Gmail OAuth connect → gmail_token saved (step 4)  ✓ confirmed live
10. /extract-brokers → scans SENT mail → Claude enriches → import to brokers table
11. Gmail Watch started → ACE live
```

---

## Build Queue — Next Session Priorities

### 1. Telnyx SMS (BLOCKER)
- Telnyx account setup — flip `SMS_ENABLED=true` when live and tested
- Remove all Twilio references from main.py

### 2. Broker Extraction Reliability
- Validate `/extract-brokers` against live Gmail SENT folder
- Error handling, retry logic, SSE progress stream
- Verify brokers table populated correctly for Ken's account

### 3. Stripe Webhook Email Match Fix
- Carrier lookup in stripe-webhook.js must match on email — verify correct behavior on checkout.session.completed

### 4. Carriers Table Schema Audit
- Confirm all new columns present in production: active_focus_zip, active_focus_city, active_focus_state, focus_updated_at, outreach_time
- Confirm RLS status (disabled)

### 5. Dashboard Live Data Wiring
- dashboard.html — wire broker table from Supabase (live rows not hardcoded)
- Sidebar counts from live brokers and unknown_brokers_inbox tables
- Focus zone input field → PATCH carriers table

### 6. Founder Account Activation (BLOCKER)
- Direct Supabase SQL: `UPDATE carriers SET subscription_status = 'active', subscription_tier = 'base' WHERE id = '<carrier UUID = auth.users.id>';`
- Do NOT charge Ken for his own account

---

## Standing Notes

- `/carrier` route retired — all dashboard traffic routes to `/dashboard`
- Gmail Watch expires every 7 days — Cloud Scheduler calls `/renew-watches` weekly
- All Pub/Sub deliveries must always return HTTP 200 — any non-200 causes infinite retry loops
- Deduplication runs before any Claude/SMS calls — `is_duplicate()` checks both `responses` and `unknown_brokers_inbox`
- Load board emails (DAT, Truckstop, Spot, NTG) are intercepted before broker lookup — separate SMS path
- `trailingSlash: false` in vercel.json — required for all POST endpoints (Stripe, Pub/Sub) to prevent 307 redirect
- `routes` and `rewrites` cannot coexist in vercel.json — use only `rewrites` + `redirects`
- OTP signup uses signInWithOtp — 8-digit code — no password set — magic link is the re-auth path
- Classification filter uses `active_focus_zip` when set — falls back to `home_base_zip`
- SMTP via Resend — sender domain xtxtransport.com
- RLS disabled on carriers table — enforced at application layer

---

## Files of Interest

| File | Purpose |
|------|---------|
| `services/gmail-webhook/main.py` | Core backend — all Flask routes, Claude, Telnyx, Stripe, Gmail logic |
| `dashboard/src/pages/Login.jsx` | Auth UI — signin, OTP, forgot password |
| `dashboard/public/home.html` | Landing page — inline OTP signup + modal |
| `dashboard/public/dashboard.html` | Carrier dashboard — dark/light mode, ACE status, KPI panels |
| `dashboard/public/onboard.html` | Step 1 — truck info |
| `dashboard/public/onboard-lanes.html` | Step 2 — lane preferences |
| `dashboard/public/onboard-rates.html` | Step 3 — rate floors |
| `dashboard/public/onboard-gmail.html` | Step 4 — Gmail OAuth |
| `dashboard/api/stripe-webhook.js` | Stripe webhook — activates/deactivates carriers |
| `dashboard/api/create-checkout-session.js` | Creates Stripe checkout session |
| `dashboard/vercel.json` | Routing, rewrites, redirects |

---

## Session Changelog — April 25 2026

| # | Change | Detail |
|---|--------|--------|
| 1 | EDGE brand corrections | Platform name EDGE (spoken) / XEdge (product) applied throughout all docs and UI |
| 2 | ACE agent name locked | ACE = Agentic Carrier Employee — locked across all materials |
| 3 | Morning Brief feature built | Daily SMS at outreach_time via n8n — active focus zone + broker summary |
| 4 | Supabase columns added | active_focus_zip, active_focus_city, active_focus_state, focus_updated_at, outreach_time |
| 5 | Inbound SMS parser | Carrier texts city/state/ZIP → parser updates active focus zone on carrier row |
| 6 | Dashboard focus input | Focus zone input field on dashboard.html → PATCH carriers table |
| 7 | Classification filter updated | Uses active_focus_zip when set; falls back to home_base_zip |
| 8 | /carrier route retired | All dashboard traffic → /dashboard |
| 9 | RLS disabled on carriers | Confirmed disabled — enforced at application layer |
| 10 | SMTP — Resend | Transactional email via xtxtransport.com sender domain |
| 11 | Gmail OAuth confirmed live | OAuth flow tested and connected |
| 12 | OTP confirmed 8-digit | signInWithOtp returns 8-digit code confirmed |
| 13 | Stripe webhook confirmed | subscription_status activation confirmed working end-to-end |

---

## Troubleshooting Log

### [RESOLVED] Stripe webhook returning 307 on POST to xtxtec.com/api/stripe-webhook
**Date:** April 23 2026
**Root Cause:** Vercel default trailing slash enforcement redirects POST — Stripe does not follow redirects.
**Resolution:** Added `"trailingSlash": false` to `vercel.json`.

### [RESOLVED] Stripe webhook env vars missing from Vercel production
**Date:** April 23 2026
**Root Cause:** Vars added under Vercel Shared tab instead of Project tab.
**Resolution:** Re-added under Project tab. Always use Project tab, not Shared tab.

---

*EDGEai Runbook v7.0 | XTX LLC | April 25 2026*
