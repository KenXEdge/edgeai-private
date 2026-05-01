# EDGEai — Master Context Note (Runbook)
**Version:** 8.0 | **Date:** May 1, 2026 | Paste-ready for next session

---

## VERSION HISTORY

| Version | Date | Summary |
|---------|------|---------|
| 7.0 | April 17, 2026 | Broker extraction SSE streaming, inbox scanning, single endpoint |
| 7.1 | April 25, 2026 | Domain migration xtxtec.com, Stripe webhook, OTP fixes, SMTP Resend, Gmail OAuth live, Morning Brief designed, ACE Scout designed |
| 8.0 | May 1, 2026 | Clean restart after main.py recovery. Restored from git commit 2c4a409. Cloud Run revision 00106-fzh restored from 00069-xz2. Standing restore rule added. |

### v8.0 Recovery Notes

**What happened:** main.py was modified after commit 2c4a409, causing instability. Service was restored by rolling back Cloud Run to revision 00069-xz2 and redeploying from 2c4a409 baseline, producing revision 00106-fzh.

**Restore reference:**
- Git baseline commit: `2c4a409` (rollback: restore to e707217 — extract_brokers before classification routing)
- Cloud Run restored from: revision `00069-xz2`
- Current stable revision: `00106-fzh`

**Standing rule — if main.py breaks:**
1. Do NOT attempt inline hotfixes to a broken main.py
2. First restore: `git show 2c4a409:services/gmail-webhook/main.py` to recover the known-good baseline
3. Redeploy from that baseline
4. Only layer new changes on top of the confirmed working restore

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
8. Sends ACE Morning Brief — daily SMS at carrier outreach_time with active focus zone
9. ACE Scout — Sylectus browser automation for load board scraping and broker outreach

**Platform name:** EDGE (spoken) — XEdge (product)
**Agent name:** ACE — Agentic Carrier Employee

---

## Locked System Values

| Key | Value |
|-----|-------|
| Repo | KenXEdge/edgeai-private |
| Branch | master |
| Cloud Run service | edgeai-gmail-webhook |
| Active revision | 00107-hk2 |
| Git restore baseline | 2c4a409 |
| GCP project | edgeai-493115 |
| Pub/Sub topic | projects/edgeai-493115/topics/edgeai-gmail |
| Live Domain | https://xtxtec.com |
| Dashboard URL | https://xtxtec.com/dashboard |
| CORS origin | https://xtxtec.com |
| Stripe price — Base | price_1TN2Y5**** |
| Stripe price — Base Plus | price_1TN2Yh**** |
| Stripe price — Dispatcher Pro (setup) | price_1TN2dg**** |
| Claude model (classify) | claude-haiku-4-5-20251001 |
| Supabase | siafwhlzazefyoevslde.supabase.co |
| SMTP provider | Resend — sender noreply@xtxtransport.com — display name EdgeTech |
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
  /onboard/gmail     — Gmail OAuth connect (live)
  /dashboard         — Main carrier dashboard (/carrier retired)
  /api/stripe-webhook — Stripe webhook handler
  /api/create-checkout-session — Stripe session creator

edgeai-gmail-webhook — Cloud Run (Python/Flask) — revision 00107-hk2
  /webhook           — Pub/Sub push receiver
  /health            — Health check
  /confirm-win       — Carrier confirms a won load
  /renew-watches     — Weekly Gmail watch renewal
  /extract-brokers   — Scans SENT mail → broker list (SSE stream)
  /import-brokers    — Manual broker import
  /create-checkout-session — Stripe checkout (legacy backend route)
  /stripe-webhook    — Stripe event handler (legacy backend route)

  Supabase           — Postgres (carriers, brokers, responses, etc.)
  Gmail API          — Per-carrier OAuth (gmail_token on carrier row)
  Pub/Sub            — Gmail Watch push notifications
  Claude Haiku       — Email classification + broker enrichment
  Telnyx             — SMS alerts to carrier (SMS_ENABLED=false — pending setup)
  Stripe             — Subscription billing (TEST mode)
  Resend             — Transactional email via xtxtransport.com
  n8n (Cloud)        — ACE Morning Brief scheduler
