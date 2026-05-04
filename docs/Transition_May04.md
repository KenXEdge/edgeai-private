# XEdge / EDGEai — SESSION HANDOFF NOTE
## May 4, 2026 | Read This First | Before Doing Anything Else

**Session start command (new machine):**
```
git clone https://github.com/KenXEdge/edgeai-private.git
cd edgeai-private\dashboard
claude
```

**If already cloned:**
```
git pull
```

Then read:
```
docs/Runbook_v8.2.md  docs/PRD_v5.1.md  docs/Transition_May04.md
```

**gcloud auth (new machine — required before deploying or checking logs):**
```
gcloud auth login
gcloud config set project edgeai-493115
```
Use `ken@xedge-ai.com` — NOT korbs827@gmail.com (GCP is tied to xedge-ai.com).

---

## CONTEXT NOTE — NEW MACHINE

Ken moved to a new machine mid-session. The session summary and MEMORY.md are synced to the Anthropic account and load automatically in Claude Code. The raw chat `.jsonl` is local to the old machine only — not needed, this note covers all context.

---

## 1. System Status — May 4 2026

| Component | Status | Detail |
|-----------|--------|--------|
| xtxtec.com | LIVE | Vercel — primary domain |
| Cloud Run | ACTIVE | edgeai-gmail-webhook revision 00134 |
| Best extract-brokers revision | 00128 | If 00134 underperforms, roll back to 00128 |
| Supabase | LIVE | siafwhlzazefyoevslde.supabase.co |
| Gmail OAuth | LIVE | onboard-gmail.html — confirmed working |
| Stripe billing | TEST MODE | Webhook confirmed working — do not flip to live |
| OTP signup | LIVE | 8-digit code via Magic Link — Resend + xtxtransport.com |
| SMS | DISABLED | SMS_ENABLED=false — Telnyx not yet set up |
| Brokers table | **EMPTY** | 00134 run hit rate limit mid-run — re-run required |
| Extract-brokers | STABLE CODE | Revision 00134 — see fill rates below |
| ACE Morning Brief | BUILT | n8n scheduler + SMS parser + dashboard input — wiring pending |
| ACE Scout | DESIGNED | Not yet built — queued for next major build cycle |
| Dashboard live data | NOT YET WIRED | Brokers table not connected to dashboard.html |
| Google OAuth verification | PENDING | Needs Privacy Policy + Terms pages first |

---

## 2. What Was Built This Session

| # | Feature / Fix | Revision | Detail |
|---|---------------|----------|--------|
| 1 | SENT folder scan | 00124 | Switched from INBOX to SENT — carrier emails brokers, not the reverse |
| 2 | Thread-local Anthropic fix | 00124 | Root cause of 100% enrichment failure: shared singleton → empty content[]. Fixed: new client per thread |
| 3 | Markdown fence strip | 00124 | Claude wraps JSON in ```json — strip before json.loads() |
| 4 | Unified Claude prompt | 00126→revert | Split prompt destroyed company fill (97%→26%) — unified prompt is correct |
| 5 | Lane capture | 00128 | origin + destination extracted from outbound bid email context (first 30 lines) |
| 6 | touch_count | 00130 | Counts total SENT emails per broker — relationship depth indicator |
| 7 | Schema cleanup | 00131 | DROP city, DROP state; ADD title VARCHAR(25), ADD touch_count INTEGER |
| 8 | Carrier identity filter | 00132 | Nulls name/phone/company if matches carrier's own info — dynamic per carrier_id |
| 9 | Domain token derivation | 00134 | Strip freight suffixes from email domain → unique brand prefix (xtxtransport → xtx) |
| 10 | Gentle quote stripper | 00127 | Only cuts on `---Original Message---` and `On [date] wrote:` |
| 11 | 30-line sent_context | 00128 | Was 12 lines — captures company info that appears deeper in bid emails |

---

## 3. Best Fill Rates Achieved — Revision 00128

| Field | Fill Rate | Notes |
|-------|-----------|-------|
| company | 93% | Best field — usually in sent email context |
| name | 92% | Limited by bid-only brokers (no INBOX reply = no signature) |
| title | 78% | Available in most signatures |
| origin | 71% | From lane context in outbound bid emails |
| destination | 69% | From lane context in outbound bid emails |
| phone | 53% | Ceiling — mobile-only rule + ~50% of brokers never replied |
| last_contacted | 100% | From Date header |
| touch_count | 100% | Counted from SENT scan |

Phone ceiling ~53% is near realistic maximum. Not a bug — it's a data availability limit.

---

## 4. IMMEDIATE ACTION — Brokers Table is Empty

The 00134 run was in progress when the session paused for Anthropic rate-limit cooldown. The table has zero rows.

**Before re-running — apply unique constraint:**
```sql
ALTER TABLE brokers ADD CONSTRAINT brokers_carrier_email_unique UNIQUE (carrier_id, email);
```
This prevents duplicate rows on re-runs (INSERT will skip on conflict).

**Then re-run:**
- Go to dashboard → trigger /extract-brokers for Ken's carrier_id
- Or POST directly: `curl -X POST https://edgeai-gmail-webhook-[hash].run.app/extract-brokers -H "Content-Type: application/json" -d '{"carrier_id":"86fbcaf8-57fe-4f57-8388-10be3ec99e6c"}'`

**Expected:** ~147 broker rows, fill rates matching 00128 baseline.
**Check contamination after run:**
```sql
SELECT * FROM brokers WHERE phone LIKE '%8688' OR company ILIKE '%XTX%' OR name ILIKE '%Korbel%';
```
Should return 0 rows if domain token filter is working.

---

## 5. Priority Queue — Next Session

### Priority 1 — Re-run /extract-brokers (IMMEDIATE)
- Apply unique constraint first (SQL above)
- Trigger run from dashboard
- Verify fill rates and contamination count

