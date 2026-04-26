# XEdge / EDGEai — SESSION HANDOFF NOTE
## April 26, 2026 v2 | Read This First | Before Doing Anything Else

Claude Code entry: `cd C:\Users\korbs\EDGEai\dashboard` then `claude` (two separate commands)

---

## 1. Files Read This Session

- `PRD_v4.4.md`
- `Runbook_v7.1.md`
- `Transition_April26.md`

---

## 2. PENDING GIT PUSH — Staged But NOT Pushed

Two files are staged and waiting for Ken approval:

| File | Change |
|------|--------|
| `dashboard/public/onboard-gmail.html` | Fix 2 — `handleContinue()` full async rewrite |
| `dashboard/public/dashboard.html` | Fix 3 — live Supabase broker table, sidebar counts, Add Broker modal |

**Do NOT push until Ken approves. Do NOT amend. Do NOT unstage.**

---

## 3. Before Pushing — Ken Requires Answers to These 5 Questions

**a.** Did you touch ACE dots, Pause ACE toggle, `toggleAce()`? (commits 8cc4037, e25d5fb)

**b.** Did you touch dark/light CSS vars `--text-dim`, `--text-mid`? (commits 9a5da70, c94a745)

**c.** Did you touch topbar or `.theme-toggle` CSS? (commits 9efff71, 8496f58)

**d.** Auth gate change — was existing logic preserved or rewritten? Show auth gate diff only.

**e.** Hardcoded broker rows — were they in an isolated container or mixed into other logic?

---

## 4. Fix 2 Summary — `handleContinue()` in `onboard-gmail.html`

Previous behavior: fire-and-forget `fetch('/extract-brokers')` with no await, immediate redirect to `/dashboard`. Errors swallowed silently.

New behavior — full async sequence:
1. POST `/extract-brokers` → await → check `ok` flag → get `{ brokers: [...], total: N }`
2. POST `/import-brokers` with enriched broker list → await confirmation
3. Show broker count to user in inline status bar (gold = scanning/importing, green = success, red = error)
4. 2-second delay → redirect to `/dashboard`

On any HTTP error or `ok: false` from either endpoint — inline red error message shown, button re-enabled. No silent swallow. No redirect until both calls succeed.

---

## 5. Fix 3 Summary — `dashboard.html` Live Broker Data

**Auth gate:** Refactored to expose `_sb` and `_session` as globals. Existing auth logic (session check → subscription_status check → redirect on fail) preserved exactly. Added `loadDashboardData()` call after auth passes. No other changes to gate logic.

**`loadBrokers()`:** Queries `brokers` table WHERE `carrier_id = session.user.id`, ordered by `last_reply_at` DESC, limit 50. Renders live rows with status pills (🔥 Hot / ✓ Active / → Cold). Empty state shows "No brokers yet" message. Error state shows red message.

**`loadSidebarCounts()`:** Parallel count queries on `brokers` and `unknown_brokers_inbox` tables, updates `#badge-brokers` and `#badge-unknown` in sidebar.

**Add Broker modal:** `+ Add Broker` button opens modal with Name, Company, Email fields. On submit, inserts to `brokers` table with `status: 'cold'`. On success, refreshes broker table + sidebar counts. Escape key and Cancel both close modal.

**Security:** All broker names run through `escHtml()` before rendering into `innerHTML`.

**Hardcoded broker rows:** Were isolated inside `<tbody>` in the outreach panel. Replaced with `<tbody id="broker-tbody">` + loading placeholder. No surrounding logic touched.

---

## 6. Priority Queue — After Push Approved

### Priority 2 — Founder Account Activation (BLOCKER)
Direct Supabase SQL — do NOT use Stripe, do NOT charge Ken:
```sql
UPDATE carriers SET subscription_status = 'active', subscription_tier = 'base' WHERE id = 'e84dfb58****';
```
Verify row updated. `subscription_status = 'active'`, `subscription_tier = 'base'`.

### Priority 3 — Test Carrier End-to-End
- Create fake carrier account (test email)
- Run full flow: landing → OTP → subscribe → onboard (4 steps) → Gmail OAuth → broker extraction → ACE live
- Verify UUID consistency across all Supabase tables
- Delete test carrier record after confirmation (carriers, brokers, gmail_sync, responses)

### Priority 4 — Ken's Production Onboarding
- Clean UUID, active subscription at $0
- Real broker list loaded via `/extract-brokers` → `/import-brokers`
- Gmail OAuth connected (Ken's carrier Gmail)
- ACE Base live and receiving emails

---

## 7. Standing Rules — All Still Active

- Node.js only — Python NOT installed on dev machine
- No git push without Ken approval (exception: brand new standalone pages)
- Never alter Ken's carriers row `e84dfb58****` — all broker/response/outreach history tied to it
- `SMS_ENABLED=false` — Telnyx selected but not yet set up; do not flip
- Twilio REMOVED entirely — do not reference
- n8n ARCHIVED — do not touch
- Stripe TEST mode — do not flip to live until Ken instructs
- `logo-edge-white.png` permanent in both dark and light mode — do not swap
- PowerShell: two separate commands, no `&&` operator
- No Google Drive — end of session: save docs to `C:\Users\korbs\EDGEai\` and commit to master

---

## 8. Infrastructure Notes

- `gcloud auth` was NOT completed this session — Cloud Run env var names not retrieved
- `CARRIER_UUID` env var in Cloud Run must always match Ken's carriers row `e84dfb58****`
- Gmail Watch expires every 7 days — Cloud Scheduler calls `/renew-watches` weekly
- All Pub/Sub deliveries must always return HTTP 200 — non-200 causes infinite retry loops

---

## 9. System Status — April 26 2026

| Component | Status | Detail |
|-----------|--------|--------|
| xtxtec.com | LIVE | Vercel — primary domain |
| Cloud Run | STABLE | edgeai-gmail-webhook revision 00072-c58 |
| Supabase | LIVE | siafwhlzazefyoevslde.supabase.co |
| Stripe | TEST MODE | Do not flip to live |
| SMS | DISABLED | SMS_ENABLED=false — Telnyx pending |
| Gmail Watch | PENDING | Depends on Ken production onboarding |
| Google OAuth | PENDING | Needs Privacy Policy + Terms pages first |

---

*XEdge Transition Note | April 26 2026 v2 | XTX LLC*
