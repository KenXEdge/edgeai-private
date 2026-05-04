# EDGEai — Master Context Note (Runbook)
**Version:** 8.2 | **Date:** May 4, 2026 | Paste-ready for next session

---

## VERSION HISTORY

| Version | Date | Summary |
|---------|------|---------|
| 7.0 | April 17, 2026 | Broker extraction SSE streaming, inbox scanning, single endpoint |
| 7.1 | April 25, 2026 | Domain migration xtxtec.com, Stripe webhook, OTP fixes, SMTP Resend, Gmail OAuth live, Morning Brief designed, ACE Scout designed |
| 8.0 | May 1, 2026 | Clean restart after main.py recovery. Restored from git commit 2c4a409. Cloud Run revision 00106-fzh restored from 00069-xz2. Standing restore rule added. |
| 8.1 | May 1, 2026 | Dynamic carrier lookup Option B, noise filter cleanup, unknown broker routing, extract-brokers rewrite (INBOX scan, background thread, Claude enrichment), full revision history documented. |
| 8.2 | May 4, 2026 | Extract-brokers pipeline major overhaul: SENT scan (180 days), thread-local Anthropic client fix (was root cause of 100% enrichment failure), unified Claude prompt, lane capture (origin/destination), touch_count, carrier identity filter (dynamic + domain token fallback), schema cleanup (drop city/state, add title + touch_count). Best fill rates achieved: company 93%, name 92%, title 78%, phone 53%, lanes 69-71%. Active revision 00134. Table currently empty — re-run required. |

---

## CLOUD RUN REVISION HISTORY

| Revision | Notes |
|----------|-------|
| 00106-fzh | Last known good restore from git 2c4a409 |
| 00107-hk2 | Dynamic carrier lookup Option B — **STABLE FALLBACK** |
| 00108-cg9 | Noise subjects removed from inbound filter |
| 00109-8hv | Unknown broker early return removed — all senders land in unknown_brokers_inbox |
| 00110-k2g | Extract-brokers rewritten — INBOX scan, background thread, Claude enrichment |
| 00111-zwc | Extract-brokers exception handler — full traceback logging |
| 00112-d7j | min-instances=1 set — prevents background thread kill |
| 00124 | Extract-brokers rewritten for SENT folder (180 days), thread-local Gmail service, batch metadata |
| 00125 | Unified Claude prompt — best overall fill rates but no lane data. company 97%, name 95%, phone 42/147 |
| 00126 | Split prompt (SOURCE 1 / SOURCE 2) — company fill collapsed to 26% — ABANDONED |
| 00127 | Gentler quote stripper (only cuts on `---Original Message---` and `On [date] wrote:`) — phone 42 |
| 00128 | Best stable config: 30-line sent_context, unified prompt, thread-local Anthropic fix, lane capture. company 93%, name 92%, title 78%, phone 53%, origin 71%, dest 69%, touch_count 100% |
| 00129 | Removed quote stripper + 12-line limit — company fell to 65% — ABANDONED, reverted to 00128 |
| 00130 | touch_count added — increments per SENT message to each broker email |
| 00131 | Schema migrations applied: DROP city, DROP state, ADD title VARCHAR(25), ADD touch_count INTEGER |
| 00132 | Carrier identity filter — nulls name/phone/company if matches carrier's own info (dynamic lookup from carriers table) |
| 00133 | Domain token fix attempt — "transport" token too broad, nulled legitimate broker companies — REVERTED |
| 00134 | Carrier identity filter corrected: strip freight suffixes (transport/trucking/freight/logistics/etc.) from email domain → unique brand token only (xtxtransport → xtx). Current active revision. Table empty — needs re-run. |

### Fallback to 00107-hk2 (STABLE FALLBACK — pre-extract-brokers)

```bash
gcloud run services update-traffic edgeai-gmail-webhook \
  --to-revisions=edgeai-gmail-webhook-00107-hk2=100 \
  --region=us-central1 \
  --project=edgeai-493115
```