### Priority 2 — Telnyx SMS (BLOCKER for live product value)
- Set up Telnyx account
- Wire into `services/gmail-webhook/main.py` — replace Twilio references
- Test inbound SMS (Pass/Book/Call parsing) + outbound SMS (load_offer alert)
- Flip `SMS_ENABLED=true` only after both confirmed end-to-end

### Priority 3 — Supplementary INBOX Scan
- Separate scan: INBOX emails FROM addresses not yet in brokers table
- Catches anonymous inbound load offers carrier never replied to
- These are the most valuable — broker reached out proactively
- Insert with status='cold', source='inbox_scan'
- Note: this is separate from the SENT scan — runs after

### Priority 4 — Stripe Webhook Fix (OPEN BUG)
- `dashboard/api/stripe-webhook.js` — email match race condition on OTP signups
- Fix: upsert on email or confirm carriers row creation timing

### Priority 5 — Onboarding Required Fields
- Add `owner_name`, `phone`, `company_name` as required on /onboard step 1
- These feed the carrier identity filter in extract-brokers for all carriers
- Currently null for Ken — filter falls back to domain token

### Priority 6 — Founder Account Activation
```sql
UPDATE carriers SET subscription_status = 'active', subscription_tier = 'base'
WHERE id = '<Ken auth.users.id>';
```

### Priority 7 — Dashboard Live Data Wiring
- Broker table → live Supabase query by carrier_id
- Sidebar counts → live brokers + unknown_brokers_inbox
- Focus zone input → PATCH carriers table
- ACE status dot → subscription_status

### Priority 8 — outreach_log Table
```sql
CREATE TABLE outreach_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id UUID REFERENCES carriers(id),
  broker_id UUID REFERENCES brokers(id),
  load_origin TEXT,
  load_destination TEXT,
  offered_rate NUMERIC,
  pickup_date DATE,
  miles INTEGER,
  carrier_response TEXT, -- pass / book / call
  responded_at TIMESTAMPTZ,
  auto_email_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Priority 9 — ACE Morning Brief Wiring
- n8n trigger → Cloud Run or Supabase function
- Inbound SMS parser end-to-end test (city/state/ZIP → active_focus_zip)

### Priority 10 — Infrastructure (Before public launch)
- Privacy Policy page — required for Google OAuth verification
- Terms of Service page — required for Google OAuth verification
- Google OAuth verification submission
- Stripe flip to live mode — Ken instructs when ready

---

## 6. Open Bugs

| Bug | Severity | File | Status |
|-----|----------|------|--------|
| STRIPE_WEBHOOK_SECRET missing from Cloud Run | Medium | Cloud Run env | OPEN |
| Stripe webhook email match race condition (OTP signup) | Medium | dashboard/api/stripe-webhook.js | OPEN |
| Brokers table empty (00134 run incomplete) | High | Supabase brokers table | NEEDS RE-RUN |
| Ken carrier row: owner_name/phone/company_name null | Low | Supabase carriers table | Blocked on onboarding flow |

---

## 7. Carrier Identity Filter — How It Works

This is important for multi-carrier SaaS scale. Every carrier has their own identity isolated:

```
For any carrier running /extract-brokers:
  1. Fetch carriers row → owner_name, phone, company_name
  2. If null → derive from email domain:
       domain = email.split("@")[1].split(".")[0]
       strip FREIGHT_SUFFIXES regex
       unique_token = result (min 2 chars)
  3. Filter enriched fields:
       name: null if overlaps with owner_name tokens
       phone: null if last 7 digits match carrier phone
       company: null if unique_token is substring of enriched company
```

Works for any carrier the moment they complete onboarding with owner_name + phone + company_name. Ken falls back to domain token `xtx` because his onboarding fields are null.

---

## 8. Load Opportunity SMS Loop — Design Note

Future carriers don't review and decide manually — ACE does the routing. The flow is:

1. Broker emails a load offer (inbound to carrier's Gmail)
2. ACE classifies as `load_offer`
3. ACE SMS to carrier: origin → dest, rate, pickup date, mileage, broker name (≤160 chars)
4. Carrier replies: **Pass**, **Book**, or **Call** (one word)
5. EDGE receives via Telnyx inbound webhook
6. Book → auto-email to broker: "Taking it. MC#XXXXX." Log to outreach_log.
7. Pass → log to outreach_log, no email
8. Call → log to outreach_log, no auto-email — carrier calls manually

Rate, pickup dates, mileage all come from the original broker email (Claude extraction on inbound classify step — needs to be added to inbound classify prompt).

---

## 9. Standing Rules — All Active

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
- `gmail_service()` must never cache globally — build fresh on every call
- Anthropic client must never be shared across threads — create fresh per thread
- gcloud account: ken@xedge-ai.com (not korbs827@gmail.com)

---

## 10. Infrastructure Notes

- Gmail Watch expires every 7 days — Cloud Scheduler calls `/renew-watches` weekly
- All Pub/Sub deliveries must always return HTTP 200 — non-200 causes infinite retry loops
- `trailingSlash: false` in vercel.json — required for Stripe and Pub/Sub POST endpoints
- `routes` and `rewrites` cannot coexist in vercel.json — use only `rewrites` + `redirects`
- deploy.sh auto-sources `.env` — all secrets inject on deploy
- **Active revision:** 00134
- **Best extract-brokers revision:** 00128
- **Stable fallback (pre-extract):** 00107-hk2
- **Git fallback:** `git checkout 2c4a409 -- services/gmail-webhook/main.py`
- **Latest master commit:** 9075c8e — feat: touch_count, carrier identity filter, dynamic domain token

---

*XEdge Transition Note | May 4 2026 | XTX LLC*
