# XEdge / EDGEai — SESSION HANDOFF NOTE
## April 25, 2026 | Read This First | Before Doing Anything Else

**Session start command:**
```
git pull
```
Then read:
```
docs/Runbook_v7.1.md  docs/PRD_v4.4.md  docs/PitchBook_v1.2.md  docs/Transition_latest.md
```
Claude Code entry: `cd C:\Users\korbs\EDGEai\dashboard` then `claude` (two separate commands — PowerShell does not support `&&`)

---

## 1. System Status — April 25 2026

| Component | Status | Detail |
|-----------|--------|--------|
| xtxtec.com | LIVE | Vercel — primary domain |
| Cloud Run | STABLE | edgeai-gmail-webhook revision 00071-hj8 |
| Supabase | LIVE | siafwhlzazefyoevslde.supabase.co |
| Gmail OAuth | LIVE | onboard-gmail.html — confirmed working |
| Stripe billing | TEST MODE | Webhook confirmed working — do not flip to live |
| OTP signup | LIVE | 8-digit code via Magic Link — Resend + xtxtransport.com |
| /dashboard route | LIVE | /carrier fully retired |
| SMS | DISABLED | SMS_ENABLED=false — Telnyx not yet set up |
| ACE Morning Brief | BUILT | n8n scheduler + SMS parser + dashboard input — wiring pending |
| ACE Scout | DESIGNED | Not yet built — queued for next major build cycle |
| Gmail Watch | PENDING | Depends on Ken production onboarding completion |
| Google OAuth verification | PENDING | Needs Privacy Policy + Terms pages first |

---

## 2. What Was Built This Session

| # | Feature / Fix | Detail |
|---|---------------|--------|
| 1 | OTP card selector fix | `#card-form-view` wrapper — OTP block renders after signInWithOtp() |
| 2 | verifyOtp type fixed | type: 'email' → type: 'signup' |
| 3 | OTP 8-digit | maxlength=8; all "6-digit" copy updated; token guard updated |
| 4 | /carrier route retired | App.jsx route deleted; all navigate() calls → /dashboard; Layout.jsx nav updated |
| 5 | EDGE brand corrections | Platform = EDGE (spoken) / XEdge (product); ACE = Agentic Carrier Employee |
| 6 | SMTP → Resend | noreply@xtxtransport.com, display name EdgeTech, Magic Link template |
| 7 | Gmail OAuth confirmed live | onboard-gmail.html OAuth flow tested on production |
| 8 | Stripe webhook confirmed | subscription_status activation end-to-end confirmed working |
| 9 | Supabase columns added | active_focus_zip, active_focus_city, active_focus_state, focus_updated_at, outreach_time |
| 10 | ACE Morning Brief | n8n trigger, inbound SMS parser (city/state/ZIP), dashboard input, midnight reset |
| 11 | ACE Scout designed | Sylectus browser automation — session, dedup, broker email extraction, Gmail outreach |
| 12 | Tier corrections | Base $47 / Base Plus $97 / Dispatcher Pro $297 |
| 13 | Base Plus SMS loop | Two-way SMS — carrier replies to ACE for focus zone, wins, broker queries |
| 14 | Dispatcher Pro spec | Multi-carrier dashboard for dispatcher-managed fleets |
| 15 | Executive Binder | Runbook v7.1, PRD v4.4, PitchBook v1.2, Transition note — committed to docs/ |
| 16 | deploy.sh fixed | Auto-sources .env; CARRIER_UUID removed |
| 17 | RLS confirmed | Disabled on carriers table — enforced at application layer |

---

## 3. Known Bug — Stripe Webhook Email Match

**Symptom:** `subscription_status` may not flip to `active` on OTP signups.

**Root cause:** On `checkout.session.completed`, `stripe-webhook.js` looks up the carrier by email. For OTP signups, the carriers row may not exist yet at the time the webhook fires — Supabase Auth creates the auth user, but the carriers insert may lag.

**Impact:** Carrier completes Stripe checkout but ends up stuck at subscribe screen or fails subscription gate check.

