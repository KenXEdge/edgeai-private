# BEON / NTG Load Alert Automation
## Session Note | April 27 2026 | XEdge / XTX LLC

---

## Problem Statement

NTG (Next Truck Group) / BEON Carrier Portal sends automated load alert emails to carriers. Dozens of dispatchers compete for the same loads simultaneously. No bidding war — first carrier to click Book at the posted rate wins. Competing dispatchers do this as their full-time job. Owner-operators cannot compete manually.

Core opportunity: ACE receives the alert, parses it in seconds, and either fires a structured SMS to the carrier with a deep link to the load, or auto-books it entirely — faster than any human dispatcher.

---

## Why Not Direct API

NTG/BEON will not provide API access to independent carriers. Not a viable path. Inbound email parsing is the selected approach.

---

## Full Pipeline Architecture

NTG load alert email → loads@xtxtec.com
→ Cloud Run /inbound-load-alert parses email via Claude Haiku
→ Extracts: origin, destination, rate, miles, load ID, equipment type
→ Carrier rules check: lane match, rate floor, equipment type
→ Decision: Book / Alert / Skip
→ [Alert mode] SMS to carrier + BEON deep link
→ [Auto-book mode] Chrome Extension or Playwright fires booking
→ Confirmation SMS to carrier
→ load_alerts table updated

---

## Phase 1 — Parse + Speed Alert
Build first. No 2FA dependency.
- loads@xtxtec.com inbound catch-all
- Cloud Run /inbound-load-alert endpoint
- Claude Haiku parses NTG email format
- Carrier rules check vs carriers row
- SMS fires structured load summary + BEON deep link in under 10 seconds
- load_alerts table logs every alert and outcome

---

## Phase 2 — Chrome Extension Auto-Book (Primary Path)
- Carrier installs XEdge Chrome Extension (Manifest V3)
- Carrier logs into BEON once in their own browser — handles 2FA naturally
- ACE parses alert → signals extension via XEdge API
- Extension navigates to load, auto-fills driver name + truck number, clicks Book
- Confirmation fires back to Cloud Run → SMS to carrier
- No BEON credentials stored on XEdge backend
- Carrier explicit opt-in required

---

## Phase 3 — Playwright Session Persistence (Fallback)
- Playwright on Cloud Run holds authenticated BEON session via stored cookie
- Session health check job — re-auth SMS prompt when session expires
- Higher ToS risk — carrier accepts at opt-in
- Use only for carriers who will not install Chrome Extension

---

## 2FA Barrier
BEON uses mobile TOTP authenticator. Playwright cannot intercept rotating codes. Session persistence is the only server-side path. Chrome Extension eliminates the problem — carrier's own browser holds the session, 2FA handled at initial login.

---

## New carriers Table Fields
- beon_username
- beon_password (encrypted)
- driver_name
- truck_number
- trailer_number
- auto_book_enabled (boolean)
- auto_book_rate_floor (numeric)
- auto_book_lanes (jsonb)
- beon_session_cookie (encrypted)
- beon_session_expires_at (timestamp)

---

## New Table — load_alerts
id, carrier_id, received_at, origin, destination, rate, miles, load_id, equipment_type, decision, outcome, booked_at

---

## New Cloud Run Endpoint
/inbound-load-alert — receives forwarded NTG email, parses, runs rules check, fires SMS or triggers auto-book

---

## Risk Register
- BEON ToS violation — High — explicit carrier opt-in with disclosure
- Bot detection — Medium — Chrome Extension uses real browser, not detectable
- Wrong load booked — High — alert_and_confirm default, auto_book per-lane opt-in
- Credential exposure — High — encrypted at rest, never logged
- Session timeout — Medium — health check + re-auth SMS, Chrome Extension eliminates
- NTG email format change — Low — Claude prompt flexible

---

## References
- PRD v4.5 Section 12
- carriers table migration required before Phase 1
- load_alerts table migration required before Phase 1
- Telnyx must be live before Phase 1 delivers full SMS value

---

*BEON AutoBook Session Note | April 27 2026 | XEdge / XTX LLC*
