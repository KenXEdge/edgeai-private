# ACE Load Capture — Sylectus Extension
## Complete Build Handoff Document
**Date:** 2026-05-08  
**Author:** Claude Code (claude-sonnet-4-6)  
**Carrier:** XTX Transport — Ken Korbel  
**Extension Location:** `C:\Users\korbs\EDGEai\sylectus-extension\`

---

## 1. Project Overview

ACE (Agentic Carrier Employee) is a Chrome Extension (Manifest V3) that autonomously watches the Sylectus freight load board 24/7 without the carrier needing to be at the desk. It:

1. Logs into Sylectus automatically (corp + user password)
2. Searches for loads matching configured criteria (from city/state, to states, miles, weight, load type)
3. Detects qualifying loads, extracts broker contact info from broker profile pages
4. Pops up an alert window (bid popup) with load details, suggested rate, and Pass / Draft / Send buttons
5. Sends a pre-formatted bid email via Gmail (Draft or Send Now) with one click
6. Maintains its own session — keeps Sylectus alive, auto-dismisses inactivity modals, auto-recovers from session termination

**Carrier credentials hardcoded in extension:**
- Corporate ID: 2325803
- Username: `sni`
- Passwords stored in `chrome.storage.local` (entered via Settings popup)

---

## 2. File Inventory

```
sylectus-extension/
├── manifest.json              Chrome MV3 manifest
├── background.js              Service worker — alarms, messaging, Gmail, bid popup, ACE window
├── content.js                 Content script — runs on all Sylectus pages, login/scan/extract logic
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── popup/
    ├── settings.html          Extension toolbar popup — config UI
    ├── settings.js            Settings popup logic
    ├── bid-popup.html         Bid alert window — shown when a load is captured
    ├── bid-popup.js           Bid popup logic
    ├── ace-board.html         *** NEW — ACE Load Board dashboard (full window) ***
    └── ace-board.js           *** NEW — Board logic ***
```

---

## 3. Manifest (manifest.json)

```json
{
  "manifest_version": 3,
  "name": "ACE Load Capture — Sylectus",
  "version": "2.0.0",
  "permissions": [
    "storage", "alarms", "notifications", "identity",
    "tabs", "windows", "system.display"
  ],
  "host_permissions": [
    "https://www6.sylectus.com/*",
    "https://gmail.googleapis.com/*",
    "https://oauth2.googleapis.com/*"
  ],
  "background": { "service_worker": "background.js" },
  "content_scripts": [{
    "matches": ["https://www6.sylectus.com/*"],
    "js": ["content.js"],
    "run_at": "document_idle",
    "all_frames": true
  }],
  "action": {
    "default_popup": "popup/settings.html",
    "default_title": "ACE Settings"
  },
  "oauth2": {
    "client_id": "417422203146-3g9uedcbh00gfg8polhslcdmj2lvoa4f.apps.googleusercontent.com",
    "scopes": [
      "https://www.googleapis.com/auth/gmail.compose",
      "https://www.googleapis.com/auth/gmail.send"
    ]
  }
}
```

**Critical:** `"system.display"` was added this session. Without it, the bid popup window positioning fails silently and the popup appears in the taskbar but not on screen.

---

## 4. Sylectus Page Architecture

Sylectus uses ASP.NET WebForms with a two-frame structure:

```
Main.aspx  (outer frame — session manager, inactivity modal lives here)
  └── II14_managepostedloads.asp  (inner iframe — the actual load board table)
```

**Critical URLs:**
| URL | Purpose |
|-----|---------|
| `https://www6.sylectus.com/Login.aspx` | Corporate login (step 1) |
| `https://www6.sylectus.com/Login.aspx` with user select | User login (step 2) |
| `https://www6.sylectus.com/Login.aspx?sharing=true` | **Multi-session termination page** |
| `https://www6.sylectus.com/Main.aspx?page=II14_managepostedloads.asp?loadboard=True` | Load board |
| Broker profile URLs (varies) | Contains broker name/phone/email — opened as background tab |

