# XEdge — Product Requirements Document
**Version:** 5.1 | **Date:** May 4, 2026 | **Owner:** Ken Korbel, XTX LLC

---

## VERSION HISTORY

| Version | Date | Summary |
|---------|------|---------|
| 4.3 | April 23, 2026 | Domain migration xtxtec.com, Stripe webhook, vercel.json fixes, DNS/DKIM |
| 4.4 | April 25, 2026 | OTP fixes, /carrier retired, EDGE/ACE brand locked, SMTP Resend, Gmail OAuth live, Morning Brief designed, ACE Scout designed, Supabase columns added |
| 5.0 | May 1, 2026 | Clean restart after main.py recovery. Active revision 00106-fzh. ACE Morning Brief and ACE Scout fully specced. All build queue items carried forward. |
| 5.1 | May 4, 2026 | Extract-brokers pipeline fully rebuilt: SENT scan, thread-local Anthropic fix, lane capture (origin/destination), touch_count, carrier identity filter, brokers schema cleanup. Best fill rates: company 93%, name 92%, title 78%, phone 53%, lanes ~70%. Load opportunity SMS response loop specced. INBOX supplementary scan queued. Active revision 00134. |

---

## 1. Product Overview

**Platform Name:** EDGE (spoken) — XEdge (product)
**Agent Name:** ACE — Agentic Carrier Employee
**Company:** XTX LLC
**Domain:** xtxtec.com
**Taglines:** Carriers gain an edge. / First bid wins. / Be the ACE card.

EDGE is a freight carrier automation SaaS. ACE monitors a carrier's Gmail inbox, classifies broker emails using Claude AI, sends SMS alerts on hot leads, tracks broker relationships, and proactively briefs the carrier every morning — giving small carriers an automated competitive edge without hiring a dispatcher.

---

## 2. Core User

**Primary User:** Owner-operator or small fleet carrier (1–5 trucks)

**Problem:** Brokers send load offers via email all day. Carriers miss hot offers because they're driving, loading, or sleeping. By the time they reply, the load is gone. First bid wins in freight — but carriers are not monitoring email fast enough.

**Solution:** ACE watches their Gmail 24/7, classifies every broker email, and texts them instantly when a load offer matches their lanes and rate floor. Every morning ACE sends a brief — active focus zone and top broker activity — so the carrier starts the day ahead.

When an inbound load opportunity arrives, ACE sends a one-tap SMS: carrier replies **Pass**, **Book**, or **Call** — and ACE routes the response back to the broker automatically.

---

## 3. System Architecture

```
xtxtec.com (Vercel)
  /                  — Landing page (home.html)
  /auth              — Login / Signup (React, Login.jsx)
  /verify            — Email confirmation gate (verify.html)
  /subscribe         — Tier selection → Stripe checkout
  /onboard           — Carrier profile setup (step 1)
  /onboard/lanes     — Lane preferences (step 2)
  /onboard/rates     — Rate floors (step 3)
  /onboard/gmail     — Gmail OAuth connect (step 4) — live
  /dashboard         — Main carrier dashboard (/carrier retired)
  /api/stripe-webhook       — Stripe event handler
  /api/create-checkout-session — Stripe session creator

edgeai-gmail-webhook (Google Cloud Run — Python/Flask — revision 00134)
  /webhook           — Pub/Sub push receiver
  /health            — Health check
  /confirm-win       — Carrier confirms a won load
  /renew-watches     — Weekly Gmail watch renewal
  /extract-brokers   — POST {carrier_id} → NDJSON stream → scans SENT 180 days → Claude enriches → brokers table
  /import-brokers    — Manual broker import

Supabase (Postgres)
Claude Haiku — Email classification + broker enrichment
Telnyx — SMS alerts (SMS_ENABLED=false — pending setup)
Stripe — Subscription billing (TEST mode)
Gmail API — Per-carrier OAuth
Google Pub/Sub — Gmail Watch push notifications
Resend — Transactional email (noreply@xtxtransport.com, display: EdgeTech)
n8n (Cloud) — ACE Morning Brief scheduler
```

---

## 4. Supabase Schema

| Table | Purpose |
|-------|---------|
| carriers | One row per carrier. Full column list in Runbook. Includes owner_name, phone, company_name (identity filter), active_focus_zip/city/state, focus_updated_at, outreach_time |
| brokers | Per-carrier broker contacts — see full schema below |
| responses | gmail_message_id, carrier_id, broker_id, classification, load_accepted |
| load_wins | Confirmed won loads |
| unknown_brokers_inbox | Emails from unknown senders — pending review |
| gmail_sync | historyId tracking per email address |

### brokers table — current schema

