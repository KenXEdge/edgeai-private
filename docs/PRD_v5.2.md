# XEdge — Product Requirements Document
**Version:** 5.2 | **Date:** May 5, 2026 | **Owner:** Ken Korbel, XTX LLC

---

## VERSION HISTORY

| Version | Date | Summary |
|---------|------|---------|
| 4.3 | April 23, 2026 | Domain migration xtxtec.com, Stripe webhook, vercel.json fixes, DNS/DKIM |
| 4.4 | April 25, 2026 | OTP fixes, /carrier retired, EDGE/ACE brand locked, SMTP Resend, Gmail OAuth live, Morning Brief designed, ACE Scout designed, Supabase columns added |
| 5.0 | May 1, 2026 | Clean restart after main.py recovery. Active revision 00106-fzh. ACE Morning Brief and ACE Scout fully specced. All build queue items carried forward. |
| 5.1 | May 4, 2026 | Extract-brokers pipeline fully rebuilt: SENT scan, thread-local Anthropic fix, lane capture (origin/destination), touch_count, carrier identity filter, brokers schema cleanup. Best fill rates: company 93%, name 92%, title 78%, phone 53%, lanes ~70%. Load opportunity SMS response loop specced. Active revision 00134. |
| 5.2 | May 5, 2026 | Dashboard wired to live Supabase data. Broker + Pending Broker management views built with full CRUD. RLS fixed on brokers + unknown_brokers_inbox. contact_enabled added to brokers. Onboarding reduced to 4 steps (rates page removed, rate floor on Step 1). Load Offer Pipeline and Chrome Extension pinned. KPI Broker Touches label is INCORRECT — fix next session (touch_count = INBOUND, not outbound). |

---

## 1. Product Overview

**Platform Name:** EDGE (spoken) — XEdge (product)
**Agent Name:** ACE — Agentic Carrier Employee
**Company:** XTX LLC
**Domain:** xtxtec.com
**Taglines:** Carriers gain an edge. / First bid wins. / Be the ACE card.
**CTA:** Request Access — never "Start Free Trial"
**Pricing copy:** Month-to-month — never "No credit card required"
**Footer:** © 2026 XTX LLC · All rights reserved · xedge-ai.com

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
  /onboard           — Step 1: truck info + rate floor
  /onboard/lanes     — Step 2: lane preferences
  /onboard/gmail     — Step 3: Gmail OAuth connect + patience sequence
  /dashboard         — Main carrier dashboard (live as of May 5)
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
| carriers | One row per carrier. Includes owner_name, phone, company_name (identity filter), active_focus_zip/city/state, focus_updated_at, outreach_time, broker_count (trigger), pending_count (trigger) |
| brokers | Per-carrier broker contacts — see full schema below |
| responses | gmail_message_id, carrier_id, broker_id, classification, load_accepted |
| load_wins | Confirmed won loads |
| unknown_brokers_inbox | Emails from unknown senders — shown as Pending Brokers in dashboard |
| gmail_sync | historyId tracking per email address |

### brokers table — current schema (v5.2)

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | auto |
| carrier_id | UUID | FK → carriers.id |
| email | text | broker email |
| name | text | Claude from signature |
| title | varchar(25) | Claude from signature |
| company | text | Claude from signature or sent context |
| phone | text | mobile only |
| status | text | hot / warm / cold |
| priority | text | high / medium / low |
| days_cadence | integer | outreach cadence (default: 3) |
| last_contacted | timestamptz | Date header of most recent SENT email |
| last_load_origin | text | City ST — from bid email |
| last_load_destination | text | City ST — from bid email |
| touch_count | integer | INBOUND emails FROM broker TO carrier (NOT outbound) |
| last_reply_at | timestamptz | most recent inbound from broker |
| notes | text | Claude relationship summary |
| contact_enabled | boolean | carrier toggle — exclude from outreach if false |

**CRITICAL:** `touch_count` = times broker emailed the carrier (INBOUND). NOT outbound ACE activity.

**RLS:** Enabled. SELECT/INSERT/UPDATE/DELETE policies scoped to `carrier_id = auth.uid()`.

**Unique constraint:** `(carrier_id, email)` — prevents duplicate rows on re-runs.

---

## 5. Onboarding Flow (4 Steps — as of May 5 2026)

```
1. xtxtec.com landing → click Request Access CTA
2. Inline OTP signup on home.html → signInWithOtp({ email }) → 8-digit code
3. verifyOtp(type: 'signup') → session created → /subscribe
4. /subscribe → tier selection → Stripe checkout
5. Stripe webhook → subscription_status = active in carriers table
6. /onboard → equipment type, home base ZIP, MC#, owner_name, phone, company_name, rate floor (step 1 of 4)
7. /onboard/lanes → preferred lanes + radius (step 2 of 4)
8. /onboard/gmail → Gmail OAuth connect + patience sequence (step 3 of 4)
9. /extract-brokers → NDJSON stream → scans SENT 180 days → Claude enriches → brokers table
10. Gmail Watch started → ACE live
```

**Removed May 5:** `/onboard/rates` (step 3 was a separate rates page — rate floor moved to step 1 with tooltip)

---

