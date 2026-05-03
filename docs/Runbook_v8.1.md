# EDGEai — Master Context Note (Runbook)
**Version:** 8.1 | **Date:** May 1, 2026 | Paste-ready for next session

---

## VERSION HISTORY

| Version | Date | Summary |
|---------|------|---------|
| 7.0 | April 17, 2026 | Broker extraction SSE streaming, inbox scanning, single endpoint |
| 7.1 | April 25, 2026 | Domain migration xtxtec.com, Stripe webhook, OTP fixes, SMTP Resend, Gmail OAuth live, Morning Brief designed, ACE Scout designed |
| 8.0 | May 1, 2026 | Clean restart after main.py recovery. Restored from git commit 2c4a409. Cloud Run revision 00106-fzh restored from 00069-xz2. Standing restore rule added. |
| 8.1 | May 1, 2026 | Dynamic carrier lookup Option B, noise filter cleanup, unknown broker routing, extract-brokers rewrite (INBOX scan, background thread, Claude enrichment), full revision history documented. |

---

## CLOUD RUN REVISION HISTORY

| Revision | Notes |
|----------|-------|
| 00106-fzh | Last known good restore from git 2c4a409 — dynamic carrier lookup not yet implemented |
| 00107-hk2 | Dynamic carrier lookup Option B deployed — **STABLE FALLBACK** |
| 00108-cg9 | Noise subjects removed from inbound filter |
| 00109-8hv | Unknown broker early return removed — all senders land in unknown_brokers_inbox |
| 00110-k2g | Extract-brokers rewritten — INBOX scan, background thread, Claude enrichment |
| 00111-zwc | Extract-brokers exception handler — full traceback logging |
| 00112-d7j | min-instances=1 set — prevents background thread kill |

### Fallback to 00107-hk2 (STABLE FALLBACK)

```bash
gcloud run services update-traffic edgeai-gmail-webhook \
  --to-revisions=edgeai-gmail-webhook-00107-hk2=100 \
  --region=us-central1 \
  --project=edgeai-493115
```

### Git fallback for main.py

```bash
git checkout 2c4a409 -- services/gmail-webhook/main.py
```

---

## v8.0 Recovery Notes

**What happened:** main.py was modified after commit 2c4a409, causing instability. Service was restored by rolling back Cloud Run to revision 00069-xz2 and redeploying from 2c4a409 baseline, producing revision 00106-fzh.

**Restore reference:**
- Git baseline commit: `2c4a409` (rollback: restore to e707217 — extract_brokers before classification routing)
- Cloud Run restored from: revision `00069-xz2`
- First stable revision after restore: `00106-fzh`
- Current stable fallback: `00107-hk2`

**Standing rule — if main.py breaks:**
1. Do NOT attempt inline hotfixes to a broken main.py
2. First restore: `git show 2c4a409:services/gmail-webhook/main.py` to recover the known-good baseline
3. Or roll Cloud Run traffic back to `00107-hk2` immediately
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
| Active revision | 00112-d7j |
| Stable fallback revision | 00107-hk2 |
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

edgeai-gmail-webhook — Cloud Run (Python/Flask) — revision 00112-d7j
  /webhook           — Pub/Sub push receiver
  /health            — Health check
  /confirm-win       — Carrier confirms a won load
  /renew-watches     — Weekly Gmail watch renewal
  /extract-brokers   — POST {carrier_id} → returns immediately, background thread scans INBOX 180 days, Claude enriches, writes to brokers table
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
| brokers | Broker contacts per carrier. carrier_id, email, name, company, status (hot/warm/cold), priority, notes, last_load_origin, last_load_destination, last_reply_at |
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

### brokers table — new columns added in v8.1

| Column | Purpose |
|--------|---------|
| notes | 1-sentence Claude summary of relationship or load type |
| last_load_origin | City ST — last load origin extracted by Claude |
| last_load_destination | City ST — last load destination extracted by Claude |
| priority | high / medium / low — Claude-scored on extraction |

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
10. /extract-brokers POST → returns {status: started} immediately → background thread scans INBOX 180 days → Claude enriches → writes to brokers table
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