| Column | Type | Source |
|--------|------|--------|
| id | UUID | auto |
| carrier_id | UUID | FK → carriers.id |
| email | text | SENT To: header |
| name | text | Claude from signature |
| title | varchar(25) | Claude from signature |
| company | text | Claude from signature or sent context |
| phone | text | Claude from signature — mobile only |
| status | text | hot / warm / cold (default: warm) |
| priority | text | high / medium / low (default: medium) |
| days_cadence | integer | Outreach cadence (default: 3) |
| last_contacted | timestamptz | Date header of most recent SENT email |
| last_load_origin | text | City ST — Claude from bid email |
| last_load_destination | text | City ST — Claude from bid email |
| touch_count | integer | Total SENT emails to this broker |
| last_reply_at | timestamptz | Most recent inbound from broker |
| notes | text | Claude relationship summary |

**Removed:** `city`, `state` (dropped — ambiguous and redundant with company data)
**Unique constraint needed:** `(carrier_id, email)` — prevents duplicate rows on re-runs

**RLS:** Disabled on carriers table — enforced at application layer.

---

## 5. Onboarding Flow

```
1. xtxtec.com landing → click Request Access CTA
2. Inline OTP signup on home.html → signInWithOtp({ email }) → 8-digit code
3. verifyOtp(type: 'signup') → session created → /subscribe?first=...&last=...
4. /subscribe → tier selection → Stripe checkout
5. Stripe webhook → subscription_status = active in carriers table
6. /onboard → equipment type, home base ZIP, MC#, owner_name, phone, company_name (step 1)
7. /onboard/lanes → preferred lanes + radius (step 2)
8. /onboard/rates → rate floor local + OTR (step 3)
9. /onboard/gmail → Gmail OAuth connect → gmail_token saved (step 4)
10. /extract-brokers → NDJSON stream → scans SENT 180 days → Claude enriches → brokers table
11. Gmail Watch started → ACE live
```

**Required onboarding additions (not yet built):**
- `owner_name` — required — feeds carrier identity filter in extract-brokers
- `phone` — required — feeds phone exclusion filter in extract-brokers
- `company_name` — required — feeds company exclusion filter in extract-brokers

---

## 6. Email Classification

Claude Haiku classifies every inbound broker email:

| Classification | Description |
|----------------|-------------|
| load_offer | Broker is offering a specific load |
| positive | Interested in working together, no specific load yet |
| negative | Not interested, no load available |
| question | Broker is asking a question |
| unknown | Cannot determine intent |

**SMS fires on:** `load_offer` only (when SMS_ENABLED=true)

**Routing:** Uses `active_focus_zip` when set on carrier row — falls back to `home_base_zip`. Resets at midnight.

**Deduplication:** `is_duplicate()` checks `responses` and `unknown_brokers_inbox` before any Claude/SMS call. All Pub/Sub deliveries return HTTP 200.

**Load board intercept:** DAT, Truckstop, Spot, NTG intercepted before broker lookup — separate SMS path.

---

## 7. Load Opportunity SMS Response Loop

**Status:** Specced. SMS_ENABLED=false. Telnyx not yet set up.

This is the core real-time value loop — the feature that differentiates EDGE from a simple alert system.

### Flow

```
Inbound load offer (email or classified load_offer)
  → ACE sends SMS to carrier:
      "Load offer: [origin] → [dest] | Rate: $X | Pickup: [date] | Miles: X | Broker: [name]
       Reply: Pass / Book / Call"
  → Carrier replies via SMS: Pass, Book, or Call
  → Telnyx inbound webhook → EDGE receives reply
  → EDGE routes action:
      Pass  → log to outreach_log, status=passed
      Book  → auto-email to broker: "We'll take it. MC#XXXXX calling shortly."
      Call  → log to outreach_log, status=call_needed (no auto-email — carrier calls manually)
```

### Requirements

- Telnyx account + dedicated number
- Inbound Telnyx webhook wired to Cloud Run `/telnyx-inbound`
- `outreach_log` table: carrier_id, broker_id, load_origin, load_destination, offered_rate, pickup_date, miles, carrier_response, responded_at, auto_email_sent
- SMS message must fit in 160 chars — abbreviate as needed
- Response parsing: case-insensitive, trim whitespace, accept "pass"/"p", "book"/"b", "call"/"c"

---

## 8. Extract-Brokers Pipeline

### What it does

Scans the carrier's Gmail SENT folder (180 days), identifies all broker contacts the carrier has emailed, enriches each with Claude Haiku, and writes clean records to the brokers table. This builds the carrier's relationship graph from day one.

### Data sources per broker