### Fallback to 00128 (best extract-brokers config)

```bash
gcloud run services update-traffic edgeai-gmail-webhook \
  --to-revisions=edgeai-gmail-webhook-00128=100 \
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
- **Carrier row:** `owner_name`, `phone`, `company_name` currently null (onboarding incomplete) — identity filter falls back to domain token `xtx`

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
| Active revision | 00134 |
| Best extract-brokers revision | 00128 |
| Stable fallback revision | 00107-hk2 |
| Git restore baseline | 2c4a409 |
| Latest master commit | 9075c8e (feat: touch_count, carrier identity filter, dynamic domain token) |
| GCP project | edgeai-493115 |
| Pub/Sub topic | projects/edgeai-493115/topics/edgeai-gmail |
| Live Domain | https://xtxtec.com |
| Dashboard URL | https://xtxtec.com/dashboard |
| CORS origin | https://xtxtec.com |
| Stripe price — Base | price_1TN2Y5**** |
| Stripe price — Base Plus | price_1TN2Yh**** |
| Stripe price — Dispatcher Pro (setup) | price_1TN2dg**** |
| Claude model (classify + enrich) | claude-haiku-4-5-20251001 |
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

edgeai-gmail-webhook — Cloud Run (Python/Flask) — revision 00134
  /webhook           — Pub/Sub push receiver
  /health            — Health check
  /confirm-win       — Carrier confirms a won load
  /renew-watches     — Weekly Gmail watch renewal
  /extract-brokers   — POST {carrier_id} → streams NDJSON → scans SENT 180 days → Claude enriches → writes to brokers table
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
| brokers | Broker contacts per carrier — see schema below |
| responses | Every classified email. gmail_message_id, carrier_id, broker_id, classification, load_accepted |
| load_wins | Confirmed won loads |
| unknown_brokers_inbox | Emails from senders not in brokers table — pending carrier review |
| gmail_sync | historyId tracking per email address |

### carriers table — full column list

| Column | Purpose |
|--------|---------|
| id | UUID — matches auth.users.id |
| email | Carrier email |
| name | Display name |
| owner_name | Carrier owner full name — used for identity filter in extract-brokers |
| phone | Carrier phone — used for identity filter in extract-brokers |
| company_name | Carrier company name — used for identity filter in extract-brokers |
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

**NOTE:** `owner_name`, `phone`, `company_name` are required for carrier identity filtering in extract-brokers. These fields must be collected and required during onboarding. Currently null for Ken (pre-onboarding). Identity filter falls back to email domain token when null.

### brokers table — current schema (v8.2)

| Column | Purpose |
|--------|---------|
| id | UUID primary key |
| carrier_id | FK → carriers.id |
| email | Broker email address |
| name | Broker full name (from signature) |
| title | Job title max 25 chars (from signature) |
| company | Brokerage/company name |
| phone | Mobile number only — office/ext numbers excluded |
| status | hot / warm / cold |
| priority | high / medium / low |
| days_cadence | Outreach cadence in days |
| last_contacted | Timestamp of most recent outbound email to this broker |
| last_load_origin | City ST — pickup location from last bid email |
| last_load_destination | City ST — delivery location from last bid email |
| touch_count | Total SENT emails to this broker (relationship indicator) |
| last_reply_at | Timestamp of broker's most recent reply |
| notes | Claude relationship summary |

**Columns removed this session:** `city`, `state` (useless — already have company; city/state was ambiguous)

---

## Extract-Brokers Pipeline — v8.2 Architecture

### Flow

```
POST /extract-brokers {carrier_id}
  → validate carrier_id, fetch gmail_token, fetch carrier identity (owner_name, phone, company_name)
  → domain token fallback if identity fields null (strip freight suffixes → unique brand prefix)
  → Gmail API: scan SENT folder, maxResults=500, 180 days
  → batch metadata fetch: To, Subject, Date headers
  → deduplicate by email, build: email_to_name, email_last_seen, email_touch_counts, email_message_ids
  → ThreadPoolExecutor(max_workers=3): _process_broker() per unique email
      → thread-local OAuthCredentials refresh
      → thread-local Gmail service (build() — never share across threads)
      → INBOX fetch: most recent email FROM this broker (for signature)
      → _extract_body_text() + _strip_reply_quotes()
      → take last 20 lines of signature block
      → SENT fetch: most recent outbound email TO this broker
      → take first 30 lines as lane context
      → thread-local Anthropic client (never share — causes empty content[] lists)
      → Claude Haiku: unified prompt → JSON {name, title, company, phone, origin, destination}
      → markdown fence strip before json.loads()
      → carrier identity filter: null fields matching carrier own name/phone/company token
      → Supabase INSERT (on conflict: skip — unique constraint on carrier_id + email)
  → NDJSON stream: progress events per broker + final summary