**Content script runs with `all_frames: true`** — it injects into both Main.aspx and the inner iframe. Each frame instance runs its own `init()`.

**CRITICAL ARCHITECTURAL LESSON:**  
Never use `fetch()` to load Sylectus profile URLs from the content script. Doing so hits Sylectus's `isloggedin.asp` session check and corrupts the ASP session (causes "ASP 0156 Header Error"). The fix: open real background Chrome tabs instead — `chrome.tabs.create({ url: profileUrl, active: false })` — let the content script run on that page, extract the data, and close the tab.

---

## 5. Last Known Working State (Gold Standard Checkpoint)

**These features were confirmed working BEFORE the multi-session handling work:**

- ✅ Auto-login (corporate + user passwords)
- ✅ Load board search with from city/state, to states
- ✅ Load type filtering (exact match — Expedited Load, Small Straight, Large Straight, etc.)
- ✅ Load scanning — iterates all rows in the board
- ✅ Miles/weight/state filters applied correctly
- ✅ Broker profile URL extraction from the red hotlink column
- ✅ Background tab opens for profile page, content script extracts broker name/phone/email, tab closes
- ✅ Bid popup appears top-right of screen (after adding `system.display` permission)
- ✅ Pass / Draft / Send Now buttons functional
- ✅ Gmail draft creation and send-now via Gmail API
- ✅ Inactivity modal ("Wait, I'm still here!") auto-dismissed
- ✅ Activity poller keeps session alive every 60s
- ✅ Processed load dedup (4-hour TTL via `chrome.storage.local`)
- ✅ Popup dedup — same order# suppressed for 4 hours

**Commit/state marker:** The last stable commit before degradation was immediately after adding `"system.display"` to manifest.json and the bid popup positioning fix in `openBidPopup()`.

---

## 6. What Was Added / Changed This Session (After Gold Standard)

### 6A. ACE Load Board (NEW — untested end-to-end)
**Files:** `popup/ace-board.html`, `popup/ace-board.js`  
**Changes to background.js:**
- `getOrCreateAceWindow()` — creates/reuses a dedicated Chrome window for ACE tabs
- `createAceWindow()` — opens `ace-board.html` as the first tab, minimized, 1280×900
- `addToBoardLoads()` — pushes captured load to `ace_board_loads` array in storage (max 50)
- `open_profile_tab` handler now routes profile tabs into the ACE window (`windowId` param)
- `load_captured` handler now also calls `addToBoardLoads()` before opening bid popup
- `open_board` message handler — raises/creates the ACE window

**Changes to settings.html/js:**
- Added "⊞ Open Load Board" button — sends `open_board` message to background

**Board features:**
- Tile grid view + list view toggle
- Live updates via `chrome.storage.onChanged`
- Each tile has inline bid input + Pass / Draft / Send buttons
- "Clear All" button
- Loads stored in `ace_board_loads` in chrome.storage.local

### 6B. Multi-Session Auto-Recovery (PARTIALLY WORKING — needs verification)
**Problem:** Sylectus shows `Login.aspx?sharing=true` when it detects two concurrent sessions. Session is terminated — user cannot recover without being at the machine.

**What was implemented:**

In `content.js` `init()` — URL check at top of function:
```js
if (window.location.href.toLowerCase().includes('login.aspx') &&
    window.location.href.toLowerCase().includes('sharing=true')) {
  console.log('[ACE] Multi-session page — navigating to Login.aspx for re-login');
  window.location.href = 'https://www6.sylectus.com/Login.aspx';
  return;
}
```

In `dismissInactivityModal()` `scanDoc()` — URL check for inner iframe context:
```js
try {
  const topUrl = (window.top.location.href || '').toLowerCase();
  if (topUrl.includes('login.aspx') && topUrl.includes('sharing=true')) {
    setTimeout(() => {
      try { window.top.location.href = 'https://www6.sylectus.com/Login.aspx'; } catch(e) {}
    }, 500);
    return 'multi_session';
  }
} catch(e) { /* cross-origin guard */ }
```

