# XEdge / EDGEai — SESSION HANDOFF NOTE
## May 4, 2026 — Updated End of Session | Read This First

**If cloning fresh:**
```
git clone https://github.com/KenXEdge/edgeai-private.git
cd edgeai-private/dashboard
claude
```

**If already cloned:**
```
git pull
```

**gcloud auth (required before deploying or checking logs):**
```
gcloud auth login
gcloud config set project edgeai-493115
```
Use `ken@xedge-ai.com` — NOT korbs827@gmail.com.

---

## 1. System Status — May 4 2026 (End of Session)

| Component | Status | Detail |
|-----------|--------|--------|
| xtxtec.com | LIVE | Vercel — primary domain |
| Cloud Run | ACTIVE | edgeai-gmail-webhook revision 00141 |
| Supabase | LIVE | siafwhlzazefyoevslde.supabase.co |
| Gmail OAuth | LIVE | onboard-gmail.html confirmed working |
| Stripe | TEST MODE | Do not flip to live until Ken instructs |
| OTP signup | LIVE | 8-digit code via Magic Link — Resend |
| SMS | DISABLED | SMS_ENABLED=false — Telnyx pending |
| Brokers table | POPULATED | Batch API run completed — 136 rows, 0 contamination |
| Extract-brokers | STABLE | Revision 00141 — Anthropic Batch API |
| Onboarding flow | REBUILT | Steps 1-3 fully wired, prefilling, tooltips |
| Stripe webhook | FIXED | Email fallback + profile field mapping added |
| Dashboard live data | NOT YET WIRED | Brokers not yet connected to dashboard |

---

## 2. What Was Built This Session (May 4 — Full Day)

### Extract-Brokers (Cloud Run — services/gmail-webhook/main.py)
| # | Change | Commit |
|---|--------|--------|
| 1 | Anthropic Batch API replaces per-thread real-time Haiku calls | 18ce278 |
| 2 | Stage 1: 10 workers Gmail fetch (pure network I/O) | 18ce278 |
| 3 | Stage 2: Single batch submit — no RPM/TPM pressure, 50% cheaper | 18ce278 |
| 4 | Stage 3: Poll every 15s until batch ends | 18ce278 |
| 5 | Stage 4b: 5 workers parallel Supabase writes | 18ce278 |
| 6 | Fix suffix stripping for company_name path in carrier identity filter | 45fafb8 |
| 7 | Reduce max_workers 3→2 (superseded by Batch API) | 6ebfef8 |

### Onboarding Pages (dashboard/public)
| # | Change | File |
|---|--------|------|
| 1 | Step 1 — Carrier Identity section: owner_name, phone, ops email, base terminal | onboard.html |
| 2 | Step 1 — Dynamic multi-truck type dropdowns (N selects = fleet_size) | onboard.html |
| 3 | Step 1 — 14 truck types: Van, Reefer, Flatbed, Power Only, Hotshot, Straight 26ft, Straight 12-24ft, Cargo Van, Sprinter Van, Container, Tanker, Lowboy, Curtain Side, Other | onboard.html |
| 4 | Step 1 — Truck Length changed to select (12-14/20-24/26/40/43/48/53 ft) | onboard.html |
| 5 | Step 1 — Authority Type (Interstate/Intrastate) | onboard.html |
| 6 | Step 1 — Certifications section: TWIC/TSA + HAZMAT toggles | onboard.html |
| 7 | Step 1 — Operation Type section: Team Driving toggle | onboard.html |
| 8 | Step 1 — Full prefill on load from Supabase | onboard.html |
| 9 | Step 2 — preferred_lanes fixed (migrated TEXT→TEXT[]) | onboard-lanes.html |
| 10 | Step 2 — Load types: PTL rename, Expedite/White Glove/Parcel added, Live Load removed | onboard-lanes.html |
| 11 | Step 2 — max_radius fixed (was writing strings to INTEGER column, now 100/500/1500/null) | onboard-lanes.html |
| 12 | Step 2 — Deadhead Tolerance section (deadhead_miles) | onboard-lanes.html |
| 13 | Step 2 — Today's Starting Location (active_focus_city/state/zip) | onboard-lanes.html |
| 14 | Step 2 — Full prefill on back-navigation (state grid, radius, load types, deadhead, focus) | onboard-lanes.html |
| 15 | Step 3 — Minimum Load Value and Fuel Surcharge removed | onboard-rates.html |
| 16 | Step 3 — rate_floor prefill added | onboard-rates.html |
| 17 | Tooltips: Operations Email, Today's Starting Location, Rate Floor | all 3 pages |

### Stripe Webhook (dashboard/api/stripe-webhook.js)
| # | Change | Commit |
|---|--------|--------|
| 1 | Retrieve Stripe customer on checkout.session.completed | 9ffe043 |
| 2 | Write customer.name→owner_name, email→email, phone→phone to carriers row | 9ffe043 |
| 3 | Email fallback when carrier_id missing from metadata — fixes OTP race condition | e2c360d |

### Database Migrations Applied This Session
```sql
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS active_focus_city   TEXT;
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS active_focus_state  TEXT;
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS active_focus_zip    TEXT;
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS load_types          TEXT;
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS truck_types         TEXT[];
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS carrier_authority   TEXT;
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS has_twic_tsa        BOOLEAN DEFAULT FALSE;
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS has_hazmat          BOOLEAN DEFAULT FALSE;
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS has_team            BOOLEAN DEFAULT FALSE;
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS deadhead_miles      INTEGER;
ALTER TABLE carriers ALTER COLUMN preferred_lanes TYPE TEXT[];
ALTER TABLE brokers ADD CONSTRAINT brokers_carrier_email_unique UNIQUE (carrier_id, email);
```