```

---

## Supabase Tables

| Table | Purpose |
|-------|---------|
| carriers | One row per carrier — see full column list below |
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
| subscription_tier | base / base_plus / dispatcher_pro |
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

**Content:** Active focus zone + top broker activity summary for the day.

### Input paths — two ways to set active focus zone

| Path | Mechanism |
|------|-----------|
| SMS | Carrier texts city, state, or ZIP → inbound SMS parser extracts location → updates active_focus_zip/city/state on carrier row |
| Dashboard | Focus zone input field on dashboard.html → PATCH to carriers table |

### Active focus behavior

- `active_focus_zip` overrides `home_base_zip` for all classification routing when set
- Resets to `home_base_zip` at midnight if not updated that day
- `focus_updated_at` records when focus was last changed
- Classification filter checks `active_focus_zip` first, falls back to `home_base_zip`

---

## ACE Scout

Browser automation module for Sylectus load board. Runs as a scheduled or on-demand task.

**Capabilities:**
- Session persistence — logs in to Sylectus once, maintains session across runs
- Load deduplication — tracks seen load IDs to avoid reprocessing
- Broker email extraction — scrapes contact emails from load postings
- Outreach via carrier Gmail — uses carrier's connected Gmail to send initial outreach to extracted broker emails

**Status:** Designed — not yet built. Flagged for next build queue.

**Key constraints:**
- Must use carrier's own Gmail OAuth token for outreach — never send from a shared or platform address
- Load deduplication must be persistent across runs (store seen IDs in Supabase or Redis)
- Session must refresh gracefully on timeout without losing queued loads

---

## Onboarding Flow (Confirmed)

```
1. xtxtec.com landing → inline OTP signup card (home.html)
2. signInWithOtp({ email }) → 8-digit code via Magic Link template (Resend, noreply@xtxtransport.com)
3. verifyOtp(type: 'signup') → Supabase session created → /subscribe?first=...&last=...
4. /subscribe → tier selection → Stripe checkout
5. Stripe webhook → subscription_status = active in carriers table  ✓ confirmed working
6. /onboard → equipment type, home base ZIP, MC# (step 1)
7. /onboard/lanes → preferred states + radius + load types (step 2)
8. /onboard/rates → rate floor, min load value, deadhead miles (step 3)
9. /onboard/gmail → Gmail OAuth connect → gmail_token saved (step 4)  ✓ live
10. /extract-brokers → scans SENT mail → Claude enriches → import to brokers table
11. Gmail Watch started → ACE live
```

**Known bug:** Stripe webhook email match does not flip `subscription_status` to active on OTP signups — carrier lookup may fail if email not yet in carriers table at time of webhook. Fix required next session.

---

## Build Queue — Next Session Priorities

### 1. Telnyx SMS (BLOCKER)
- Set up Telnyx account
- Wire Telnyx into main.py — remove all remaining Twilio references
- Test inbound + outbound SMS end-to-end
- Flip `SMS_ENABLED=true` only after confirmed working

### 2. Broker Extraction Reliability
- Run `/extract-brokers` against Ken's live Gmail SENT folder
- Validate SSE progress stream in onboard-gmail.html
- Error handling and retry logic audit
- Verify brokers table populates correctly

### 3. Stripe Webhook Email Match Fix (BUG)
- In `dashboard/api/stripe-webhook.js`, fix carrier lookup on `checkout.session.completed`
- Issue: OTP signups may not have a carriers row yet at webhook time
- Fix: upsert on email, or delay lookup until carriers row confirmed

### 4. Carriers Table Schema Audit
- Confirm all new columns present in production:
  - active_focus_zip, active_focus_city, active_focus_state, focus_updated_at, outreach_time
- Confirm RLS is disabled
- Add any missing columns via Supabase dashboard SQL

### 5. Dashboard Live Data Wiring
- dashboard.html — replace hardcoded broker rows with live Supabase query
- Sidebar counts from live brokers and unknown_brokers_inbox tables
- Focus zone input → PATCH carriers table
- ACE status dot from real subscription_status

### 6. Founder Account Activation (BLOCKER)
- Direct Supabase SQL:
  ```sql
  UPDATE carriers SET subscription_status = 'active', subscription_tier = 'base'
  WHERE id = '<carrier UUID = auth.users.id>';
  ```
- Do NOT charge Ken — no Stripe, no coupon, direct SQL only

### 7. ACE Morning Brief — Next Build
- Wire n8n trigger to Cloud Run or Supabase function
- Inbound SMS parser tested end-to-end
- Dashboard focus zone input confirmed working

### 8. ACE Scout — Future Build
- Design Sylectus session management
- Build load deduplication store
- Wire broker email extraction to brokers table

### 9. Infrastructure (Required before public launch)
- Privacy Policy page — required for Google OAuth verification
- Terms of Service page — required for Google OAuth verification
- Google OAuth verification submission
- Stripe flip to live mode before first real carrier payment

---

## Standing Notes

- **RESTORE RULE:** If main.py breaks — restore from `git show 2c4a409:services/gmail-webhook/main.py` before attempting any fix
- `/carrier` route retired — all dashboard traffic routes to `/dashboard`
- `CARRIER_UUID` env var removed from deploy.sh and Cloud Run — carrier identity from auth.users.id at runtime
- Gmail Watch expires every 7 days — Cloud Scheduler calls `/renew-watches` weekly
- All Pub/Sub deliveries must always return HTTP 200 — non-200 causes infinite retry loops
- Deduplication runs before any Claude/SMS calls — `is_duplicate()` checks both `responses` and `unknown_brokers_inbox`
- Load board emails (DAT, Truckstop, Spot, NTG) intercepted before broker lookup — separate SMS path
- `trailingSlash: false` in vercel.json — required for all POST endpoints
- `routes` and `rewrites` cannot coexist in vercel.json — use only `rewrites` + `redirects`
- OTP: 8-digit code, type: 'signup', Magic Link template via Resend
- Classification filter uses `active_focus_zip` when set — falls back to `home_base_zip`
- SMTP via Resend — sender noreply@xtxtransport.com — display name EdgeTech
- RLS disabled on carriers table — enforced at application layer
- deploy.sh auto-sources .env — secrets inject correctly on deploy

---

## Files of Interest

| File | Purpose |
|------|---------|
| `services/gmail-webhook/main.py` | Core backend — all Flask routes, Claude, Telnyx, Stripe, Gmail logic |
| `services/gmail-webhook/deploy.sh` | Cloud Run deploy — auto-sources .env |
| `dashboard/src/pages/Login.jsx` | Auth UI — signin, OTP, forgot password |
| `dashboard/public/home.html` | Landing page — inline OTP signup + modal |
| `dashboard/public/dashboard.html` | Carrier dashboard — dark/light mode, ACE status, KPI panels |
| `dashboard/public/onboard.html` | Step 1 — truck info |
| `dashboard/public/onboard-lanes.html` | Step 2 — lane preferences |
| `dashboard/public/onboard-rates.html` | Step 3 — rate floors |
| `dashboard/public/onboard-gmail.html` | Step 4 — Gmail OAuth (live) |
| `dashboard/api/stripe-webhook.js` | Stripe webhook — activates/deactivates carriers |
| `dashboard/api/create-checkout-session.js` | Creates Stripe checkout session |
| `dashboard/vercel.json` | Routing, rewrites, redirects |

---

## Session Changelog — April 23 2026

| # | Change | Detail |
|---|--------|--------|
| 1 | Domain migrated | xedge-ai.com → xtxtec.com across all files and configs |
| 2 | Stripe webhook built | `dashboard/api/stripe-webhook.js` — checkout.session.completed + customer.subscription.deleted |
| 3 | Vercel env vars added | STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_KEY added to Vercel Production (Project tab) |
| 4 | vercel.json updated | trailingSlash: false; routes → rewrites; 301 redirects |
| 5 | DNS — DKIM + DMARC | Added to xtxtec.com DNS |
| 6 | Support email | Updated to ken@xtxtec.com |
| 7 | Webhook env convention | SUPABASE_KEY = service_role JWT |

## Session Changelog — April 25 2026

| # | Change | Detail |
|---|--------|--------|
| 1 | OTP card selector fix | Broken `.form-row:first-of-type` → `#card-form-view` wrapper; OTP block renders correctly |
| 2 | verifyOtp type fixed | type: 'email' → type: 'signup' |
| 3 | OTP 8-digit | maxlength=8; all "6-digit" copy updated; token.length guard updated |
| 4 | /carrier route retired | App.jsx route deleted; Login.jsx + ResetPassword.jsx → /dashboard; Layout.jsx nav → /dashboard |
| 5 | EDGE brand corrections | Platform name EDGE / XEdge applied throughout docs and UI |
| 6 | ACE agent name locked | ACE = Agentic Carrier Employee |
| 7 | SMTP → Resend | noreply@xtxtransport.com, display name EdgeTech, Magic Link template |
| 8 | Gmail OAuth confirmed live | onboard-gmail.html OAuth flow tested and connected |
| 9 | Stripe webhook confirmed | subscription_status activation end-to-end confirmed |
| 10 | Supabase columns added | active_focus_zip, active_focus_city, active_focus_state, focus_updated_at, outreach_time |
| 11 | ACE Morning Brief designed | n8n SMS trigger, inbound SMS parser, dashboard input path, midnight reset logic |
| 12 | ACE Scout designed | Sylectus automation, session persistence, dedup, broker email extraction, Gmail outreach |
| 13 | RLS confirmed disabled | carriers table — enforced at app layer |
| 14 | deploy.sh fixed | Auto-sources .env; CARRIER_UUID removed |

