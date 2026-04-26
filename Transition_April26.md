# XEdge / EDGEai — SESSION HANDOFF NOTE
## April 26, 2026 | Read This First | Before Doing Anything Else

### PURPOSE
Bring the next Claude session up to speed instantly. Upload this doc + Runbook_v7.1.md + PRD_v4.4.md as your first message.

Claude Code entry: `cd C:\Users\korbs\EDGEai\dashboard` then `claude` (two separate commands)

---

## 1. Who I Am

- **Founder:** Ken Korbel — Dallas-Fort Worth TX
- **Company:** XTX LLC DBA XTX-ai — Wyoming — Ken sole member
- **GitHub:** KenXEdge / repo: edgeai-private / branch: master
- **Email:** korbs827@gmail.com | **Support:** ken@xtxtec.com
- **Live domain:** xtxtec.com
- **AI stack:** Claude Code (primary dev tool) | Node.js only — Python NOT installed on dev machine

---

## 2. System Status — April 26 2026

| Component | Status | Detail |
|-----------|--------|--------|
| xtxtec.com | LIVE | Vercel — primary domain |
| home.html | LIVE | Landing page — inline OTP signup card wired |
| /auth (Login.jsx) | LIVE | Sign in + OTP flow — Supabase auth |
| /verify (verify.html) | LIVE | Email confirmation gate |
| /subscribe | LIVE | Tier selection → Stripe checkout (TEST mode) |
| /onboard (4 steps) | LIVE | Truck info → Lanes → Rates → Gmail OAuth |
| /dashboard (dashboard.html) | LIVE | Dark/light mode, ACE status, KPI panels, Pause ACE toggle |
| /api/stripe-webhook | LIVE | Handles checkout.session.completed + customer.subscription.deleted |
| /api/create-checkout-session | LIVE | Creates Stripe checkout session |
| Cloud Run | STABLE | edgeai-gmail-webhook revision 00072-c58 |
| Supabase | LIVE | siafwhlzazefyoevslde.supabase.co |
| Stripe | TEST MODE | Do not flip to live until Ken instructs |
| SMS | DISABLED | SMS_ENABLED=false — Telnyx pending |
| Gmail Watch | PENDING | Depends on broker extraction + Ken's production onboarding |
| Google OAuth | PENDING | Needs Privacy Policy + Terms pages first |
| Custom SMTP | PENDING | Supabase auth emails still from supabase.io |
| n8n | ARCHIVED | Do not touch |

---

## 3. All Changes Made This Session — April 26 2026

| # | Change | Files | Commit |
|---|--------|-------|--------|
| 1 | OTP card static text fix | home.html | a4e1d15 |
| 2 | OTP card title/subtitle moved to JS | home.html — handleSignup() dynamically sets "CHECK YOUR INBOX" after signInWithOtp | b56443d |
| 3 | Logo src fixed on all 4 onboard pages | onboard.html, onboard-lanes.html, onboard-rates.html, onboard-gmail.html | 51c382f |
| 4 | Logo src cache-bust applied | All 4 onboard pages — src updated to /assets/logo-edge-white.png?v=2 | fd8416a |
| 5 | Dashboard light mode — white text overrides | dashboard.html — body.light rules for page-title, panel-title, kpi-value, tier-card-plan, nav-item hover, btn-sm-outline hover | fd6ed46 |
| 6 | Dashboard light mode — comprehensive text fix | dashboard.html — body.light overrides for all remaining white/rgba-white text elements | e35be95 |
| 7 | Dashboard dark mode — grey text contrast | dashboard.html — --text-dim 0.4→0.65, --text-mid 0.6→0.8; 12 hardcoded grey rules darkened + font-weight +200 | 9a5da70 |
| 8 | Dashboard light mode — grey text contrast | dashboard.html — same treatment under body.light | c94a745 |
| 9 | ACE status dots enlarged + state colors | dashboard.html — ace-dot 7px→21px, ace-mode-dot 10px→30px; active=#00ff44, inactive=#ff2222, paused=#ff8800 | e25d5fb |
| 10 | Pause ACE wired | dashboard.html — toggleAce() updates dots, badge label, banner label, button text | 8cc4037, 0f6366e |
| 11 | Topbar overflow fix | dashboard.html — removed position:fixed from .theme-toggle CSS | 9efff71 |
| 12 | Topbar right padding moved | dashboard.html — padding from .topbar → .topbar-right; flex-shrink:0 added | 8496f58 |
| 13 | Logo swap JS removed | dashboard.html — logo-edge-white.png permanent in both dark and light mode | d3a5c22 |

---

## 4. Critical Values — All Current

| Item | Value |
|------|-------|
| Live domain | https://xtxtec.com |
| Dashboard URL | https://xtxtec.com |
| CORS origin | https://xtxtec.com |
| Support email | ken@xtxtec.com |
| Cloud Run service | edgeai-gmail-webhook |
| Active revision | 00072-c58 |
| GCP project | edgeai-493115 |
| Pub/Sub topic | projects/edgeai-493115/topics/edgeai-gmail |
| Supabase | siafwhlzazefyoevslde.supabase.co |
| GitHub | KenXEdge/edgeai-private — master |
| Claude model (classify) | claude-haiku-4-5-20251001 |
| Stripe Base price | price_1TN2Y5**** |
| Stripe Custom price | price_1TN2Yh**** |
| Stripe Premium price | price_1TN2dg**** |
| Ken's carriers row | e84dfb58**** — DO NOT ALTER |