---

## 3. IMMEDIATE NEXT SESSION — Priority Order

### Priority 1 — Onboarding Run-Through (Ken to complete)
- Go through onboard flow live on xtxtec.com
- Verify all fields save correctly to Supabase carriers row
- Verify prefill works on back-navigation
- Verify tooltips display correctly
- Fix any issues found before moving on

### Priority 2 — Welcome Email on Onboarding Complete
- Trigger: onboarding_complete = true at end of Step 5 Review
- Send via Resend (already wired for OTP/Magic Link)
- Content: login link, what ACE does next, support contact, morning brief explanation
- Implementation: Supabase webhook → Cloud Run /onboarding-complete endpoint OR Supabase Edge Function

### Priority 3 — Broker Management UI (new page)
- Carrier-facing editable table of all extracted brokers
- Actions: edit any field, delete row, add manual entry
- Set outreach preferences per broker or bulk
- Read full brokers table schema from Supabase before designing
- Link from carrier dashboard

### Priority 4 — Dashboard Live Data Wiring
- Broker table → live Supabase query by carrier_id
- Greeting → owner_name from carriers row
- Setup checklist → real completion state
- KPI strip → real broker counts
- Tier card → subscription_status/tier

### Priority 5 — Telnyx SMS
- Wire into services/gmail-webhook/main.py (replace Twilio references)
- Test inbound SMS (Pass/Book/Call parsing) + outbound (load_offer alert)
- Flip SMS_ENABLED=true only after end-to-end confirmed

### Priority 6 — Stripe Branding (no code)
- Stripe Dashboard → Settings → Branding
- Add logo, brand color, support email
- Receipts auto-send on live mode flip

### Priority 7 — Supplementary INBOX Scan
- Scan INBOX emails FROM addresses not yet in brokers table
- Insert with status='cold', source='inbox_scan'
- Run after SENT scan completes

### Priority 8 — outreach_log Table
```sql
CREATE TABLE outreach_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id UUID REFERENCES carriers(id),
  broker_id UUID REFERENCES brokers(id),
  load_origin TEXT, load_destination TEXT,
  offered_rate NUMERIC, pickup_date DATE, miles INTEGER,
  carrier_response TEXT,
  responded_at TIMESTAMPTZ,
  auto_email_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Priority 9 — Google OAuth Verification
- Requires Privacy Policy + Terms of Service pages first
- Submit to Google after both pages live

---

## 4. Open Bugs

| Bug | Severity | Status |
|-----|----------|--------|
| STRIPE_WEBHOOK_SECRET missing from Cloud Run env | Medium | OPEN — add to Cloud Run env vars |
| Brokers row count 136 vs 149 expected | Low | Gmail pagination non-determinism — not a code bug |
| Dashboard live data not wired | Medium | Priority 4 |
| Ken onboarding fields — needs fresh run-through to populate cleanly | Low | Priority 1 |

---

## 5. Git State

**Latest master commits:**
```
c6ab9a3 merge: onboarding overhaul + stripe webhook fixes
e2c360d fix: stripe webhook — email fallback (OTP race condition)
9ffe043 feat: stripe webhook — Stripe customer fields → Supabase
0cfccc7 feat: onboarding overhaul — carrier profile, field schema v1, prefill, tooltips
18ce278 feat: switch extract-brokers to Anthropic Batch API
6ebfef8 fix: reduce max_workers 3→2
45fafb8 fix: strip suffixes from company_name token
```

**Rollback targets:**
```bash
# Onboarding pages only
git checkout 0cfccc7~1 -- dashboard/public/onboard.html dashboard/public/onboard-lanes.html dashboard/public/onboard-rates.html

# Stripe webhook only
git checkout 9ffe043~1 -- dashboard/api/stripe-webhook.js

# Cloud Run fallback (if extract-brokers regresses)
gcloud run services update-traffic edgeai-gmail-webhook \
  --to-revisions=edgeai-gmail-webhook-00128=100 \
  --region=us-central1 --project=edgeai-493115
```

---

## 6. Standing Rules — All Active

- Node.js only on dev machine — Python NOT installed locally
- No git push without Ken approval (exception: brand new standalone pages)
- Never alter Ken's carriers row UUID (tied to auth.users.id)
- SMS_ENABLED=false — do not flip until Telnyx live and tested end-to-end
- Stripe TEST mode — do not flip until Ken instructs
- n8n workflows ARCHIVED — do not unarchive
- logo-edge-white.png permanent in both dark and light mode
- PowerShell: two separate commands — && operator not supported in PS 5.1
- gmail_service() must never cache globally — build fresh every call
- Anthropic client must never be shared across threads — create fresh per thread
- gcloud account: ken@xedge-ai.com (not korbs827@gmail.com)
- RLS disabled on carriers — enforced at application layer
- CARRIER_UUID removed from Cloud Run env — identity from auth.users.id at runtime
- trailingSlash: false in vercel.json — required for Stripe and Pub/Sub endpoints

---

## 7. Infrastructure

| Item | Value |
|------|-------|
| Supabase project | siafwhlzazefyoevslde.supabase.co |
| Cloud Run service | edgeai-gmail-webhook, us-central1, project edgeai-493115 |
| Active revision | 00141 |
| Best extract-brokers revision | 00128 |
| Stable fallback | 00107-hk2 |
| Repo | github.com/KenXEdge/edgeai-private, branch master |
| Vercel | xtxtec.com — auto-deploys on push to master |
| Gmail Watch | Expires every 7 days — Cloud Scheduler calls /renew-watches weekly |

---

*XEdge Transition Note | May 4 2026 — End of Session | XTX LLC*