```

### Critical bugs fixed this session

| Bug | Symptom | Fix |
|-----|---------|-----|
| Global Anthropic singleton | `content[]` empty on 100% of brokers | Create `anthropic.Anthropic()` fresh inside each thread |
| Claude returns markdown fences | `json.loads()` fails | Strip ` ```json ` fences before parse |
| Broad domain token | "transport" matched "AM Transport" | Strip freight suffixes, keep unique prefix only |
| Aggressive quote stripper | Cut legitimate signature content | Only cut on `---Original Message---` and `On [date] wrote:` |

### Fill rates — revision 00128 (best achieved)

| Field | Fill Rate | Notes |
|-------|-----------|-------|
| name | 92% | Limited by brokers who never replied (no INBOX data) |
| company | 93% | Best field — usually in sent email context |
| title | 78% | Available in most signatures |
| phone | 53% | Ceiling — ~50% of brokers have no INBOX reply; mobile-only rule further limits |
| origin | 71% | From lane context in outbound bid emails |
| destination | 69% | From lane context in outbound bid emails |
| last_contacted | 100% | From Date header |
| touch_count | 100% | Counted from SENT scan |

### Carrier identity filter logic

```python
# Primary: owner_name, phone, company_name from carriers table
# Fallback: email domain → strip freight suffixes → unique token
# Example: xtxtransport.com → strip "transport" → xtx
FREIGHT_SUFFIXES = r'(transport(ation)?|trucking?|freight|logistics|express|llc|inc|corp|co|group|services?)'
# Filter: null enriched fields if they contain carrier's own name/phone/company token
# company check: carrier_company (≥2 chars) must be a substring of enriched company
```

### Pending improvements

- **Unique constraint:** `(carrier_id, email)` — prevent duplicate rows on re-run
- **Supplementary INBOX scan:** separate pass for anonymous broker emails that arrived but carrier never replied to (unread load offers)
- **outreach_log table:** track outreach attempts, cadence, response status for priority scoring
- **Ken's onboarding fields:** `owner_name` and `phone` must be required fields at onboarding for full name/phone filter to activate

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

## SMS — Future Load Opportunity Loop

**Status:** Designed, not yet built. SMS_ENABLED=false. Telnyx not yet set up.

When a broker emails an inbound load opportunity (any sender not in brokers table, or classified load_offer):
1. System sends SMS to carrier with: load details (origin, destination, rate, dates, mileage, broker name)
2. Carrier replies via SMS: **Pass**, **Book**, or **Call**
3. System receives Telnyx inbound webhook → routes reply back through EDGE → auto-email to broker with carrier's response