**Recovery chain (intended):**
1. Sylectus redirects to `Login.aspx?sharing=true`
2. Content script detects URL → navigates to `Login.aspx`
3. `init()` on clean login page → `isCorporateLoginPage()` → auto-submits corp password
4. → `isUserLoginPage()` → auto-submits user password
5. → load board loads → scanning resumes

**Known issue:** A syntax error (curly quotes U+2018/U+2019 substituted for ASCII single quotes) was introduced and fixed at the end of the session. The fix: ran a Node.js script to replace all U+2018/U+2019 characters with ASCII `'` throughout content.js. Verified with `node --check`. **The extension needs to be reloaded and the multi-session recovery path needs to be tested end-to-end.**

---

## 7. Current Known Issues / Pending Verification

| Issue | Status | Notes |
|-------|--------|-------|
| Multi-session recovery flow | **Needs testing** | Code is in place, syntax fixed, but not confirmed working |
| ACE Board end-to-end | **Untested** | Built this session, never confirmed loads appear and bid actions work |
| Profile tab routing to ACE window | **Untested** | background.js routes via `getOrCreateAceWindow` — needs confirmation |
| `_corpLoginAttempted` flag | **Watch out** | Set to `true` on first attempt, never reset — if corp login fails and page reloads, the second attempt won't fire. May need reset logic. |

---

## 8. chrome.storage.local Key Reference

| Key | Type | Purpose |
|-----|------|---------|
| `sylectus_corp_password` | string | Corporate password (entered in settings) |
| `sylectus_password` | string | User (sni) password (entered in settings) |
| `sylectus_tab_id` | number | ID of the main Sylectus tab |
| `ace_paused` | boolean | Whether ACE scanning is paused |
| `rpm` | string | Rate per mile for bid calculation (default 2.75) |
| `search_from_city` | string | Search origin city |
| `search_from_state` | string | Search origin state (2-letter) |
| `search_to_states` | array | Delivery state filter (parsed from comma-separated) |
| `search_to_states_raw` | string | Raw comma-separated to-states input |
| `bid_radius` | string | Max miles filter |
| `max_weight` | string | Max weight filter (lbs) |
| `target_load_types` | array | Load types to alert on (e.g. ["expedited load","small straight"]) |
| `ace_processed_loads` | object | `{ orderNo: timestamp }` — dedup map with 4hr TTL |
| `ace_popup_shown` | object | `{ orderNo: timestamp }` — popup dedup, 4hr TTL |
| `ace_pending_load` | object | Load awaiting broker profile extraction |
| `pending_bid_load` | object | Load data for bid popup |
| `ace_board_loads` | array | Up to 50 captured loads for the ACE Board |
| `contacted_brokers` | array | Log of brokers emailed |
| `gmail_token` | string | Cached Gmail OAuth token |
| `ace_window_id` | number | Chrome window ID of the ACE Board window |

---

## 9. Content Script — Key Functions Reference

### Page Detection
```js
isCorporateLoginPage()   // password field, no select, no "SELECT USER"
isUserLoginPage()        // has select + password field
isLoadBoardPage()        // URL includes 'ii14_managepostedloads'
isOrderProfilePage()     // URL includes profile/broker keywords OR DOM has EMAIL+PHONE
```

### Login Flow
```js
doCorporateLogin(corpPassword)
// 1. Finds password field (skips reset modal fields)
// 2. Tries form.defaultButton → __doPostBack → login-word scan → Enter key
// Has _corpLoginAttempted guard — resets needed if corp login fails

doUserLogin(userPassword)
// 1. Selects 'sni' from user dropdown
// 2. Fills password field
// 3. Tries defaultButton → __doPostBack scan → Enter key
```

