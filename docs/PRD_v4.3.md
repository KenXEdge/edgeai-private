# XEdge — Product Requirements Document
**Version:** 4.4 | **Date:** April 25, 2026 | **Owner:** Ken Korbel, XTX LLC

---

## 1. Product Overview

**Platform Name:** EDGE (spoken) — XEdge (product)
**Agent Name:** ACE — Agentic Carrier Employee
**Company:** XTX LLC
**Domain:** xtxtec.com
**Taglines:** Carriers gain an edge. / First bid wins. / Be the ACE card.

XEdge is a freight carrier automation SaaS that monitors a carrier's Gmail inbox, classifies broker emails using Claude AI, sends SMS alerts on hot leads, and tracks broker relationships — giving small carriers an automated competitive edge without hiring a dispatcher.

---

## 2. Core User

**Primary User:** Owner-operator or small fleet carrier (1–5 trucks)

**Problem:** Brokers send load offers via email all day. Carriers miss hot offers because they're driving, loading, or sleeping. By the time they reply, the load is gone. First bid wins in freight — but carriers are not monitoring email fast enough.

**Solution:** ACE watches their Gmail 24/7, classifies every broker email, and texts them instantly when a load offer matches their lanes and rate floor. Every morning, ACE also sends a brief — active focus zone, broker activity, day setup — so the carrier starts the day ahead.

---

## 3. System Architecture

```
xtxtec.com (Vercel)
  /                  — Landing page (home.html)
  /auth              — Login / Signup (React, Login.jsx)
  /verify            — Email confirmation gate (verify.html)
  /subscribe         — Tier selection → Stripe checkout
  /onboard           — Carrier profile setup (4 steps)
  /onboard/lanes     — Lane preferences
  /onboard/rates     — Rate floors
  /onboard/gmail     — Gmail OAuth connect
  /dashboard         — Main carrier dashboard (/carrier retired)
  /api/stripe-webhook       — Stripe event handler
  /api/create-checkout-session — Stripe session creator

edgeai-gmail-webhook (Google Cloud Run — Python/Flask)
  /webhook           — Pub/Sub push receiver
  /health            — Health check
  /confirm-win       — Carrier confirms a won load
  /renew-watches     — Weekly Gmail watch renewal
  /extract-brokers   — Scans SENT mail → broker list
  /import-brokers    — Manual broker import
  /create-checkout-session — Stripe checkout (legacy backend route)
  /stripe-webhook    — Stripe event handler (legacy backend route)

Supabase (Postgres)
Claude Haiku — Email classification + broker enrichment
Telnyx — SMS alerts to carrier (SMS_ENABLED=false — pending setup)
Stripe — Subscription billing (TEST mode)
Gmail API — Per-carrier OAuth
Google Pub/Sub — Gmail Watch push notifications
Resend — Transactional email via xtxtransport.com
n8n — Morning Brief scheduler (Cloud)
```

---

## 4. Supabase Schema

| Table | Purpose |
|-------|---------|
| carriers | One row per carrier. id (UUID), email, gmail_token, subscription_status, subscription_tier, stripe_customer_id, equipment_type, home_base_zip, max_radius, active_focus_zip, active_focus_city, active_focus_state, focus_updated_at, outreach_time |
| brokers | Broker contacts per carrier. carrier_id, email, name, company, status (hot/warm/cold), last_reply_at |
| responses | Every classified email. gmail_message_id, carrier_id, broker_id, classification, load_accepted |
| load_wins | Confirmed won loads |
| unknown_brokers_inbox | Emails from senders not in brokers table — pending review |
| gmail_sync | historyId tracking per email address |

---

## 5. Onboarding Flow

```
1. xtxtec.com landing → click Request Access CTA
2. Inline OTP signup card → signInWithOtp({ email }) → 8-digit code
3. verifyOtp() → Supabase session → /subscribe?first=...&last=...
4. /subscribe → tier selection → Stripe checkout
5. Stripe webhook → subscription_status = active in carriers table
6. /onboard → equipment type, home base ZIP, MC#
7. /onboard/lanes → preferred lanes + radius
8. /onboard/rates → rate floor (local + OTR)
9. /onboard/gmail → Gmail OAuth connect → gmail_token saved
10. /extract-brokers → scans SENT mail → Claude enriches → brokers table populated
11. Gmail Watch started → ACE goes live
```

---

## 6. Email Classification

Claude Haiku classifies every inbound broker email as one of:

| Classification | Description |
|----------------|-------------|
| load_offer | Broker is offering a specific load |
| positive | Interested in working together, no specific load yet |
| negative | Not interested, no load available |
| question | Broker is asking a question |
| unknown | Cannot determine intent |

**SMS fires on:** `load_offer` only (when SMS_ENABLED=true)