## Session Changelog — May 1 2026

| # | Change | Detail |
|---|--------|--------|
| 1 | main.py recovery | Restored from git commit 2c4a409 — extract_brokers before classification routing |
| 2 | Cloud Run revision | Restored from 00069-xz2; new stable revision 00106-fzh |
| 3 | Restore rule added | Standing rule: if main.py breaks, restore from 2c4a409 before any fix attempt |
| 4 | Version docs updated | Runbook v8.0, PRD v5.0, PitchBook v1.2 — clean restart docs committed |

---

## Troubleshooting Log

### [RESOLVED] Stripe webhook returning 307 on POST to xtxtec.com/api/stripe-webhook
**Date:** April 23 2026
**Root Cause:** Vercel trailing slash enforcement redirects POST — Stripe does not follow redirects.
**Resolution:** `"trailingSlash": false` in `vercel.json`. Commit `226b565`.

### [RESOLVED] Stripe webhook env vars missing from Vercel production
**Date:** April 23 2026
**Root Cause:** Vars added under Vercel Shared tab instead of Project tab.
**Resolution:** Re-added under Project tab. Always use Project tab, not Shared tab.

### [RESOLVED] home.html OTP block never rendered after signInWithOtp()
**Date:** April 25 2026
**Root Cause:** `.form-row:first-of-type` returned null — `:first-of-type` matches by tag, not class. Null threw TypeError before OTP block appended.
**Resolution:** Wrapped fields in `#card-form-view`. Replaced broken selector with `getElementById('card-form-view')`. Commit `e4ffa3f`.

### [RESOLVED] main.py instability after extract_brokers classification routing added
**Date:** May 1 2026
**Root Cause:** Changes to main.py after commit 2c4a409 introduced instability.
**Resolution:** Restored from 2c4a409. Cloud Run redeployed — revision 00106-fzh confirmed stable.

### [OPEN] Stripe webhook email match — OTP signup race condition
**Date:** April 25 2026
**Symptom:** subscription_status may not flip to active on OTP signups.
**Root Cause:** carriers row may not exist yet at time of checkout.session.completed webhook.
**Fix required:** Upsert on email in stripe-webhook.js, or confirm carriers row creation timing.

---

*EDGEai Runbook v8.0 | XTX LLC | May 1 2026*
