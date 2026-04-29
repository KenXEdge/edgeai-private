# EDGEai — Master Context Note (Runbook)
**Version:** 7.1 | **Date:** April 26, 2026 | Paste-ready for next session

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
4. Fires Twilio/Telnyx SMS alerts to the carrier on hot leads
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
| Active revision | 00072-c58 |
| GCP project | edgeai-493115 |
| Pub/Sub topic | projects/edgeai-493115/topics/edgeai-gmail |
| Live Domain | https://xtxtec.com |
| Dashboard URL | https://xtxtec.com |
| CORS origin | https://xtxtec.com |
| Stripe price — Base | price_1TN2Y5**** |
| Stripe price — Custom | price_1TN2Yh**** |
| Stripe price — Premium (setup fee) | price_1TN2dg**** |
| Claude model (classify) | claude-haiku-4-5-20251001 |
| Supabase | siafwhlzazefyoevslde.supabase.co |
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
  /dashboard         — Main carrier dashboard (dashboard.html)
  /api/stripe-webhook — Stripe webhook handler
  /api/create-checkout-session — Stripe session creator

edgeai-gmail-webhook — Cloud Run (Python/Flask)
  Supabase           — Postgres (carriers, brokers, responses, etc.)
  Gmail API          — Per-carrier OAuth (gmail_token on carrier row)
  Pub/Sub            — Gmail Watch push notifications
  Claude Haiku       — Email classification + broker enrichment
  Twilio/Telnyx      — SMS alerts to carrier
  Stripe             — Subscription billing