### 2. Brokers Table Schema Confirm
- Confirm new columns exist in production: `notes`, `last_load_origin`, `last_load_destination`, `priority`
- Add any missing columns via Supabase dashboard SQL before running /extract-brokers live

### 3. Extract-Brokers Live Test
- Run `/extract-brokers` against Ken's live Gmail INBOX
- Confirm background thread completes and rows appear in brokers table
- Confirm onboard-gmail.html Supabase poll shows live count climbing
- Verify "Continue to Dashboard" button activates on completion

### 4. STRIPE_WEBHOOK_SECRET Missing from Cloud Run (OPEN BUG)
- Cloud Run logs show 500 on `/stripe-webhook` — `STRIPE_WEBHOOK_SECRET` env var not set
- Fix: `gcloud run services update edgeai-gmail-webhook --region us-central1 --set-env-vars STRIPE_WEBHOOK_SECRET=...`

### 5. Stripe Webhook Email Match Fix (BUG)
- In `dashboard/api/stripe-webhook.js`, fix carrier lookup on `checkout.session.completed`
- Issue: OTP signups may not have a carriers row yet at webhook time
- Fix: upsert on email, or delay lookup until carriers row confirmed

### 6. Founder Account Activation (BLOCKER)
- Direct Supabase SQL:
  ```sql
  UPDATE carriers SET subscription_status = 'active', subscription_tier = 'base'
  WHERE id = '<carrier UUID = auth.users.id>';
  ```
- Do NOT charge Ken — no Stripe, no coupon, direct SQL only

### 7. Dashboard Live Data Wiring
- dashboard.html — replace hardcoded broker rows with live Supabase query
- Sidebar counts from live brokers and unknown_brokers_inbox tables
- Focus zone input → PATCH carriers table
- ACE status dot from real subscription_status

### 8. ACE Morning Brief — Next Build
- Wire n8n trigger to Cloud Run or Supabase function
- Inbound SMS parser tested end-to-end
- Dashboard focus zone input confirmed working

### 9. ACE Scout — Future Build
- Design Sylectus session management
- Build load deduplication store
- Wire broker email extraction to brokers table

### 10. Infrastructure (Required before public launch)
- Privacy Policy page — required for Google OAuth verification
- Terms of Service page — required for Google OAuth verification
- Google OAuth verification submission
- Stripe flip to live mode before first real carrier payment

---

## Standing Notes

- **RESTORE RULE:** If main.py breaks — roll Cloud Run traffic to `00107-hk2` immediately, then restore from `git show 2c4a409:services/gmail-webhook/main.py` before attempting any fix
- `/carrier` route retired — all dashboard traffic routes to `/dashboard`
- `CARRIER_UUID` env var removed from deploy.sh and Cloud Run — carrier identity from `get_carrier_id_for_email()` at runtime
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
- `/extract-brokers` background thread is daemon=True — requires min-instances=1 on Cloud Run to prevent kill before completion

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
| `dashboard/public/onboard-gmail.html` | Step 4 — Gmail OAuth (live) + broker extraction poll |
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
| 2 | Cloud Run revision | Restored from 00069-xz2; stable revision 00106-fzh |
| 3 | Restore rule added | Standing rule: if main.py breaks, restore from 2c4a409 / roll to 00107-hk2 |
| 4 | Version docs | Runbook v8.0, PRD v5.0, PitchBook v1.2 committed |
| 5 | Dynamic carrier lookup | Option B implemented — `get_carrier_id_for_email()` replaces static CARRIER_UUID — revision 00107-hk2 |
| 6 | Login.jsx redirects fixed | handleForgot + handleGoogle → xtxtec.com (was edgeai-dashboard.vercel.app) |
| 7 | Noise subjects removed | `_noise_subjects` set + all references removed from process_message — revision 00108-cg9 |
| 8 | Unknown broker routing | Removed negative/unknown early return — all unrecognized senders land in unknown_brokers_inbox — revision 00109-8hv |
| 9 | Stripe webhook updated | checkout.session.completed now writes subscription_tier + stripe_customer_id |
| 10 | onboard-gmail.html rewrite | EventSource SSE replaced with fire-and-forget POST + Supabase poll (1s interval, stops on stable count) |
| 11 | extract-brokers rewrite | INBOX scan (not SENT), 180 days, background thread, Claude enriches 8 fields, direct write to brokers table — revision 00110-k2g |
| 12 | extract-brokers exception handler | log.exception replaces log.error — full traceback on thread crash — revision 00111-zwc |
| 13 | min-instances=1 set | Prevents Cloud Run from killing background thread before completion — revision 00112-d7j |
| 14 | Runbook v8.1 | Revision history, fallback commands, new brokers columns, updated build queue documented |

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