**Fix required next session:**
- Option A: Upsert carrier row on email in `stripe-webhook.js` if not found
- Option B: Confirm timing — when does carriers row get created relative to OTP signup completion
- File: `dashboard/api/stripe-webhook.js`

---

## 4. Priority Queue — Next Session Top 5

### Priority 1 — Telnyx SMS (BLOCKER)
- Set up Telnyx account
- Wire Telnyx into `services/gmail-webhook/main.py` — replace all Twilio references
- Test inbound SMS (city/state/ZIP parsing for Morning Brief focus zone)
- Test outbound SMS (load_offer alert)
- Flip `SMS_ENABLED=true` only after both confirmed working end-to-end

### Priority 2 — Broker Extraction Reliability
- Run `/extract-brokers` against Ken's live Gmail SENT folder
- Validate SSE progress stream in `onboard-gmail.html`
- Error handling and retry logic in `main.py`
- Confirm brokers table populated with real data before declaring complete

### Priority 3 — Stripe Webhook Fix (BUG — see above)
- Fix email match race condition in `dashboard/api/stripe-webhook.js`
- Test with a real OTP signup + Stripe test checkout
- Confirm `subscription_status = active` on correct carriers row

### Priority 4 — Carriers Table Schema Audit
- In Supabase dashboard, run:
  ```sql
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'carriers' ORDER BY ordinal_position;
  ```
- Confirm presence of: active_focus_zip, active_focus_city, active_focus_state, focus_updated_at, outreach_time
- Confirm RLS disabled: check via Supabase Auth > Policies
- Add any missing columns with correct types

### Priority 5 — Dashboard Live Data Wiring
- `dashboard/public/dashboard.html`
  - Replace hardcoded broker `<tbody>` rows with live Supabase query (carrier_id = session.user.id)
  - Sidebar badge counts from brokers + unknown_brokers_inbox live counts
  - Focus zone input → PATCH carriers row active_focus_zip/city/state
  - ACE status dot → from subscription_status

---

## 5. Next Build Queue (After Top 5)

- **ACE Morning Brief wiring** — n8n trigger → Cloud Run endpoint or Supabase function; test SMS end-to-end
- **Founder Account Activation** — Direct SQL to activate Ken at $0; do NOT use Stripe
- **ACE Scout build** — Sylectus session management, load dedup store, broker email extraction
- **Privacy Policy + Terms pages** — Required for Google OAuth verification
- **Google OAuth verification submit**
- **Stripe flip to live mode** — Ken instructs when ready

---

## 6. Standing Rules — All Active

- Node.js only — Python NOT installed on dev machine
- No git push without Ken approval (exception: brand new standalone pages)
- Never alter Ken's carriers row — carrier UUID = auth.users.id — never hardcode
- `SMS_ENABLED=false` — Telnyx pending — do not flip
- n8n: Morning Brief scheduler only — all other workflows ARCHIVED
- Stripe TEST mode — do not flip to live until Ken instructs
- `logo-edge-white.png` permanent in both dark and light mode — do not swap
- PowerShell: two separate commands — `&&` operator not supported in PS 5.1
- End of session: save updated docs to `C:\Users\korbs\EDGEai\` and commit to master
- CARRIER_UUID removed from Cloud Run env vars — carrier identity from auth.users.id at runtime
- RLS disabled on carriers — enforced at application layer

---

## 7. Infrastructure Notes

- Gmail Watch expires every 7 days — Cloud Scheduler calls `/renew-watches` weekly
- All Pub/Sub deliveries must always return HTTP 200 — non-200 causes infinite retry loops
- `trailingSlash: false` in vercel.json — required for Stripe and Pub/Sub POST endpoints
- `routes` and `rewrites` cannot coexist in vercel.json — use only `rewrites` + `redirects`
- deploy.sh auto-sources `.env` — all secrets inject on deploy (fixed this session)
- CARRIER_UUID removed from deploy.sh and Cloud Run env vars (April 29 2026)
- SMTP: Resend, noreply@xtxtransport.com, display name EdgeTech, Magic Link template

---

*XEdge Transition Note | April 25 2026 | XTX LLC*
