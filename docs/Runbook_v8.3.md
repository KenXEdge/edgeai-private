# EDGEai — Master Context Note (Runbook)
**Version:** 8.3 | **Date:** May 5, 2026 | Paste-ready for next session

---

## VERSION HISTORY

| Version | Date | Summary |
|---------|------|---------|
| 7.0 | April 17, 2026 | Broker extraction SSE streaming, inbox scanning, single endpoint |
| 7.1 | April 25, 2026 | Domain migration xtxtec.com, Stripe webhook, OTP fixes, SMTP Resend, Gmail OAuth live, Morning Brief designed, ACE Scout designed |
| 8.0 | May 1, 2026 | Clean restart after main.py recovery. Restored from git commit 2c4a409. Cloud Run revision 00106-fzh restored from 00069-xz2. Standing restore rule added. |
| 8.1 | May 1, 2026 | Dynamic carrier lookup Option B, noise filter cleanup, unknown broker routing, extract-brokers rewrite (INBOX scan, background thread, Claude enrichment), full revision history documented. |
| 8.2 | May 4, 2026 | Extract-brokers pipeline major overhaul: SENT scan (180 days), thread-local Anthropic client fix, unified Claude prompt, lane capture (origin/destination), touch_count, carrier identity filter, schema cleanup (drop city/state, add title + touch_count). Best fill rates: company 93%, name 92%, title 78%, phone 53%, lanes ~70%. Active revision 00134. |
| 8.3 | May 5, 2026 | Dashboard wired to live Supabase data. Broker + Pending Broker management views built. RLS fixed on brokers + unknown_brokers_inbox. broker_count/pending_count trigger columns on carriers. contact_enabled on brokers. Onboarding reduced to 4 steps (rates page removed, rate floor on Step 1). vercel.json no-cache headers. KPI wiring complete — Broker Touches label is INCORRECT (see open bug). Load Offer Pipeline and Chrome Extension pinned. |

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
| 00134 | Carrier identity filter corrected: strip freight suffixes → unique brand token only (xtxtransport → xtx). Current active revision. |

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
- Git baseline commit: `2c4a409`
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
- **Email:** korbs827@gmail.com / kenkorbel@gmail.com
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
| Latest master commit | dab8d67 (feat: wire KPI strip — Broker Touches, Replies, Load Wins live from brokers table) |
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
  /onboard           — Step 1: truck info + rate floor (4-step flow)
  /onboard/lanes     — Step 2: lane preferences
  /onboard/gmail     — Step 3: Gmail OAuth connect (rates page removed May 5)
  /dashboard         — Main carrier dashboard
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
| unknown_brokers_inbox | Emails from unknown senders — pending carrier review (Pending Brokers view) |
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
| home_base_city | City from onboarding |
| home_base_state | State from onboarding |
| max_radius | Max deadhead radius |
| active_focus_zip | Current focus ZIP — overrides home_base_zip for classification routing |
| active_focus_city | Display city for active focus zone |
| active_focus_state | Display state for active focus zone |
| focus_updated_at | Timestamp when focus zone was last set |
| outreach_time | Time of day for ACE Morning Brief SMS |
| broker_count | TRIGGER-MAINTAINED count of rows in brokers table for this carrier |
| pending_count | TRIGGER-MAINTAINED count of rows in unknown_brokers_inbox for this carrier |

**RLS:** Disabled on carriers table — enforced at application layer.

**NOTE:** `owner_name`, `phone`, `company_name` are required for carrier identity filtering in extract-brokers. Currently null for Ken (pre-onboarding).

### brokers table — current schema (v8.3)

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
| touch_count | Total INBOUND emails FROM this broker to the carrier — NOT outbound |
| last_reply_at | Timestamp of broker's most recent reply |
| notes | Claude relationship summary |
| contact_enabled | Boolean — carrier can toggle off to exclude broker from outreach |

**CRITICAL NOTE on touch_count:** `touch_count` in the brokers table = number of times THIS BROKER has emailed the carrier (INBOUND). It is NOT a count of outbound ACE emails. The KPI box labeled "Broker Touches" on the dashboard is therefore mislabeled — it should read something like "Inbound Contacts" or "Broker Emails Received". Fix required next session.

**RLS:** Enabled on brokers table. Policies: SELECT/INSERT/UPDATE/DELETE scoped to `carrier_id = auth.uid()`.

**Unique constraint:** `(carrier_id, email)` — prevents duplicate rows on re-runs.

### unknown_brokers_inbox table

| Column | Notes |
|--------|-------|
| id | UUID |
| carrier_id | FK → carriers.id |
| sender_email | Email address of unknown sender |
| sender_name | Extracted display name |
| subject | Email subject |
| body_preview | First 200 chars of body |
| received_at | Timestamp |
| touch_count | How many times this sender has emailed the carrier |
| status | cold (default) — only status for pending brokers |