### [RESOLVED] /extract-brokers returning 405
**Date:** May 1 2026
**Root Cause:** onboard-gmail.html used EventSource (always GET). Route only accepts POST.
**Resolution:** Replaced EventSource with fire-and-forget fetch POST + Supabase poll.

### [OPEN] STRIPE_WEBHOOK_SECRET missing from Cloud Run env
**Date:** May 1 2026
**Symptom:** Cloud Run logs show 500 on `/stripe-webhook` — `AttributeError: 'NoneType' object has no attribute 'encode'`
**Root Cause:** STRIPE_WEBHOOK_SECRET not set as Cloud Run env var.
**Fix:** `gcloud run services update edgeai-gmail-webhook --region us-central1 --set-env-vars STRIPE_WEBHOOK_SECRET=...`

### [OPEN] Stripe webhook email match — OTP signup race condition
**Date:** April 25 2026
**Symptom:** subscription_status may not flip to active on OTP signups.
**Root Cause:** carriers row may not exist yet at time of checkout.session.completed webhook.
**Fix required:** Upsert on email in stripe-webhook.js, or confirm carriers row creation timing.

---

## SUPABASE SCHEMA REFERENCE

> Living section — update as columns are added. This is the source of truth for table design intent.

---

### `carriers` — Carrier profile & ACE configuration
Primary input for all Haiku outreach prompts. Populated at onboarding.

| Column | Type | Purpose |
|---|---|---|
| id | uuid | PK = auth.users.id |
| owner_name | text | First name used in outreach ("Ken here") |
| company_name | text | Carrier company name |
| email / phone | text | Contact info |
| truck_type | text | Equipment type ("26' box truck") |
| truck_length | int | Truck length in feet |
| equipment_type | text | Cargo type capability |
| has_lift_gate / has_pallet_jack / has_air_ride | bool | Equipment capabilities |
| max_load_weight | int | Max weight capacity (lbs) |
| home_base_city / home_base_state / home_base_zip | text | Where carrier is based ("back to OKC") |
| preferred_lanes | text | Preferred routes/corridors |
| message_tone | text | casual / professional — controls Haiku outreach voice |
| rate_floor / min_rate_local / min_rate_otr | numeric/int | Rate minimums |
| otr_willing | bool | Willing to run OTR |
| coverage_radius / max_radius | int | Miles from home base |
| outreach_time | text | Preferred time to send outreach |
| active_days | text | Days available |
| ace_status / ace_level | text/int | ACE agent state |
| subscription_status / subscription_tier | text | Billing state |
| gmail_token | text | OAuth refresh token for Gmail API |
| onboarding_complete | bool | All profile fields wired from onboarding page |

**Note:** `onboarding_complete = false` means Haiku outreach prompts will be incomplete. Wiring onboarding page answers → carriers row is a critical path item.

---

### `brokers` — Contact directory (one row per broker per carrier)
Source of truth for who to reach out to. Populated by `/extract-brokers` (SENT scan) and CSV import.

| Column | Type | Purpose |
|---|---|---|
| id | uuid | PK |
| carrier_id | uuid | FK → carriers |
| email | text | Broker email — unique per carrier |
| name | text | Broker first/last name |
| company | text | Brokerage name |
| phone | text | Direct or mobile phone |
| status | text | hot / warm / cold |
| priority | text | high / medium / low |
| days_cadence | int | Days between outreach attempts |
| last_contacted | timestamptz | Most recent SENT email to this broker — Haiku converts to natural language ("last Wednesday") |
| last_responded | timestamptz | Last time broker replied |
| response_count / load_count | int | Aggregate engagement stats |
| preferred | bool | Carrier-flagged as preferred |
| alert_requested | bool | Carrier wants SMS alert on any reply |