**Routing:** Classification filter uses `active_focus_zip` when set on carrier row — falls back to `home_base_zip`. Active focus zone resets to home base at midnight.

**Deduplication:** `is_duplicate()` checks both `responses` and `unknown_brokers_inbox` before any Claude/SMS call. All Pub/Sub deliveries return HTTP 200 — non-200 causes infinite retry.

**Load board intercept:** Emails from DAT, Truckstop, Spot, NTG intercepted before broker lookup — routed to separate SMS path.

---

## 7. ACE Morning Brief

Daily SMS sent to carrier at their configured `outreach_time`. Triggered via n8n Cloud Scheduler.

**Content:** Active focus zone + broker activity summary for the day.

### Input Paths — Setting Active Focus Zone

| Path | Mechanism |
|------|-----------|
| SMS | Carrier texts a city, state, or ZIP → inbound SMS parser extracts location → updates carrier row |
| Dashboard | Focus zone input field on dashboard.html → PATCH to carriers table |

### Active Focus Behavior

- `active_focus_zip` overrides `home_base_zip` for all classification routing when set
- Resets to `home_base_zip` at midnight if not updated that day
- `focus_updated_at` records when focus was last changed

### carriers table columns for Morning Brief

| Column | Type | Purpose |
|--------|------|---------|
| active_focus_zip | text | Current focus ZIP — overrides home_base_zip |
| active_focus_city | text | Display city |
| active_focus_state | text | Display state |
| focus_updated_at | timestamptz | Last focus update timestamp |
| outreach_time | time | Time of day to send Morning Brief SMS |

---

## 8. Pricing Tiers

| Tier | Price | What's Included | Stripe Price ID |
|------|-------|-----------------|-----------------|
| Base | $47/mo | ACE email monitoring, SMS alerts, broker tracking, Morning Brief | price_1TN2Y5**** |
| Custom | $97/mo | Base + custom lane rules, priority SMS, extended broker history | price_1TN2Yh**** |
| Premium | $349 setup fee | Custom + white-glove setup, dedicated onboarding, custom reporting | price_1TN2dg**** |

CTA copy: **Request Access** (never "Start Free Trial")
Pricing copy: **Month-to-month** (never "No credit card required")

---

## 9. Locked System Values

| Key | Value |
|-----|-------|
| Repo | KenXEdge/edgeai-private |
| Branch | master |
| Cloud Run service | edgeai-gmail-webhook |
| Active revision | 00071-hj8 |
| GCP project | edgeai-493115 |
| Pub/Sub topic | projects/edgeai-493115/topics/edgeai-gmail |
| Live Domain | https://xtxtec.com |
| Claude model | claude-haiku-4-5-20251001 |
| Stripe mode | TEST — do not flip to live |
| SMS | DISABLED — SMS_ENABLED=false — Telnyx pending |
| SMTP | Resend — xtxtransport.com sender domain |

---

## 10. Build Queue — April 25 2026

### Priority 1 — Telnyx SMS (BLOCKER)
- Telnyx account setup — flip SMS_ENABLED=true when live and tested
- Remove all Twilio references from main.py

### Priority 2 — Broker Extraction Reliability
- Validate `/extract-brokers` against live Gmail
- Error handling, retry, SSE progress stream
- Verify brokers table correct for Ken's account

### Priority 3 — Stripe Webhook Email Match Fix
- Verify carrier lookup in stripe-webhook.js matches on email correctly

### Priority 4 — Carriers Table Schema Audit
- Confirm all new columns in production
- Confirm RLS status

### Priority 5 — Dashboard Live Data Wiring
- Wire broker table, sidebar counts, focus zone input from live Supabase

### Priority 6 — Founder Account Activation (BLOCKER)
- Direct Supabase SQL to activate Ken's account at $0
- Do NOT charge Ken

### Priority 7 — Email Deliverability
- Supabase Auth SMTP → Resend → noreply@xtxtec.com

### Priority 8 — Infrastructure
- Privacy Policy page (required for Google OAuth verification)
- Terms of Service page (required for Google OAuth verification)
- Google OAuth verification submit
- Stripe flip to live mode before first real carrier payment

---

## 11. Standing Rules

- Gmail Watch expires every 7 days — Cloud Scheduler calls `/renew-watches` weekly
- All Pub/Sub deliveries must return HTTP 200 — non-200 causes infinite retry
- git push to master auto-deploys to Vercel — always get Ken approval first
- Node.js only on dev machine — Python NOT installed
- n8n workflows — only Morning Brief scheduler is active; all others ARCHIVED
- `/carrier` route retired — use `/dashboard`
- RLS disabled on carriers table — enforced at application layer

---

*XEdge PRD v4.4 | XTX LLC | April 25 2026*