## 6. Dashboard — Live (May 5 2026)

### Views

| View | Trigger | Content |
|------|---------|---------|
| Command Center | Default on load | KPI strip, setup checklist, tier card, ACE toggle |
| Brokers in Network | Sidebar nav | Full broker table — CRUD, inline edit, bulk delete, sort by company |
| Pending Brokers | Sidebar nav | unknown_brokers_inbox — promote to network, bulk delete |

### KPI Strip

| Box | Source | Label (current) | Status |
|-----|--------|-----------------|--------|
| Brokers in Network | broker_count from carrier row | Brokers in Network | CORRECT |
| Broker Touches | SUM(touch_count) from brokers | Broker Touches | MISLABELED — see open bug |
| Broker Replies | SUM(response_count) from brokers | Broker Replies | CORRECT |
| Load Wins | SUM(load_count) from brokers | Load Wins | CORRECT |

### Broker Management Features

- Inline edit row with all fields + contact_enabled checkbox
- Status: plain text Hot / Warm / Cold (no emoji, no colored pills)
- Bulk delete with confirmation modal
- Sort: ORDER BY company ASC
- contact_enabled: On/Off display, 50% opacity for off rows

---

## 7. Email Classification

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

**Deduplication:** `is_duplicate()` checks `responses` and `unknown_brokers_inbox` before any Claude/SMS call.

**Load board intercept:** DAT, Truckstop, Spot, NTG intercepted before broker lookup — separate SMS path.

---

## 8. Load Opportunity SMS Response Loop

**Status:** Specced. SMS_ENABLED=false. Telnyx not yet set up.

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

---

## 9. Load Offer Pipeline (PINNED — Next Build After Dashboard Prefs)

**Status:** Designed. Not yet built.

### What it solves

`is_load_board_email()` is a 4-address hardcoded whitelist (DAT, Spot, NTG, Truckstop). Any broker sending a load list email (like Kirsten Muncy at Accelerated Logistics — 11 loads, $700–$3,500 rates) falls to the unknown sender path and the load table is completely discarded.

### Design

- Claude boolean classifier: "does this email body contain a freight load table?" → gate decision
- Multi-load parser: extract ALL loads as array — equipment, origin, destination, rate, mileage, pickup_date
- `load_offers` table: broker_id, carrier_id, equipment, origin, destination, rate, pickup_date
- Match each load against carrier prefs (equipment_type, rate_floor, home_base + max_radius, lanes)
- SMS/notification only on match
- Unknown broker who sent a load email → auto-add to brokers table (warm signal)
- Future: cross-carrier matching — unmatched loads surfaced to other EDGE carriers

**Files to change:** `services/gmail-webhook/main.py`

---

## 10. Chrome Extension — Silent Broker Add (PINNED)

**Status:** Designed. Not yet built.

When carrier views a broker email in Gmail, a sidebar panel shows:
- Auto-extracted sender: name, company, email, MC# from signature
- Dupe check against brokers table
- One-click "Add to EDGE Network" → inserts to brokers table with carrier_id, status: cold

Phase 2: surfaces which loads in the email match carrier's lane/equipment prefs.

**Why extension over Gmail Add-on:** User preference. More flexible.
**Scope:** Read-only Gmail interaction + Supabase write only. No outreach sending.

---

## 11. Extract-Brokers Pipeline

### What it does

Scans carrier's Gmail SENT folder (180 days), identifies all broker contacts, enriches each with Claude Haiku, writes to brokers table. Builds the carrier's relationship graph from day one.

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

---

## 12. ACE Morning Brief

Daily SMS at `outreach_time`. Triggered via n8n Cloud Scheduler.

**Content:** Active focus zone + top broker activity for the day.

**Status:** Designed — n8n scheduler built. SMS pipeline not yet wired (Telnyx pending).

---

## 13. ACE Scout

Browser automation for Sylectus load board.

**Status:** Designed — not yet built.

---

## 14. Product Tiers

| Tier | Price | Features |
|------|-------|---------|
| Base | Month-to-month | Gmail Watch, broker tracking, load offer alerts |
| Base Plus | Month-to-month | All Base + ACE Morning Brief + priority SMS |
| Dispatcher Pro | Month-to-month + setup fee | All Base Plus + ACE Scout + dedicated onboarding |

**Stripe:** TEST mode. Do not flip to live until Ken instructs.

---

## 15. Open Items

| Item | Priority | Notes |
|------|----------|-------|
| Fix KPI "Broker Touches" label | IMMEDIATE | touch_count = INBOUND — label is wrong |
| Dashboard SB parameters wiring | High | rate_floor, lanes, max_radius, equipment_type editable on dashboard |
| Load Offer Pipeline | High | See pinned section |
| Chrome Extension | High | See pinned section |
| Refactor main.py | Medium | Split ~1,650-line monolith |
| Telnyx SMS | Medium | Replace Twilio, flip SMS_ENABLED=true |
| Privacy Policy + Terms | Medium | Required for Google OAuth verification |
| Welcome email | Low | On onboarding_complete |
| outreach_log table | Low | Required for SMS response loop |
| ACE Outreach Sending | Low | Compose + send + "ACE/Outreach" Gmail label |