### Session Keepalive
```js
startActivityPoller()
// Runs every 60s: simulateActivity() — dispatches mousemove/keypress to document + parent frames
// Runs every 5s: dismissInactivityModal() — checks all frames + parent frames
// Patches window.confirm = () => true on all reachable frames

simulateActivity()
// Dispatches to [document, window.parent.document, window.top.document]
// Overrides confirm() on window, parent, top
```

### Modal Dismissal
```js
dismissInactivityModal()
// scanDoc() checks: inactivity text + multi-session URL + multi-session DOM text
// Scans: current doc, child iframes, window.parent.document, window.top.document
// Multi-session URL: navigates window.top to Login.aspx (does NOT reload — reload loops)
// Returns truthy on any match
```

### Load Scanning
```js
scanLoadBoard(settings)
// Iterates all <tr> rows in the results table
// Extracts: order_no, load_type, miles, weight, pickup/delivery city/state/date, broker href
// Applies filters: load type (exact match), max miles, max weight, to-state
// Calls processLoad() for each qualifying unprocessed load

processLoad(load, settings)
// Calculates suggested rate (miles × RPM)
// If broker_href: stores ace_pending_load, sends open_profile_tab to background
// If no broker_href: sends load_captured directly
```

### Profile Extraction
```js
extractAndStoreOrderProfile()
// Runs on broker profile pages (opened as background tabs)
// getField(...labels) — searches td pairs for field labels, tries multiple label variants
// Extracts: broker_name, broker_phone, broker_email, order_no, miles, weight, notes
// Merges with ace_pending_load from storage
// Sends load_captured to background → background calls addToBoardLoads + openBidPopup
// Removes ace_pending_load, closes the tab after 500ms
```

### Self-Healing
```js
selfHeal(settings)
// Triggered after 3 consecutive empty scans
// Dismisses modal → resets searchComplete → re-runs setupSearch + scanLoadBoard

// After modal dismissal (inactivity), poller also calls:
searchComplete = false;
getSettings().then(s => setupSearch(s));
```

---

## 10. Background Service Worker — Key Functions

### openBidPopup(load, suggestedRate)
```js
// Dedup check — suppresses same order# for 4 hours (ace_popup_shown)
// Gets display info via chrome.system.display.getInfo()
// Positions popup top-right: left = screenWidth - 460, top = 20
// chrome.windows.create({ type: 'popup', width: 440, height: 680, focused: true })
// After 150ms: chrome.windows.update(win.id, { focused: true, state: 'normal' })
// (Overcomes Windows focus-stealing prevention)
```

### Gmail Flow (createGmailEmail)
```js
// 1. Tries stored gmail_token
// 2. Falls back to chrome.identity.getAuthToken({ interactive: false })
// 3. POST to gmail.googleapis.com/v1/users/me/drafts
// 4. On 401: refreshGmailToken (removeCachedAuthToken + getAuthToken) then retry
// 5. If sendNow: POST to /drafts/send
// 6. On send: calls logBrokerContact(load)

buildEmailBody(load, bidAmount, settings)
// Uses load.raw_row_html if available (authentic Sylectus table appearance)
// Falls back to load.raw_row_text in <pre>
// CARRIER object is hardcoded: Ken Korbel / XTX Transport / MC 1610666
// Subject: "CITY STATE to CITY STATE- $amount"
```

### ACE Window Management (NEW this session)
```js
getOrCreateAceWindow(callback)
// Checks ace_window_id in storage
// If exists: chrome.windows.get to verify still open
// If stale/missing: createAceWindow()

createAceWindow(callback)
// chrome.windows.create({ url: ace-board.html, type: 'normal', state: 'minimized' })
// Stores ace_window_id in storage
```

---

## 11. Email Template

**Subject:** `{pickup_city} {pickup_state} to {delivery_city} {delivery_state}- ${bidAmount}`

**Body structure:**
```
QUOTE: ${bidAmount}
MC 1610666

[Raw Sylectus load table row HTML — authentic copy-paste appearance]

*******************
Equipment:
26' Straight,
Dock-high, Air-ride, 3 row e-tracks
Box Door: 94"W x 97"H
Box Interior 98.5"W x 26'L
TWIC
Gear:
Lift gate / Pallet jack / Load bars, Straps, Blankets.

--
Thank you,
Ken Korbel
XTX Transport
Fort Worth, TX
CELL: 972-677-8688
```