**RLS:** Enabled. SELECT/INSERT/UPDATE/DELETE scoped to `carrier_id = auth.uid()`.

---

## Dashboard — May 5 2026 State

Dashboard is fully live at xtxtec.com/dashboard. Wired to real Supabase data.

### Views

| View | ID | What it shows |
|------|----|---------------|
| Command Center (default) | #view-dashboard | KPI strip + setup checklist + tier card + ACE toggle |
| Brokers in Network | #view-brokers | Full broker table with CRUD |
| Pending Brokers | #view-pending | unknown_brokers_inbox with promote-to-network |

### AuthGate select (on load)

```js
select('subscription_status, subscription_tier, owner_name, company_name, truck_type,
        home_base_city, home_base_state, max_radius, gmail_token, broker_count, pending_count')
```

### Sidebar badge wiring

- Brokers in Network badge → `carrier.broker_count` from carriers row
- Pending Brokers badge → `carrier.pending_count` from carriers row

### KPI IDs and data source

| ID | Label | Source |
|----|-------|--------|
| kpi-brokers | Brokers in Network | broker_count from carrier row |
| kpi-touches | Broker Touches (MISLABELED — fix next session) | SUM(touch_count) from brokers table |
| kpi-replies | Broker Replies | SUM(response_count) from brokers table |
| kpi-wins | Load Wins | SUM(load_count) from brokers table |

### Greeting

`"Good day, <strong>[company_name || owner_name]</strong>"` — no first name, no time-of-day greeting.

### Broker Management view

- Columns: Checkbox / Name / Company / Email / Status / Touches / Contact / Actions
- Sort: ORDER BY company ASC
- Status: plain text labels (Hot / Warm / Cold) — no emoji, no colored pills
- Contact: On / Off indicator, 50% opacity for off rows
- Bulk actions: bulk delete with confirm modal
- Inline edit: inject TR below target row with all fields + contact_enabled checkbox
- Confirm modal: shown for all destructive operations

### Pending Brokers view

- Columns: Checkbox / Company / Email / Touches / Status / Add to Network
- Promote to Network: INSERT brokers + DELETE unknown_brokers_inbox in single op
- Bulk delete with confirm modal

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

---

## Onboarding Flow (Confirmed — 4 Steps as of May 5 2026)

```
1. xtxtec.com landing → inline OTP signup card (home.html)
2. signInWithOtp({ email }) → 8-digit code via Magic Link template (Resend, noreply@xtxtransport.com)
3. verifyOtp(type: 'signup') → Supabase session created → /subscribe
4. /subscribe → tier selection → Stripe checkout
5. Stripe webhook → subscription_status = active in carriers table
6. /onboard → equipment type, home base ZIP, MC#, rate floor (Step 1 of 4)  ← rate floor added here May 5
7. /onboard/lanes → preferred lanes + radius (Step 2 of 4)
8. /onboard/gmail → Gmail OAuth connect + patience sequence (Step 3 of 4)  ← was Step 4; rates page removed May 5
9. /extract-brokers POST → streams NDJSON progress → background scans SENT 180 days → Claude enriches → writes to brokers table
10. Gmail Watch started → ACE live
```

**Removed May 5:** `/onboard/rates` (Step 3 removed — rate floor moved to Step 1 with tooltip)

---

## Pinned: Load Offer Pipeline

Full design logged in session transcript. Build when dashboard prefs wiring is complete.

**What it does:**
- Gmail Watch receives inbound email from broker (known or unknown)
- Claude classifier: does body contain a freight load table? → boolean gate (replaces hardcoded 4-address whitelist)
- Multi-load parser: extracts ALL loads as array (not single object) — equipment, origin, destination, rate, mileage, pickup_date
- Stores individual records in new `load_offers` table (broker_id, carrier_id, equipment, origin, destination, rate, pickup_date)
- Matches each load against THIS carrier's prefs (equipment_type, rate_floor, home_base + max_radius, lanes) → SMS/notification only on match
- Unknown broker who sent load email → auto-add to brokers table (outbound prospecting = warm signal)
- Future: cross-carrier matching — loads that don't match receiving carrier surfaced to other EDGE carriers

**Case study email:** Kirsten Muncy, Accelerated Logistics Inc., MC# 353159, setup@acceleratedlogistics.com — 11 loads, Fort Worth / Louisville / Orlando / Mount Joy origins, 53 Van + Box equipment, $700–$3,500 rates

**Current gap:** `is_load_board_email()` is a 4-address hardcoded whitelist — Kirsten's email falls to unknown sender path, load table is discarded entirely.

**Files to change:** `services/gmail-webhook/main.py` — `LOAD_BOARD_SENDERS`, `is_load_board_email()`, `parse_load_board_email()`, `load_board_matches_carrier()`, `get_carrier_profile()`