| Source | What's extracted |
|--------|-----------------|
| SENT To: header | Email address, broker name hint |
| SENT Date: header | last_contacted, touch_count |
| SENT email body (first 30 lines) | Lane context: origin, destination (what load they bid on) |
| INBOX reply from broker (last 20 lines) | Signature: name, title, company, mobile phone |

### Claude Haiku prompt (unified)

Extracts: `{name, title, company, phone, origin, destination}`

Rules:
- name/title/company/phone: from broker signature block
- origin/destination: freight lane from either source — format "City ST"
- Phone: mobile/cell only — null for office/direct/desk/ext/800
- Title: max 25 chars — truncate if longer
- Return valid JSON only

### Carrier identity filter

Prevents carrier's own info from contaminating broker records. Dynamic per carrier_id.

**Primary:** `owner_name`, `phone`, `company_name` from carriers table
**Fallback:** email domain → strip freight suffixes → unique brand token (e.g. `xtxtransport.com` → `xtx`)

### Fill rates (revision 00128 — best achieved)

| Field | Fill Rate |
|-------|-----------|
| company | 93% |
| name | 92% |
| title | 78% |
| origin | 71% |
| destination | 69% |
| phone | 53% |
| last_contacted | 100% |
| touch_count | 100% |

Phone ceiling ~53% is near realistic maximum — ~50% of brokers have no INBOX reply so no signature data; mobile-only rule excludes the rest.

---

## 9. ACE Morning Brief

Daily SMS sent to carrier at `outreach_time`. Triggered via n8n Cloud Scheduler.

**Content:** Active focus zone + top broker activity for the day.

### Input paths — setting active focus zone

| Path | Mechanism |
|------|-----------|
| SMS | Carrier texts city, state, or ZIP → inbound SMS parser → updates active_focus_zip/city/state |
| Dashboard | Focus zone input on dashboard.html → PATCH carriers table |

### Active focus behavior

| Rule | Detail |
|------|--------|
| Override | `active_focus_zip` overrides `home_base_zip` for classification routing |
| Reset | Resets to `home_base_zip` at midnight if not updated |
| Timestamp | `focus_updated_at` records last change |
| Fallback | Classification uses `home_base_zip` when `active_focus_zip` is null |

### Morning Brief feature spec

- Triggered by n8n Cloud Scheduler at carrier's `outreach_time`
- Reads `active_focus_zip` / `active_focus_city` / `active_focus_state` from carriers table
- Queries `responses` table for last 24h broker activity for this carrier
- Composes SMS: focus zone + count of load_offers + count of positive replies + top broker names
- Sends via Telnyx to carrier's registered phone number
- Inbound reply (city/state/ZIP) parsed and written back to carrier row via webhook

---

## 10. ACE Scout

Browser automation module for Sylectus load board. Supplements inbound email monitoring with proactive load board scraping.

### Capabilities

| Feature | Description |
|---------|-------------|
| Session persistence | Logs in to Sylectus once, maintains session across runs |
| Load deduplication | Tracks seen load IDs in Supabase — no reprocessing |
| Broker email extraction | Scrapes contact emails from load postings |
| Outreach via carrier Gmail | Uses carrier's connected OAuth token to send initial outreach to extracted brokers |

### Constraints

- Outreach must use carrier's own Gmail OAuth token — never platform address
- Deduplication store must persist across runs
- Session must refresh gracefully on timeout
- Extracted brokers inserted to `brokers` table with status: 'cold', source: 'ace_scout'

### Status

Designed — not yet built. Queued for next major build cycle after Telnyx SMS and Morning Brief wiring.

---

## 11. Pricing Tiers

| Tier | Price | What's Included |
|------|-------|-----------------|
| Base | $47/mo | ACE email monitoring, SMS alerts on load_offer, broker tracking, Morning Brief, dashboard |
| Base Plus | $97/mo | Base + two-way SMS loop (carrier can reply to ACE via SMS to update focus zone, confirm wins, query brokers) |
| Dispatcher Pro | $297/mo | Base Plus + multi-carrier dashboard, dispatcher management view, carrier fleet oversight |

CTA copy: **Request Access** (never "Start Free Trial")
Pricing copy: **Month-to-month** (never "No credit card required")

### Base tier — finalized feature set

- Gmail inbox monitoring 24/7 via Pub/Sub
- Claude Haiku classification — load_offer / positive / negative / question / unknown
- SMS alert on load_offer (Telnyx)
- ACE Morning Brief SMS at outreach_time
- Active focus zone — set via dashboard or SMS
- Broker relationship table — hot/warm/cold scoring, touch_count, lane history
- Load board email separation (DAT, Truckstop, Spot, NTG)
- Carrier dashboard — brokers, responses, wins, focus zone
- Broker extraction from SENT mail on onboarding