This is the core real-time value loop. Requires:
- Telnyx account + number configured
- Inbound webhook wired to Cloud Run
- outreach_log table to track the loop state per load opportunity

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
10. /extract-brokers POST → streams NDJSON progress → background scans SENT 180 days → Claude enriches → writes to brokers table
11. Gmail Watch started → ACE live
```

**Required onboarding fields to add:** `owner_name`, `phone`, `company_name` — needed for full carrier identity filter in extract-brokers. Currently not collected.

**Known bug:** Stripe webhook email match does not flip `subscription_status` to active on OTP signups — carrier lookup may fail if email not yet in carriers table at time of webhook. Fix required next session.

---

## Build Queue — Next Session Priorities

### 1. Re-run /extract-brokers (IMMEDIATE)
- Brokers table is currently empty — 00134 run was in progress at session pause, likely hit Anthropic rate limit
- Run from dashboard once gcloud auth is set up on new machine
- Confirm fill rates match 00128 baseline

### 2. Unique Constraint on brokers (BEFORE re-run)
```sql
ALTER TABLE brokers ADD CONSTRAINT brokers_carrier_email_unique UNIQUE (carrier_id, email);
```
- Prevents duplicate rows on re-runs
- Insert will silently skip on conflict

### 3. Telnyx SMS (BLOCKER for live value)
- Set up Telnyx account
- Wire Telnyx into main.py — remove all remaining Twilio references
- Test inbound + outbound SMS end-to-end
- Flip `SMS_ENABLED=true` only after confirmed working

### 4. Supplementary INBOX Scan
- Separate pass: scan INBOX for emails FROM addresses not yet in brokers table
- Capture anonymous load offers that came inbound but carrier never replied
- Insert with status='cold', source='inbox_scan'

### 5. STRIPE_WEBHOOK_SECRET Missing from Cloud Run (OPEN BUG)
- Cloud Run logs show 500 on `/stripe-webhook` — `STRIPE_WEBHOOK_SECRET` env var not set
- Fix: `gcloud run services update edgeai-gmail-webhook --region us-central1 --set-env-vars STRIPE_WEBHOOK_SECRET=...`

### 6. Stripe Webhook Email Match Fix (BUG)
- In `dashboard/api/stripe-webhook.js`, fix carrier lookup on `checkout.session.completed`
- Issue: OTP signups may not have a carriers row yet at webhook time
- Fix: upsert on email, or delay lookup until carriers row confirmed

### 7. Founder Account Activation (BLOCKER)
- Direct Supabase SQL:
  ```sql
  UPDATE carriers SET subscription_status = 'active', subscription_tier = 'base'
  WHERE id = '<carrier UUID = auth.users.id>';
  ```
- Do NOT charge Ken — no Stripe, no coupon, direct SQL only

### 8. Dashboard Live Data Wiring
- dashboard.html — replace hardcoded broker rows with live Supabase query
- Sidebar counts from live brokers and unknown_brokers_inbox tables
- Focus zone input → PATCH carriers table
- ACE status dot from real subscription_status

### 9. Onboarding — Required Fields
- Add `owner_name`, `phone`, `company_name` as required fields on /onboard step 1
- These power the carrier identity filter in extract-brokers for all future carriers

### 10. outreach_log Table
- Track: carrier_id, broker_id, sent_at, load_origin, load_destination, offered_rate, carrier_response (pass/book/call), responded_at
- Required for the SMS load opportunity response loop

### 11. ACE Morning Brief — Next Build
- Wire n8n trigger to Cloud Run endpoint or Supabase function
- Inbound SMS parser tested end-to-end
- Dashboard focus zone input confirmed working

### 12. ACE Scout — Future Build
- Design Sylectus session management
- Build load deduplication store
- Wire broker email extraction to brokers table

### 13. Infrastructure (Required before public launch)
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
- `/extract-brokers` uses NDJSON streaming (not SSE) — Flask `stream_with_context`
- `gmail_service()` must never cache globally — every call builds fresh credentials
- Anthropic client must never be shared across threads — create fresh inside each thread
- SMS_ENABLED=false — do not flip until Telnyx is live and tested
- n8n workflows are ARCHIVED — do not unarchive (Morning Brief scheduler is the only active workflow)
- Stripe is in TEST mode — do not flip to live until Ken instructs

---

## New Machine Setup (Ken — May 4 2026)

Ken moved to a new machine. Setup steps:

```bash
# 1. Clone repo
git clone https://github.com/KenXEdge/edgeai-private.git
cd edgeai-private

