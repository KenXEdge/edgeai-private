# XEdge / EDGEai — SESSION HANDOFF NOTE
## April 25, 2026 | Read This First | Before Doing Anything Else

Claude Code entry: `cd C:\Users\korbs\EDGEai\dashboard` then `claude` (two separate commands)

---

## 1. System Status — April 25 2026

| Component | Status | Detail |
|-----------|--------|--------|
| xtxtec.com | LIVE | Vercel — primary domain |
| Cloud Run | STABLE | edgeai-gmail-webhook revision 00071-hj8 |
| Supabase | LIVE | siafwhlzazefyoevslde.supabase.co |
| Gmail OAuth | LIVE | Connected and confirmed working |
| Stripe | TEST MODE | Webhook confirmed working — do not flip to live |
| SMS | DISABLED | SMS_ENABLED=false — Telnyx not yet set up |
| Morning Brief | BUILT | n8n scheduler + inbound SMS parser + dashboard input path |
| Gmail Watch | PENDING | Depends on Ken production onboarding completion |
| Google OAuth verification | PENDING | Needs Privacy Policy + Terms pages first |

---

## 2. What Was Built This Session

| # | Feature | Detail |
|---|---------|--------|
| 1 | EDGE brand corrections | Platform name EDGE (spoken) / XEdge (product) applied throughout all docs and UI |
| 2 | ACE agent name locked | ACE = Agentic Carrier Employee — confirmed across all materials |
| 3 | ACE Morning Brief | Daily SMS at carrier outreach_time via n8n — active focus zone + broker summary |
| 4 | Supabase schema additions | active_focus_zip, active_focus_city, active_focus_state, focus_updated_at, outreach_time added to carriers table |
| 5 | Inbound SMS parser | Carrier texts city/state/ZIP → parser extracts → updates active_focus_zip/city/state |
| 6 | Dashboard focus input | Focus zone input on dashboard.html → PATCH carriers table |
| 7 | Classification routing fix | Filter uses active_focus_zip when set; falls back to home_base_zip |
| 8 | /carrier route retired | All traffic rerouted to /dashboard |
| 9 | SMTP → Resend | xtxtransport.com sender domain — replaces default Supabase SMTP |
| 10 | OTP 8-digit confirmed | signInWithOtp returns 8-digit code — working |
| 11 | Stripe webhook confirmed | subscription_status activation end-to-end confirmed working |
| 12 | Executive Binder updated | PRD v4.4, Runbook v7.0, PitchBook v1.1, Transition note committed to docs/ |

---

## 3. Priority Queue — Next Session

### Priority 1 — Telnyx SMS (BLOCKER)
- Set up Telnyx account
- Wire Telnyx into main.py — replace all Twilio references
- Test inbound + outbound SMS
- Flip `SMS_ENABLED=true` only after confirmed working
- Do NOT flip until tested end-to-end

### Priority 2 — Broker Extraction Reliability
- Run `/extract-brokers` against Ken's live Gmail SENT folder
- Validate SSE progress stream in onboard-gmail.html
- Verify brokers table populates correctly with real data
- Error handling and retry logic audit

### Priority 3 — Stripe Webhook Email Match Fix
- In `dashboard/api/stripe-webhook.js`, verify carrier lookup on `checkout.session.completed` matches by email correctly
- Test with a real checkout flow (test mode)
- Confirm `subscription_status = active` set on correct row

### Priority 4 — Carriers Table Schema Audit
- Confirm all new columns exist in production Supabase:
  - active_focus_zip
  - active_focus_city
  - active_focus_state
  - focus_updated_at
  - outreach_time
- Confirm RLS is disabled on carriers table
- Add any missing columns via Supabase dashboard SQL

### Priority 5 — Dashboard Live Data Wiring
- `dashboard.html` broker table — replace hardcoded rows with live Supabase query
- Sidebar counts — live query from brokers and unknown_brokers_inbox
- Focus zone input field — wire PATCH to carriers table
- ACE status dot — wire from real carrier subscription_status

### Priority 6 — Founder Account Activation (BLOCKER)
- Direct Supabase SQL to activate Ken's account:
  ```sql
  UPDATE carriers SET subscription_status = 'active', subscription_tier = 'base'
  WHERE id = '<carrier UUID = auth.users.id for that carrier>';
  ```
- Do NOT charge Ken — no Stripe, no coupon needed, direct SQL only
- Verify row updated before proceeding

---

## 4. Standing Rules — All Active

- Node.js only — Python NOT installed on dev machine
- No git push without Ken approval (exception: brand new standalone pages)
- Never alter Ken's carriers row — carrier UUID = auth.users.id — never hardcode
- `SMS_ENABLED=false` — Telnyx pending — do not flip
- n8n: Morning Brief scheduler is active; all other n8n workflows ARCHIVED — do not unarchive
- Stripe TEST mode — do not flip to live until Ken instructs
- `logo-edge-white.png` permanent in both dark and light mode — do not swap
- PowerShell: two separate commands — `&&` operator not supported
- End of session: save updated docs to `C:\Users\korbs\EDGEai\` and commit to master
- CARRIER_UUID removed from Cloud Run env vars — carrier identity comes from auth.users.id at runtime

---

## 5. Infrastructure Notes

- Gmail Watch expires every 7 days — Cloud Scheduler calls `/renew-watches` weekly
- All Pub/Sub deliveries must always return HTTP 200 — non-200 causes infinite retry loops
- `trailingSlash: false` in vercel.json — required for Stripe and Pub/Sub POST endpoints
- `routes` and `rewrites` cannot coexist in vercel.json — use only `rewrites` + `redirects`
- deploy.sh now auto-sources `.env` before gcloud run deploy — secrets inject correctly
- CARRIER_UUID removed from deploy.sh and Cloud Run env vars (April 29 2026)
- RLS disabled on carriers table — confirmed

---

## 6. Files Changed This Session

| File | Change |
|------|--------|
| `services/gmail-webhook/main.py` | Inbound SMS parser, Morning Brief trigger, active_focus_zip routing |
| `dashboard/public/dashboard.html` | Focus zone input field |
| `dashboard/public/onboard-gmail.html` | /carrier → /dashboard redirect update |
| `docs/Runbook_v7.0.md` | Full runbook — April 25 snapshot |
| `docs/PRD_v4.3.md` | PRD v4.4 — Morning Brief feature, tier definitions, GTM |
| `docs/PitchBook_v1.1.md` | PitchBook — EDGE brand, two-sided market, GTM, four-phase vision |
| `docs/Transition_latest.md` | This file |

---

*XEdge Transition Note | April 25 2026 | XTX LLC*