### Base Plus — two-way SMS loop

All Base features plus:
- Carrier can text ACE to update active focus zone (city/state/ZIP)
- Carrier can text ACE to confirm a won load
- Carrier can text ACE to query top brokers for a zone
- Load opportunity Pass/Book/Call response loop
- Inbound SMS parsed and routed to correct action

### Dispatcher Pro — multi-carrier dashboard

All Base Plus features plus:
- Dispatcher management view — see all managed carriers in one dashboard
- Per-carrier ACE status, broker counts, load win counts
- Dispatcher can set focus zone for any managed carrier
- Fleet-level analytics — response rates, win rates, broker relationships across carriers

---

## 12. Locked System Values

| Key | Value |
|-----|-------|
| Repo | KenXEdge/edgeai-private |
| Branch | master |
| Cloud Run service | edgeai-gmail-webhook |
| Active revision | 00134 |
| Best extract-brokers revision | 00128 |
| Stable fallback revision | 00107-hk2 |
| Latest master commit | 9075c8e |
| GCP project | edgeai-493115 |
| Pub/Sub topic | projects/edgeai-493115/topics/edgeai-gmail |
| Live Domain | https://xtxtec.com |
| Claude model | claude-haiku-4-5-20251001 |
| Stripe mode | TEST — do not flip to live |
| SMS | DISABLED — SMS_ENABLED=false — Telnyx pending |
| SMTP | Resend — noreply@xtxtransport.com — display: EdgeTech |

---

## 13. Build Queue — May 4 2026

### Priority 1 — Re-run /extract-brokers (IMMEDIATE)
- Brokers table is empty — 00134 run incomplete
- Run from dashboard once gcloud auth set up on new machine
- Apply unique constraint first: `ALTER TABLE brokers ADD CONSTRAINT brokers_carrier_email_unique UNIQUE (carrier_id, email);`

### Priority 2 — Telnyx SMS (BLOCKER for live value)
- Telnyx account setup — wire into main.py, remove Twilio
- Flip SMS_ENABLED=true after confirmed working

### Priority 3 — Supplementary INBOX Scan
- Separate pass: scan INBOX for emails FROM addresses not yet in brokers table
- Capture anonymous inbound load offers carrier never replied to
- Insert with status='cold', source='inbox_scan'

### Priority 4 — Stripe Webhook Fix (BUG)
- OTP signup race condition — carriers row may not exist at webhook time
- Fix: upsert on email or delay lookup
- File: `dashboard/api/stripe-webhook.js`

### Priority 5 — Onboarding — Required Fields
- Add `owner_name`, `phone`, `company_name` as required fields on /onboard step 1
- Power carrier identity filter for all carriers (not just Ken)

### Priority 6 — Founder Account Activation (BLOCKER)
- Direct SQL to activate Ken at $0 — no Stripe

### Priority 7 — Dashboard Live Data Wiring
- Wire broker table, sidebar counts, focus zone input from live Supabase
- ACE status dot from subscription_status

### Priority 8 — outreach_log Table
- carrier_id, broker_id, load_origin, load_destination, offered_rate, pickup_date, miles, carrier_response, responded_at, auto_email_sent
- Required for SMS load opportunity response loop

### Priority 9 — ACE Morning Brief Wiring
- n8n trigger → Cloud Run endpoint or Supabase function
- Inbound SMS parser end-to-end test

### Priority 10 — Infrastructure (Required before public launch)
- Privacy Policy page — required for Google OAuth verification
- Terms of Service page — required for Google OAuth verification
- Google OAuth verification submission
- Stripe flip to live mode before first real carrier payment

---

## 14. Standing Rules

- **RESTORE RULE:** If main.py breaks — restore from `git show 2c4a409:services/gmail-webhook/main.py` before attempting any fix
- Gmail Watch expires every 7 days — Cloud Scheduler calls `/renew-watches` weekly
- All Pub/Sub deliveries must return HTTP 200 — non-200 causes infinite retry
- git push to master auto-deploys to Vercel — always get Ken approval first
- Node.js only on dev machine — Python NOT installed
- n8n: Morning Brief scheduler only — all other workflows ARCHIVED
- `/carrier` route retired — use `/dashboard`
- RLS disabled on carriers table — enforced at application layer
- Stripe in TEST mode — do not flip until Ken instructs
- SMS_ENABLED=false — Telnyx pending — do not flip
- `gmail_service()` must never cache globally — every call builds fresh
- Anthropic client must never be shared across threads — create fresh per thread

---

*XEdge PRD v5.1 | XTX LLC | May 4 2026*