---

## 5. Build Queue — Next Session — Priority Order

### PRIORITY 1 — FIRST TASK — Broker Extraction Wiring
- `/extract-brokers` Cloud Run endpoint — after Gmail OAuth in `onboard-gmail.html`, call this endpoint
- Scans carrier SENT mail → Claude enriches contacts → imports to `brokers` table
- Wire success handler in `onboard-gmail.html` to confirm extraction ran and broker count
- Verify `brokers` table is populated correctly for Ken's account after running

### PRIORITY 2 — Founder Account Activation (BLOCKER)
- Direct Supabase SQL (do NOT use Stripe, do NOT charge Ken):
  ```sql
  UPDATE carriers SET subscription_status = 'active', subscription_tier = 'base' WHERE id = 'e84dfb58****';
  ```
- Verify row updated — subscription_status = 'active', subscription_tier = 'base'

### PRIORITY 3 — Test Carrier End-to-End
- Create fake carrier account (test email)
- Run full flow: landing → OTP → subscribe → onboard (4 steps) → Gmail OAuth → broker extraction → ACE live
- Verify UUID consistency across all Supabase tables
- Delete test carrier record after confirmation (carriers, brokers, gmail_sync, responses)

### PRIORITY 4 — Ken's Production Onboarding
- Clean UUID, active subscription at $0
- Real broker list loaded via /extract-brokers
- Gmail OAuth connected (Ken's carrier Gmail)
- ACE Base live and receiving emails

### PRIORITY 5 — Email Deliverability
- Custom SMTP in Supabase Auth → noreply@xtxtec.com (not supabase.io)
- Evaluate xtxtransport.com as established sender alias for platform emails

### PRIORITY 6 — Infrastructure
- Telnyx SMS — flip SMS_ENABLED=true when Telnyx live and tested
- Privacy Policy page — required before Google OAuth verification
- Terms of Service page — required before Google OAuth verification
- Google OAuth verification submit
- Stripe flip to live mode (Ken instructs when ready)

---

## 6. Key Architecture Notes

- `CARRIER_UUID` env var in Cloud Run must always match the carrier's actual `id` in Supabase — single-carrier limitation
- Gmail Watch expires every 7 days — Cloud Scheduler calls `/renew-watches` weekly
- All Pub/Sub deliveries must always return HTTP 200 — non-200 causes infinite retry loops
- Deduplication runs before any Claude/SMS calls — `is_duplicate()` checks both `responses` and `unknown_brokers_inbox`
- OTP users: signed up via signInWithOtp — no password set — magic link is the re-auth path
- `trailingSlash: false` in vercel.json — required for all POST endpoints
- `routes` and `rewrites` cannot coexist in vercel.json — use only `rewrites` + `redirects`
- logo-edge-white.png is permanent in both dark and light mode — do not swap

---

## 7. Deploy Commands

**Dashboard (auto-deploys via Vercel on git push):**
```
cd C:\Users\korbs\EDGEai
git add dashboard/public/dashboard.html
git commit -m "description"
git push
```

**Cloud Run build:**
```
gcloud builds submit --tag us-central1-docker.pkg.dev/edgeai-493115/edgeai/edgeai-gmail-webhook --project edgeai-493115 .
```

**Cloud Run deploy:**
```
gcloud run deploy edgeai-gmail-webhook --image us-central1-docker.pkg.dev/edgeai-493115/edgeai/edgeai-gmail-webhook --platform managed --region us-central1 --project edgeai-493115
```

**Cloud Run logs:**
```
gcloud run services logs read edgeai-gmail-webhook --region=us-central1 --project=edgeai-493115 --limit=20
```

**Claude Code entry:**
```
cd C:\Users\korbs\EDGEai\dashboard
claude
```

---

## 8. Standing Rules for Claude

- Flag Runbook/PRD items inline during chat — do not wait for end of session
- Never push to git without Ken approval — unless brand new standalone page
- Never display credentials — truncate to first 4 + **** (e.g. sk_test_****)
- Never recreate logo geometry — always use PNG files from assets folder (logo-edge-white.png, logo-edge-black.png)
- Never set height/width on logo img tag
- Node.js only — Python NOT installed on dev machine
- SMS_ENABLED=false — do not flip until Telnyx live and tested
- Stripe TEST mode — do not flip to live until Ken instructs
- n8n ARCHIVED — do not unarchive
- Never alter Ken's carriers row e84dfb58**** — all broker/response/outreach history tied to it
- Never cross-contaminate or delete production data without explicit Ken approval
- PowerShell does not support && — always use two separate commands
- End of session — generate updated .docx versions of all 4 docs and upload to Google Drive folder 1D8W9wUjjCbL2myxlBLlTgulQXeihUZ1h

---

*XEdge Transition Note | April 26 2026 | XTX LLC | Upload with Runbook_v7.1.md + PRD_v4.4.md*