```

---

## Supabase Tables

| Table | Purpose |
|-------|---------|
| carriers | One row per carrier. id (UUID), gmail_token, subscription_status, subscription_tier, stripe_customer_id, equipment_type, home_base_zip, max_radius |
| brokers | Broker contacts per carrier. carrier_id, email, name, company, status (hot/warm/cold), last_reply_at |
| responses | Every classified email. gmail_message_id, carrier_id, broker_id, classification, load_accepted |
| load_wins | Confirmed won loads |
| unknown_brokers_inbox | Emails from senders not in brokers table — pending carrier review |
| gmail_sync | historyId tracking per email address |

---

## Onboarding Flow (Confirmed)

```
1. xtxtec.com landing → inline OTP signup card (home.html)
2. signInWithOtp({ email }) → 8-digit code sent
3. verifyOtp() → Supabase session created → /subscribe?first=...&last=...
4. /subscribe → tier selection → Stripe checkout
5. Stripe webhook → subscription_status = active in carriers table
6. /onboard → equipment type, home base ZIP, MC# (step 1)
7. /onboard/lanes → preferred states + radius + load types (step 2)
8. /onboard/rates → rate floor, min load value, deadhead miles (step 3)
9. /onboard/gmail → Gmail OAuth connect → gmail_token saved (step 4)
10. /extract-brokers → scans SENT mail → Claude enriches → import to brokers table
11. Gmail Watch started → ACE live
```

---

## Build Queue — Next Session Priorities

### 1. Broker Extraction Wiring (FIRST TASK)
- `/extract-brokers` Cloud Run endpoint — after Gmail OAuth, scan SENT mail
- Claude enriches contacts → import to `brokers` table
- Wire success handler in `onboard-gmail.html` → confirm extraction ran
- Verify brokers table populated correctly for Ken's account

### 2. Founder Account Activation (BLOCKER)
- Direct Supabase SQL: `UPDATE carriers SET subscription_status = 'active', subscription_tier = 'base' WHERE id = '<carrier UUID = auth.users.id for that carrier — never hardcode>';`
- Do NOT charge Ken for his own account

### 3. Test Carrier End-to-End
- Create a fake carrier account (test email)
- Run full flow: landing → OTP → subscribe → onboard → Gmail OAuth → broker extraction → ACE live
- Verify UUID consistency across all Supabase tables
- Delete test carrier record after confirmation

### 4. Ken's Production Onboarding
- Clean UUID, active subscription at $0
- Real broker list loaded via /extract-brokers
- Gmail OAuth connected (Ken's carrier Gmail)
- ACE Base live and receiving emails

### 5. Email Deliverability
- Custom SMTP in Supabase Auth → noreply@xtxtec.com (not supabase.io)
- Evaluate xtxtransport.com as established sender alias for platform emails

### 6. Infrastructure
- Telnyx SMS — flip SMS_ENABLED=true when Telnyx live and tested
- Privacy Policy page — required before Google OAuth verification
- Terms of Service page — required before Google OAuth verification
- Google OAuth verification submit
- Stripe flip to live mode (Ken instructs when ready)

---

## Standing Notes

- `CARRIER_UUID` env var in Cloud Run must always match the carrier's actual `id` in Supabase — single-carrier limitation; multi-carrier routing is the next architecture step
- Gmail Watch expires every 7 days — Cloud Scheduler calls `/renew-watches` weekly
- All Pub/Sub deliveries must always return HTTP 200 — any non-200 causes infinite retry loops
- Deduplication runs before any Claude/SMS calls — `is_duplicate()` checks both `responses` and `unknown_brokers_inbox`
- Load board emails (DAT, Truckstop, Spot, NTG) are intercepted before broker lookup — separate SMS path
- `trailingSlash: false` in vercel.json — required for all POST endpoints (Stripe, Pub/Sub) to prevent 307 redirect
- `routes` and `rewrites` cannot coexist in vercel.json — use only `rewrites` + `redirects`
- OTP users: signed up via signInWithOtp — no password set — magic link is the re-auth path
- dashboard.html dark/light toggle: uses `body.classList.toggle('light')` — CSS scoped to `body.light`
- logo-edge-white.png is permanent in both dark and light mode on dashboard — do not swap

---

## Files of Interest

| File | Purpose |
|------|---------|
| `services/gmail-webhook/main.py` | Core backend — all Flask routes, Claude, Twilio, Stripe, Gmail logic |
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

## Session Changelog — April 23 2026

| # | Change | Detail |
|---|--------|--------|
| 1 | Domain migrated | xedge-ai.com → xtxtec.com across all files and configs |
| 2 | Stripe webhook built | `dashboard/api/stripe-webhook.js` — checkout.session.completed + customer.subscription.deleted |
| 3 | Vercel env vars added | STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_KEY added to Vercel Production (Project tab) |
| 4 | vercel.json updated | trailingSlash: false; routes → rewrites; 301 redirects |
| 5 | Stripe CLI installed | Local webhook testing on korbs profile |
| 6 | DNS — DKIM + DMARC | Added to xtxtec.com DNS |
| 7 | Support email | Updated to ken@xtxtec.com |
| 8 | Webhook env convention | SUPABASE_KEY = service_role JWT |

---

## Session Changelog — April 26 2026

| # | Change | Files | Commit |
|---|--------|-------|--------|
| 1 | OTP card static text fix | home.html | a4e1d15 |
| 2 | OTP card title/subtitle moved to JS | home.html — handleSignup() dynamically sets "CHECK YOUR INBOX" after signInWithOtp | b56443d |
| 3 | Logo src fixed on all 4 onboard pages | onboard.html, onboard-lanes.html, onboard-rates.html, onboard-gmail.html — edge_refined_roadline1.png → logo-edge-white.png | 51c382f |
| 4 | Logo src cache-bust applied | All 4 onboard pages — src updated to /assets/logo-edge-white.png?v=2 with display:block | fd8416a |
| 5 | Dashboard light mode — white text overrides | dashboard.html — body.light rules for page-title, panel-title, kpi-value, tier-card-plan, nav-item hover, btn-sm-outline hover | fd6ed46 |
| 6 | Dashboard light mode — comprehensive text fix | dashboard.html — body.light overrides for all remaining white/rgba-white text elements | e35be95 |
| 7 | Dashboard dark mode — grey text contrast | dashboard.html — --text-dim 0.4→0.65, --text-mid 0.6→0.8; 12 hardcoded grey rules darkened + font-weight +200 | 9a5da70 |
| 8 | Dashboard light mode — grey text contrast | dashboard.html — same treatment applied under body.light; --text-dim/mid vars darkened; all grey rgba/hex values darkened + weight +200 | c94a745 |
| 9 | ACE status dots enlarged + state colors | dashboard.html — ace-dot 7px→21px, ace-mode-dot 10px→30px; active=#00ff44, inactive=#ff2222, paused=#ff8800 | e25d5fb |
| 10 | Pause ACE wired | dashboard.html — toggleAce() function; dots toggle .paused class; button + banner label + badge label all update | 8cc4037, 0f6366e |
| 11 | Topbar overflow fix | dashboard.html — removed position:fixed from .theme-toggle CSS (fixed elements escape overflow:hidden) | 9efff71 |
| 12 | Topbar right padding | dashboard.html — padding moved from .topbar to .topbar-right; added flex-shrink:0 | 8496f58 |
| 13 | Logo swap JS removed | dashboard.html — logo-edge-white.png permanent in both dark and light mode | d3a5c22 |

---

## Troubleshooting Log

### [RESOLVED] Stripe webhook returning 307 on POST to xtxtec.com/api/stripe-webhook
**Date:** April 23 2026
**Root Cause:** Vercel default trailing slash enforcement redirects POST — Stripe does not follow redirects.
**Resolution:** Added `"trailingSlash": false` to `vercel.json`. Commit `226b565`.

### [RESOLVED] Stripe webhook env vars missing from Vercel production
**Date:** April 23 2026
**Root Cause:** Vars added under Vercel Shared tab instead of Project tab.
**Resolution:** Re-added under Project tab. Always use Project tab, not Shared tab.

### [RESOLVED] dashboard.html topbar right group overflowing past right edge
**Date:** April 26 2026
**Root Cause:** `.theme-toggle` CSS had `position:fixed` — fixed elements escape `overflow:hidden` on all ancestors including the `.app` grid container.
**Resolution:** Removed `position:fixed` from `.theme-toggle` base CSS. Commit `9efff71`.

---

*EDGEai Runbook v7.1 | XTX LLC | April 26 2026*