---

## Pinned: Chrome Extension — Silent Broker Add

When carrier is viewing an email in Gmail from a broker, a sidebar panel shows:
- Auto-extracted sender: name, company, email, MC# from signature
- Dupe check against brokers table
- One-click "Add to EDGE Network" → inserts to brokers table with carrier_id, status: cold
- Phase 2: surfaces which loads in the email match carrier's lane/equipment prefs

**Why extension over Gmail Add-on:** User preference. More flexible, can also work outside Gmail context.
**No outreach sending involved** — read-only Gmail interaction + Supabase write only.

---

## ACE Morning Brief

Daily SMS sent to carrier at `outreach_time`. Triggered via n8n Cloud Scheduler.

**Content:** Active focus zone + top broker activity summary for the day.

### Active focus behavior

- `active_focus_zip` overrides `home_base_zip` for all classification routing when set
- Resets to `home_base_zip` at midnight if not updated that day
- `focus_updated_at` records when focus was last changed

---

## Build Queue — Next Session Priorities

### 1. Fix KPI "Broker Touches" label (IMMEDIATE)
- `touch_count` on brokers table = INBOUND contacts (broker emailed the carrier)
- Current label "Broker Touches" implies outbound ACE emails — incorrect
- Rename to "Inbound Contacts" or "Broker Emails Received"
- OR repurpose the box — confirm with Ken what KPI makes most sense here

### 2. Dashboard SB Parameters Wiring
- Wire carrier preference fields (rate_floor, lanes, max_radius, equipment_type) to dashboard UI
- Carrier can view and edit them
- These feed the load matching logic

### 3. Load Offer Pipeline (PINNED)
- Replace hardcoded `LOAD_BOARD_SENDERS` with Claude boolean classifier
- Multi-load parser: extract ALL loads as array
- Create `load_offers` table
- Match against carrier prefs → SMS only on match
- See pinned section above for full spec

### 4. Chrome Extension — Silent Broker Add (PINNED)
- See pinned section above for full spec

### 5. Refactor main.py
- Split ~1,650-line monolith into modules: extraction.py, webhook.py, load_board.py, carriers.py, sms.py

### 6. Telnyx SMS
- Wire into main.py, replace Twilio
- Flip SMS_ENABLED=true after confirmed working

### 7. Privacy Policy + Terms pages
- Required for Google OAuth verification

### 8. Welcome email on onboarding_complete

### 9. Broker Management UI — Phase 2
- Wire company/phone/touches to populate from enrichment pipeline
- Outreach tracking

### 10. outreach_log table creation
- carrier_id, broker_id, sent_at, load_origin, load_destination, offered_rate, carrier_response, responded_at

### 11. ACE Outreach Sending
- Compose, send, label routing to "ACE/Outreach" Gmail label

---

## Open Bugs

| Bug | Detail |
|-----|--------|
| KPI "Broker Touches" mislabeled | touch_count = INBOUND broker emails, not outbound ACE emails. Label is wrong. Fix in next session. |
| STRIPE_WEBHOOK_SECRET missing from Cloud Run | Cloud Run logs show 500 on /stripe-webhook. Fix: set env var in Cloud Run. |
| Stripe webhook email match | OTP signups may not have carriers row at webhook time — upsert lookup may fail |

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
- RLS ENABLED on brokers and unknown_brokers_inbox — SELECT/INSERT/UPDATE/DELETE policies scoped to carrier_id = auth.uid()
- deploy.sh auto-sources .env — secrets inject correctly on deploy
- `/extract-brokers` uses NDJSON streaming (not SSE) — Flask `stream_with_context`
- `gmail_service()` must never cache globally — every call builds fresh credentials
- Anthropic client must never be shared across threads — create fresh inside each thread
- SMS_ENABLED=false — do not flip until Telnyx is live and tested
- n8n workflows are ARCHIVED — do not unarchive
- Stripe is in TEST mode — do not flip to live until Ken instructs
- touch_count on brokers table = INBOUND (broker emailed carrier), NOT outbound ACE activity
- broker_count and pending_count on carriers table are trigger-maintained — do not hand-update
- vercel.json has no-cache headers for all .html files — stale dashboard deploy issue resolved May 5

---

## New Machine Setup (Ken — May 4 2026)

Ken moved to a new machine. Setup steps:

```bash
# 1. Clone repo
git clone https://github.com/KenXEdge/edgeai-private.git
cd edgeai-private

# 2. Place .env in services/gmail-webhook/
# (copy from prior machine or Supabase/GCP secrets)

# 3. gcloud auth
gcloud auth login
gcloud config set project edgeai-493115

# 4. Verify active revision
gcloud run services describe edgeai-gmail-webhook --region=us-central1 --format='value(status.traffic)'
```