# 2. Authenticate gcloud (use ken@xedge-ai.com)
gcloud auth login
gcloud config set project edgeai-493115

# 3. Re-create .env in services/gmail-webhook/
# Copy values from your secrets store — do NOT paste into chat

# 4. Open Claude Code
cd C:\path\to\edgeai-private\dashboard
claude
```

Session context (MEMORY.md + session summary) is synced to Anthropic account — loads automatically.
Raw chat `.jsonl` is local to old machine only — not required, session summary covers all context.

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

## Session Changelog — May 4, 2026

| # | Change | Detail |
|---|--------|--------|
| 1 | Extract-brokers SENT scan | Switched from INBOX scan to SENT folder — carrier is the sender, brokers are recipients |
| 2 | Thread-local Anthropic fix | Root cause of 100% enrichment failure: global singleton empty content[] across threads. Fixed: create `anthropic.Anthropic()` fresh inside each thread |
| 3 | Markdown fence strip | Claude wraps JSON in ```json blocks — strip before `json.loads()` |
| 4 | Unified Claude prompt | Single prompt with both signature + lane context — split prompt (00126) destroyed company fill |
| 5 | Lane capture | Added origin/destination extraction from outbound bid email context |
| 6 | touch_count | Total SENT messages per broker — relationship depth indicator |
| 7 | Carrier identity filter | Dynamic per carrier_id — nulls name/phone/company if matches carrier's own info |
| 8 | Domain token derivation | Strip freight suffixes from email domain → unique brand prefix (xtxtransport → xtx) |
| 9 | Schema cleanup | DROP city, DROP state — useless columns removed |
| 10 | Schema additions | ADD title VARCHAR(25), ADD touch_count INTEGER DEFAULT 0 |
| 11 | Gentle quote stripper | Only cuts on `---Original Message---` and `On [date] wrote:` — preserves signature content |
| 12 | 30-line sent_context | Increased from 12 lines — captures company info that appears later in bid emails |
| 13 | NDJSON streaming | Flask `stream_with_context(run())` — keeps Cloud Run instance alive during long runs |
| 14 | ThreadPoolExecutor | max_workers=3 — parallel broker processing, respects Anthropic rate limits |
| 15 | Best fill rates | 00128: company 93%, name 92%, title 78%, phone 53%, origin 71%, dest 69% |
| 16 | Session docs | Runbook v8.2, PRD v5.1, Transition May04 — committed to docs/ |

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

### [RESOLVED] Claude enrichment returning empty on 100% of brokers
**Date:** May 4 2026
**Root Cause:** `anthropic.Anthropic()` client created once globally and shared across threads. httpx client is not thread-safe — resulted in empty `content[]` lists on every call.
**Resolution:** Create new `anthropic.Anthropic(api_key=...)` instance inside each `_process_broker()` thread call.

### [RESOLVED] json.loads() failing on Claude output
**Date:** May 4 2026
**Root Cause:** Claude Haiku wraps JSON response in ```json markdown fences by default.
**Resolution:** Strip fences before parse — check for ` ``` ` prefix, split on fence markers, extract inner content.

### [RESOLVED] Carrier company token too broad (revision 00133)
**Date:** May 4 2026
**Root Cause:** `xtxtransport` was split into tokens `["xtx", "transport"]` — "transport" matched legitimate broker companies like "AM Transport Expedite".
**Resolution:** Strip common freight suffixes from domain before tokenizing. `xtxtransport` → `xtx` only.

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

### [OPEN] Brokers table empty — 00134 run needs re-run
**Date:** May 4 2026
**Symptom:** Zero rows in brokers table after 00134 run.
**Root Cause:** Anthropic rate limit likely hit during run (session was paused for rate-limit cooldown). Cloud Run instance may have recycled.
**Fix:** Re-run `/extract-brokers` with gcloud auth on new machine. Table is clean — safe to re-run.

---

*EDGEai Runbook v8.2 | XTX LLC | May 4 2026*