---

## 12. Settings UI (popup/settings.html)

Sections:
1. **Sylectus Login** — corp password, user password
2. **Search Parameters** — from city, from state, to states (comma-separated), preview
3. **Bid Filters** — bid radius (max miles), max weight, filter summary
4. **Load Types to Monitor** — 18 checkboxes (exact match values):
   - expedited load, expedited truck load, small straight, large straight
   - cargo van, sprinter, truckload, less than truckload, truckload/ltl
   - courier type work, flatbed, reefer, climate control, air freight
   - air charter, dump trailer, lane/project rfq, other
5. **Rate Calculator** — RPM input, example miles, live equation preview
6. **Actions** — Save, Open Load Board, Connect Gmail OAuth, Pause/Resume ACE

Default load types (if none set): `['expedited load', 'large straight', 'small straight']`

---

## 13. Load Object Schema

The load object passed between content script, background, and popups:
```js
{
  order_no: "330574",
  load_type: "Small Straight",
  miles: "46",
  weight: "9000",
  pickup_city: "LEWISVILLE",
  pickup_state: "TX",
  pickup_date: "05/08",
  delivery_city: "DESOTO",
  delivery_state: "TX",
  delivery_date: "05/08",
  vehicle_size: "Small Straight",
  broker_name: "TRAFFIC TECH, INC.",
  broker_phone: "972-555-1234",
  broker_email: "broker@traffictech.com",
  broker_href: "https://www6.sylectus.com/...",  // URL to broker profile page
  other_info: "NEED 26' BOX TRUCK WITH LIFTGATE", // footnotes/special instructions
  notes: "",
  raw_row_text: "...",   // full row plain text
  raw_row_html: "...",   // full row HTML for email body
  suggested_rate: 127,   // miles × RPM, calculated before popup
  captured_at: 1746720000000  // Date.now() timestamp
}
```

`other_info` / `notes` go through `stripNoise()` which removes: Days to Pay, Credit Score, S.A.F.E.R., TEANA Member, SaferWatch text.

---

## 14. Critical Bugs & Lessons Learned

### Bug: fetch() corrupts ASP session
**Never** call `fetch()` to Sylectus profile URLs from the content script. It hits `isloggedin.asp` and causes ASP 0156 Header Error. Always use `chrome.tabs.create({ url, active: false })`.

### Bug: Curly quotes in JS source
Multiple edits introduced U+2018/U+2019 curly quotes into JavaScript string literals (appeared as `''` visually but were not ASCII `'`). This causes "Invalid or unexpected token" at runtime. **Fix:** Run `node -e "let s=require('fs').readFileSync(f,'utf8');s=s.replace(/'/g,\"'\").replace(/'/g,\"'\");require('fs').writeFileSync(f,s);"` across all JS files whenever a mysterious syntax error appears.

### Bug: Popup not visible on Windows
Windows focus-stealing prevention hides newly created extension popup windows. Fix: use `chrome.system.display.getInfo()` to get actual screen dimensions, position top-right (`left = width - 460, top = 20`), then call `chrome.windows.update(win.id, { focused: true, state: 'normal' })` after 150ms.

### Bug: dismissInactivityModal() reload loop
When multi-session landing page was `Login.aspx?sharing=true`, the handler called `window.top.location.reload()` which reloads the same page — infinite loop. Fix: use `window.top.location.href = 'https://www6.sylectus.com/Login.aspx'` (navigate away, do not reload).

### Bug: `_corpLoginAttempted` flag
`doCorporateLogin()` sets a module-level `_corpLoginAttempted = true` flag to prevent double-submission. However this flag is never reset. If the first login attempt fails silently and the page reloads (without navigating), the second `init()` call will skip corp login entirely. Watch for this in recovery scenarios.

