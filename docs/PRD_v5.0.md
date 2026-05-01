# XEdge — Product Requirements Document
**Version:** 5.0 | **Date:** May 1, 2026 | **Owner:** Ken Korbel, XTX LLC

---

## VERSION HISTORY

| Version | Date | Summary |
|---------|------|---------|
| 4.3 | April 23, 2026 | Domain migration xtxtec.com, Stripe webhook, vercel.json fixes, DNS/DKIM |
| 4.4 | April 25, 2026 | OTP fixes, /carrier retired, EDGE/ACE brand locked, SMTP Resend, Gmail OAuth live, Morning Brief designed, ACE Scout designed, Supabase columns added |
| 5.0 | May 1, 2026 | Clean restart after main.py recovery. Active revision 00106-fzh. ACE Morning Brief and ACE Scout fully specced. All build queue items carried forward. |

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

edgeai-gmail-webhook (Google Cloud Run — Python/Flask — revision 00106-fzh)
  /webhook           — Pub/Sub push receiver
  /health            — Health check
  /confirm-win       — Carrier confirms a won load
  /renew-watches     — Weekly Gmail watch renewal
  /extract-brokers   — Scans SENT mail → broker list (SSE stream)
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
| carriers | One row per carrier. Full column list in Runbook. Includes active_focus_zip, active_focus_city, active_focus_state, focus_updated_at, outreach_time |
| brokers | carrier_id, email, name, company, status (hot/warm/cold), last_reply_at |
| responses | gmail_message_id, carrier_id, broker_id, classification, load_accepted |
| load_wins | Confirmed won loads |
| unknown_brokers_inbox | Emails from unknown senders — pending review |
| gmail_sync | historyId tracking per email address |

**RLS:** Disabled on carriers table — enforced at application layer.

---

## 5. Onboarding Flow

```
1. xtxtec.com landing → click Request Access CTA
2. Inline OTP signup on home.html → signInWithOtp({ email }) → 8-digit code
3. verifyOtp(type: 'signup') → session created → /subscribe?first=...&last=...
4. /subscribe → tier selection → Stripe checkout
5. Stripe webhook → subscription_status = active in carriers table
6. /onboard → equipment type, home base ZIP, MC# (step 1)
7. /onboard/lanes → preferred lanes + radius (step 2)
8. /onboard/rates → rate floor local + OTR (step 3)
9. /onboard/gmail → Gmail OAuth connect → gmail_token saved (step 4)
10. /extract-brokers → scans SENT mail → Claude enriches → brokers table
11. Gmail Watch started → ACE live
```

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

## 7. ACE Morning Brief

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

## 8. ACE Scout

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
- Extracted brokers inserted to `brokers` table with status: 'cold'

### Scout module spec

- Runs on Cloud Run as a separate scheduled job or on-demand trigger
- Authenticates to Sylectus using carrier-provided credentials (stored encrypted in carriers table)
- Pages through available load postings — captures load ID, origin, destination, equipment type, broker contact email
- Dedup check: load ID against seen_loads table (carrier_id, load_id, seen_at) — skip if already seen
- Broker contact email: insert to brokers table if not already present (status: 'cold', source: 'ace_scout')
- Outreach: compose initial outreach email via carrier Gmail OAuth — send using gmail.users.messages.send
- Log outreach to responses table (classification: 'outreach_sent')

### Status

Designed — not yet built. Queued for next major build cycle after Telnyx SMS and Morning Brief wiring.

---

## 9. Pricing Tiers

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
- Active focus zone — set via dashboard
- Broker relationship table — hot/warm/cold scoring
- Load board email separation (DAT, Truckstop, Spot, NTG)
- Carrier dashboard — brokers, responses, wins, focus zone
- Broker extraction from SENT mail on onboarding

### Base Plus — two-way SMS loop

All Base features plus:
- Carrier can text ACE to update active focus zone (city/state/ZIP)
- Carrier can text ACE to confirm a won load
- Carrier can text ACE to query top brokers for a zone
- Inbound SMS parsed and routed to correct action

### Dispatcher Pro — multi-carrier dashboard

All Base Plus features plus:
- Dispatcher management view — see all managed carriers in one dashboard
- Per-carrier ACE status, broker counts, load win counts
- Dispatcher can set focus zone for any managed carrier
- Fleet-level analytics — response rates, win rates, broker relationships across carriers

---

## 10. Locked System Values

| Key | Value |
|-----|-------|
| Repo | KenXEdge/edgeai-private |
| Branch | master |
| Cloud Run service | edgeai-gmail-webhook |
| Active revision | 00106-fzh |
| Git restore baseline | 2c4a409 |
| GCP project | edgeai-493115 |
| Pub/Sub topic | projects/edgeai-493115/topics/edgeai-gmail |
| Live Domain | https://xtxtec.com |
| Claude model | claude-haiku-4-5-20251001 |
| Stripe mode | TEST — do not flip to live |
| SMS | DISABLED — SMS_ENABLED=false — Telnyx pending |
| SMTP | Resend — noreply@xtxtransport.com — display: EdgeTech |

---

## 11. Build Queue — May 1 2026

### Priority 1 — Telnyx SMS (BLOCKER)
- Telnyx account setup — wire into main.py, remove Twilio
- Flip SMS_ENABLED=true after confirmed working

### Priority 2 — Broker Extraction Reliability
- Validate `/extract-brokers` against live Gmail SENT
- SSE progress stream + error handling

### Priority 3 — Stripe Webhook Email Match Fix (BUG)
- OTP signup race condition — carriers row may not exist at webhook time
- Fix: upsert on email or delay lookup

### Priority 4 — Carriers Table Schema Audit
- Confirm all new columns in production
- Confirm RLS disabled

### Priority 5 — Dashboard Live Data Wiring
- Wire broker table, sidebar counts, focus zone input from live Supabase

### Priority 6 — Founder Account Activation (BLOCKER)
- Direct SQL: activate Ken's account at $0

### Priority 7 — ACE Morning Brief Wiring
- n8n trigger → Cloud Run or Supabase function
- Inbound SMS parser end-to-end test

### Priority 8 — Infrastructure (Required before public launch)
- Privacy Policy page — required for Google OAuth verification
- Terms of Service page — required for Google OAuth verification
- Google OAuth verification submission
- Stripe flip to live mode before first real carrier payment

---

## 12. Standing Rules

- **RESTORE RULE:** If main.py breaks — restore from `git show 2c4a409:services/gmail-webhook/main.py` before attempting any fix
- Gmail Watch expires every 7 days — Cloud Scheduler calls `/renew-watches` weekly
- All Pub/Sub deliveries must return HTTP 200 — non-200 causes infinite retry
- git push to master auto-deploys to Vercel — always get Ken approval first
- Node.js only on dev machine — Python NOT installed
- n8n: Morning Brief scheduler only — all other workflows ARCHIVED
- `/carrier` route retired — use `/dashboard`
- RLS disabled on carriers table — enforced at application layer
- Stripe in TEST mode — do not flip until Ken instructs

---

*XEdge PRD v5.0 | XTX LLC | May 1 2026*
