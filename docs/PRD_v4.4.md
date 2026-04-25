# XEdge — Product Requirements Document
**Version:** 4.4 | **Date:** April 25, 2026 | **Owner:** Ken Korbel, XTX LLC

---

## 1. Product Overview

**Product Name:** XEdge (spoken: EDGE)
**Agent Name:** ACE — Agentic Carrier Employee
**Company:** XTX LLC
**Domain:** xtxtec.com
**Taglines:** Carriers gain an edge. / First bid wins. / Be the ACE card.

XEdge is a freight carrier automation SaaS that monitors a carrier's Gmail inbox, classifies broker emails using Claude AI, sends SMS alerts on hot leads, and tracks broker relationships — giving small carriers an automated competitive edge without hiring a dispatcher.

---

## 2. Core User

**Primary User:** Owner-operator or small fleet carrier (1–5 trucks)

**Problem:** Brokers send load offers via email all day. Carriers miss hot offers because they're driving, loading, or sleeping. By the time they reply, the load is gone. First bid wins in freight — but carriers are not monitoring email fast enough.

**Solution:** ACE watches their Gmail 24/7, classifies every broker email, and texts them instantly when a load offer matches their lanes and rate floor.

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
  /dashboard         — Main carrier dashboard (React)
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
Telnyx — SMS alerts to carrier (pending — SMS_ENABLED=false)
Stripe — Subscription billing (TEST mode)
Gmail API — Per-carrier OAuth
Google Pub/Sub — Gmail Watch push notifications
```

---

## 4. Supabase Schema

| Table | Purpose |
|-------|---------|
| carriers | One row per carrier. id (UUID), email, gmail_token, subscription_status, subscription_tier, stripe_customer_id, equipment_type, home_base_zip, max_radius |
| brokers | Broker contacts per carrier. carrier_id, email, name, company, status (hot/warm/cold), last_reply_at |
| responses | Every classified email. gmail_message_id, carrier_id, broker_id, classification, load_accepted |
| load_wins | Confirmed won loads |
| unknown_brokers_inbox | Emails from senders not in brokers table — pending review |
| gmail_sync | historyId tracking per email address |

---

## 5. Onboarding Flow

```
1. xtxtec.com landing → click Request Access CTA
2. Inline OTP signup on home.html → signInWithOtp() → 8-digit code emailed
3. User enters code → verifyOtp(type: 'signup') → session created
4. navigate('/subscribe') → tier selection → Stripe checkout
5. Stripe webhook → subscription_status = active in carriers table
6. navigate('/onboard') → equipment type, home base ZIP, MC#
7. /onboard/lanes → preferred lanes
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

**Deduplication:** `is_duplicate()` checks both `responses` and `unknown_brokers_inbox` before any Claude/SMS call. All Pub/Sub deliveries return HTTP 200 — non-200 causes infinite retry.

**Load board intercept:** Emails from DAT, Truckstop, Spot, NTG intercepted before broker lookup — routed to separate SMS path.

---

## 7. Pricing Tiers

| Tier | Price | Stripe Price ID |
|------|-------|-----------------|
| Base | $47/mo | price_1TN2Y5**** |
| Custom | $97/mo | price_1TN2Yh**** |
| Premium | $349 setup fee | price_1TN2dg**** |

CTA copy: **Request Access** (never "Start Free Trial")
Pricing copy: **Month-to-month** (never "No credit card required")

---

## 8. Locked System Values

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

---

## 9. Build Queue — April 25 2026

### Priority 1 — Founder Account Activation (BLOCKER)
- Stripe 100% off coupon OR direct Supabase: `UPDATE carriers SET subscription_status = 'active', subscription_tier = 'base' WHERE id = '<ken_uuid>';`
- Do NOT charge Ken for his own account

### Priority 2 — Test Carrier End-to-End
- Fake carrier account, full flow top to bottom
- Verify: UUID consistent, subscription activates, onboarding completes, Gmail OAuth connects, broker extraction runs, ACE fires SMS
- Confirm each Supabase table gets correct rows

### Priority 3 — Delete Test Carrier Record
- After flow confirmation: delete from carriers, brokers, gmail_sync, responses

### Priority 4 — Ken's Production Onboarding
- Clean UUID, active subscription at $0
- Real broker list loaded via Gmail OAuth extraction
- ACE Base live

### Priority 5 — Email Deliverability
- Custom SMTP in Supabase Auth → noreply@xtxtec.com (not supabase.io)
- Evaluate xtxtransport.com as established sender alias for platform emails

### Priority 6 — Infrastructure
- Telnyx SMS replacement → flip SMS_ENABLED=true when live
- Privacy Policy page (required for Google OAuth verification)
- Terms of Service page (required for Google OAuth verification)
- Google OAuth verification submit
- Stripe flip to live mode before first real carrier payment

---

## 10. Standing Rules

- `CARRIER_UUID` env var in Cloud Run must always match carrier's actual `id` in Supabase — single-carrier limitation; multi-carrier routing is next architecture step
- Gmail Watch expires every 7 days — Cloud Scheduler calls `/renew-watches` weekly
- All Pub/Sub deliveries must return HTTP 200 — non-200 causes infinite retry
- git push to master auto-deploys to Vercel — always get Ken approval first
- Node.js only on dev machine — Python NOT installed
- n8n workflows ARCHIVED — do not unarchive

---

*XEdge PRD v4.4 | XTX LLC | April 25 2026*