**Dedup rule:** on re-extract or CSV import, existing records are never duplicated — null fields (phone, company) are enhanced if new data is available.

---

### `outreach_log` — Every ACE outreach send event
One row per outreach email sent to a broker. Source of truth for cadence and timing.

| Column | Type | Purpose |
|---|---|---|
| id | uuid | PK |
| carrier_id / broker_id | uuid | FKs |
| channel | text | email / sms |
| subject | text | Email subject line |
| message_body | text | Full outreach content sent |
| sent_at | timestamptz | When ACE actually sent — Haiku reads this for "I reached out last Wednesday" |
| status | text | sent / bounced / failed |
| opened | bool | Email opened |
| responded | bool | Broker replied |
| responded_at | timestamptz | When broker replied |
| response_type | text | positive / negative / neutral |
| load_offered | bool | Broker offered a load |
| bid_amount | int | Rate offered |
| next_followup_at | timestamptz | Scheduled next outreach touch |

---

### `responses` — Broker reply events + SMS carrier notification loop
One row per inbound broker reply. Hub for the SMS → carrier → auto-reply cycle.

| Column | Type | Purpose |
|---|---|---|
| id | uuid | PK |
| carrier_id / broker_id | uuid | FKs |
| outreach_id | uuid | FK → outreach_log row that triggered this reply |
| thread_id | text | Gmail thread ID |
| gmail_message_id | text | Gmail message ID |
| subject / body / raw_email | text | Broker reply content |
| classification | text | load_offer / positive / negative / neutral |
| load_origin / load_destination | text | Parsed from broker reply |
| load_distance | int | Miles |
| equipment_needed | text | What the broker needs |
| pickup_time | text | Pickup window |
| rate_offered | int | Rate in broker reply |
| carrier_notified | bool | SMS was sent to carrier |
| **sms_token** | text UNIQUE | One-time token embedded in SMS hot links — used to identify which response the carrier is acting on |
| sms_sent_at | timestamptz | When SMS notification fired to carrier |
| carrier_response | text | BOOK / PASS / CALL — carrier's SMS tap |
| carrier_responded_at | timestamptz | When carrier tapped the SMS link |
| load_accepted | bool | Load was booked |
| followup_sent_at | timestamptz | When ACE auto-sent triggered reply to broker |
| followup_body | text | What ACE said to broker after carrier responded |

**SMS loop flow:**
```
broker replies positive
  → responses row created, sms_token generated
  → SMS to carrier: "[BOOK] [PASS] [CALL]" links embed sms_token
  → carrier taps → platform resolves sms_token → sets carrier_response
  → ACE fires triggered email to broker → followup_sent_at set
  → if BOOK → load_wins row created
```

---

### `load_wins` — Confirmed booked loads
| Column | Type | Purpose |
|---|---|---|
| carrier_id / broker_id | uuid | FKs |
| broker_email / broker_name / broker_company / broker_phone | text | Denormalized at time of booking |
| load_origin / load_destination | text | Lane |
| rate_confirmed | numeric | Final agreed rate |
| load_reference | text | Broker's load/reference number |
| subject / body / gmail_message_id | text | Source email |

---

### `trucks` — Fleet (multi-truck carriers)
Used when `multi_truck_mode = true` on carriers row.

| Column | Type | Purpose |
|---|---|---|
| carrier_id | uuid | FK |
| unit_number | text | Truck identifier |
| equipment_type | text | Truck type |
| liftgate / max_weight | bool/int | Capabilities |
| home_base_zip | text | Where this unit operates from |
| status | text | available / on_load / maintenance |

---

### `unknown_brokers_inbox` — Unrecognized inbound senders
Staging area for Gmail senders not yet in the brokers table. Carrier reviews and promotes to brokers manually or via dashboard action.

---

*EDGEai Runbook v8.1 | XTX LLC | May 1 2026*