### Bug: Order number detection in multi-line cells
`cell.innerText` for a row can contain `"330574\n11039"`. Checking `cell.innerText` against `/^\d{4,}$/` fails on multi-line content. Fix: split on `\n` and check each line individually.

### Bug: Load type filter substring collision
Using `includes()` for load type matching caused "Van" to pass through when filter was "Cargo Van". Fix: use strict `===` (case-insensitive) exact match.

---

## 15. Resumption Instructions for New Chat

### Step 1 — Load context
Tell the new Claude:
> "I'm continuing the ACE Chrome Extension for Sylectus freight board. All files are at `C:\Users\korbs\EDGEai\sylectus-extension\`. Read the handoff doc at `C:\Users\korbs\EDGEai\ACE_Sylectus_Handoff.md` first. Then read `content.js`, `background.js`, and `popup/bid-popup.js`."

### Step 2 — Immediate verification needed
1. Reload extension in `chrome://extensions` (click refresh icon on ACE card)
2. Open Sylectus — confirm ACE logs in and scans normally
3. Confirm bid popup appears on screen (not just taskbar)
4. To test multi-session recovery: open a second Chrome profile, log into Sylectus with same credentials → triggers "Multiple user sessions" on main tab → confirm ACE navigates to Login.aspx, re-logs in, resumes scanning

### Step 3 — If multi-session recovery still fails
Check the console on `Login.aspx?sharing=true` for:
- `[ACE] init — url:` — confirms content script injected
- `[ACE] Multi-session page — navigating...` — confirms URL check fired
- If neither appears, content script is not injecting — check manifest `matches` pattern

### Step 4 — ACE Board verification
1. Open ACE Settings popup → click "⊞ Open Load Board"
2. Confirm a new Chrome window opens with `ace-board.html` (dark ACE UI)
3. Let ACE capture a load — confirm tile appears in the board in real time
4. Test Pass/Draft/Send from the board tile

### Step 5 — Known issue to watch
`_corpLoginAttempted` flag in content.js line ~209. If auto-login seems to skip after a recovery cycle, this flag may be stuck `true`. The fix: add `_corpLoginAttempted = false;` at the start of the multi-session URL handler in `init()`.

---

## 16. CARRIER Constants (hardcoded in background.js)

```js
const CARRIER = {
  name:     'Ken Korbel',
  company:  'XTX Transport',
  phone:    '972-677-8688',
  mc:       '1610666',
  email:    'contact@xtxtransport.com',
  location: 'Fort Worth, TX'
};
```

---

## 17. Sylectus Login Page HTML Reference

From `Login.aspx?sharing=true` (same structure as clean `Login.aspx`):
```html
<!-- Corporate ID field (pre-filled 2325803) -->
<input id="ctl00_bodyPlaceholder_corporateIdField" type="text" value="2325803">

<!-- Corporate Password field -->
<input id="ctl00_bodyPlaceholder_corpPasswordField" type="password">

<!-- Continue button — it is an <a> tag, not <button> -->
<a id="ctl00_bodyPlaceholder_corpLoginButton"
   href="javascript:__doPostBack('ctl00$bodyPlaceholder$corpLoginButton','')">Continue</a>

<!-- Form default button set via onkeypress -->
<form onkeypress="WebForm_FireDefaultButton(event, 'ctl00_bodyPlaceholder_corpLoginButton')">

<!-- Multi-session alert (Bootstrap dismissible alert) -->
<button type="button" class="close" data-dismiss="alert">
  <span aria-hidden="true">×</span>
  <span class="sr-only">Close</span>
</button>
```

The `Continue` button uses `__doPostBack`. The corp login code handles this via the `defaultbutton` attribute on the form and the `__doPostBack` pattern matcher.

---

*End of handoff document. All files are at `C:\Users\korbs\EDGEai\sylectus-extension\`. Extension must be reloaded after any code change via the refresh icon in `chrome://extensions`.*
