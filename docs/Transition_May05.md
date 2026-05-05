# EDGEai — Session Transition Note
**Date:** May 5, 2026 | **From:** Claude Code session | **Runbook:** v8.3 | **PRD:** v5.2

---

## What Was Accomplished This Session

### Dashboard — Fully Wired to Live Supabase Data

dashboard.html is now fully live at xtxtec.com/dashboard. All data comes from real Supabase.

**AuthGate select expanded:**
```js
select('subscription_status, subscription_tier, owner_name, company_name, truck_type,
        home_base_city, home_base_state, max_radius, gmail_token, broker_count, pending_count')
```

**Greeting:** `"Good day, [Company Name]"` — no first name, no time-of-day.

**Sidebar badges:** broker_count and pending_count from carrier row (trigger-maintained).

**KPI strip:** wired to real data — see open bug below on Broker Touches.

### Broker Management View Built (Full CRUD)

- Columns: Checkbox / Name / Company / Email / Status / Touches / Contact / Actions
- Inline edit injects row below target with all fields + contact_enabled checkbox
- Status: plain text Hot / Warm / Cold (no emoji, no pill backgrounds)
- Sort: ORDER BY company ASC
- Bulk delete with confirmation modal
- contact_enabled: On/Off display, 50% opacity for off rows

### Pending Brokers View Built

- Renamed from "Unknown Brokers" throughout
- Columns: Checkbox / Company / Email / Touches / Status / Add to Network
- Promote to Network: INSERT brokers + DELETE unknown_brokers_inbox in single op
- Bulk delete with confirmation modal

### RLS Fixed on brokers and unknown_brokers_inbox

Both tables had RLS enabled but NO policies — all reads/writes were blocked. Migration `rls_brokers_and_pending` applied:
- SELECT / INSERT / UPDATE / DELETE policies for authenticated role
- All scoped to `carrier_id = auth.uid()`

### Carrier Table Additions

- `broker_count` — trigger-maintained COUNT of brokers rows per carrier
- `pending_count` — trigger-maintained COUNT of unknown_brokers_inbox rows per carrier
- `contact_enabled` — boolean on brokers table (carrier can toggle off per broker)

### Onboarding — Reduced to 4 Steps

- `/onboard/rates` (Step 3) removed — rate floor moved to Step 1 with tooltip
- Step count updated across all onboarding pages
- Back/Next navigation corrected

### vercel.json — No-Cache Headers for HTML

Added Cache-Control: no-cache headers for all `.html` files — resolves stale dashboard issue after Vercel deploys.

### Sidebar Cosmetic Pass

- Font sizes increased 3–4 sizes on section headers
- Badge: 15px, 700 weight
- Gold hover/active on nav items (dark AND light mode)
- Status pills: plain text labels only (no emoji, no colored backgrounds)
- btn-sm and ace-toggle matched to 14px/600

---

## Open Bug — FIRST THING NEXT SESSION

### KPI "Broker Touches" — MISLABELED

**The problem:** `touch_count` on the brokers table tracks how many times a broker has emailed the carrier (INBOUND). The dashboard KPI box labeled "Broker Touches" currently shows 208 — this implies ACE sent 208 outbound emails to brokers, which is false.

**What touch_count actually means:** Times THIS broker has contacted the carrier.

**Fix needed:** Rename the KPI label to "Inbound Contacts" or "Broker Emails Received" — or confirm with Ken what the correct outbound metric should be and where to source it.

**File:** `dashboard/public/dashboard.html` — grep for `kpi-touches`

---

## Current Git State

- Branch: master
- Last commit: `dab8d67` — feat: wire KPI strip — Broker Touches, Replies, Load Wins live from brokers table
- Vercel: LIVE at xtxtec.com — all dashboard changes deployed

---

## System Status

| Component | Status |
|-----------|--------|
| xtxtec.com (Vercel) | LIVE |
| Cloud Run active revision | 00134 |
| Cloud Run stable fallback | 00107-hk2 |
| Git restore baseline | 2c4a409 |
| Gmail OAuth | LIVE |
| Stripe | TEST MODE — do not flip |
| SMS | DISABLED — SMS_ENABLED=false |
| Dashboard | LIVE — wired to real Supabase data |
| Onboarding | 4-step flow (rates page removed) |
| ACE inbox monitoring | LIVE — Gmail Watch Pub/Sub webhook live |
| ACE outreach sending | NOT BUILT — empty states shown on dashboard |
| Broker Management view | LIVE — full CRUD |
| Pending Brokers view | LIVE — promote to network + bulk delete |
| Load Offer Pipeline | PINNED — not yet built |
| Chrome Extension | PINNED — not yet built |

---

## Pinned Build Items

### Load Offer Pipeline
Replace hardcoded `is_load_board_email()` whitelist with Claude boolean classifier + multi-load parser. Case study: Kirsten Muncy / Accelerated Logistics — 11 loads, $700–$3,500. Files: `services/gmail-webhook/main.py`.

### Chrome Extension — Silent Broker Add
Sidebar panel in Gmail: auto-extracts broker info, dupe-checks brokers table, one-click add. No outreach sending. User prefers extension over Gmail Add-on.

---

## Remaining Build Queue

1. Fix KPI "Broker Touches" label (IMMEDIATE)
2. Dashboard SB parameters wiring (rate_floor, lanes, max_radius, equipment_type editable)
3. Load Offer Pipeline (PINNED)
4. Chrome Extension — Silent Broker Add (PINNED)
5. Refactor main.py — extraction.py, webhook.py, load_board.py, carriers.py, sms.py
6. Telnyx SMS — replace Twilio, flip SMS_ENABLED=true
7. Privacy Policy + Terms pages (Google OAuth verification requirement)
8. Welcome email on onboarding_complete
9. outreach_log table
10. ACE Outreach Sending — compose, send, "ACE/Outreach" label

---

## Key Files

| File | Purpose |
|------|---------|
| `dashboard/public/dashboard.html` | Main carrier dashboard — all views |
| `dashboard/public/onboard.html` | Step 1: profile + rate floor |
| `dashboard/public/onboard-lanes.html` | Step 2: lanes |
| `dashboard/public/onboard-gmail.html` | Step 3: Gmail connect + patience sequence |
| `dashboard/vercel.json` | Rewrites, redirects, no-cache headers |
| `services/gmail-webhook/main.py` | Core Flask backend — monolith ~1,650 lines |
| `services/gmail-webhook/deploy.sh` | Cloud Run deploy — auto-sources .env |
