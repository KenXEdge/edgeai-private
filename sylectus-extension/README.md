# ACE Load Capture v2.0 — Sylectus Chrome Extension
## XTX Transport | EDGEai | No SMS Required

---

## What This Does

Autonomous load capture agent for Sylectus. Runs 24/7 on your PC.
No Telnyx/SMS required — uses Chrome popup for bid interaction.

**Autonomous flow:**
1. Opens Sylectus, logs in automatically (Corp: 2325803, User: sni)
2. Dismisses "Wait, I'm still here!" modal automatically
3. Sets search: Expedited + Large Straight + Small Straight | Dallas TX | 50mi | TX + OK
4. Scans every new load posting continuously
5. For each new load — opens Order Profile, extracts broker details
6. **Bid popup opens on your screen** showing full load details
7. You click PASS, DRAFT, or SEND NOW with your rate
8. Email fires to broker instantly from contact@xtxtransport.com

---

## Installation

1. Download and unzip the extension folder
2. Add your 3 icon files to the /icons folder:
   - icon16.png (16x16)
   - icon48.png (48x48)  
   - icon128.png (128x128)
   Use your EDGE logo PNGs
3. Open Chrome → chrome://extensions
4. Enable Developer mode (top right toggle)
5. Click Load unpacked
6. Select the sylectus-extension folder
7. ACE icon appears in Chrome toolbar

---

## Google OAuth Setup (Required for Gmail)

1. Go to console.cloud.google.com
2. Create a project or use existing edgeai-493115
3. Enable Gmail API
4. Create OAuth 2.0 credentials → Chrome Extension type
5. Copy the Client ID
6. Paste it in manifest.json replacing YOUR_GOOGLE_CLIENT_ID
7. Reload the extension

---

## First Time Setup

Click ACE icon → Settings panel opens

**Sylectus Login**
- Corporate Password — update when notified of change
- User Password (sni) — update when notified of change

**Search Parameters**
- From City: Dallas (change via settings or SMS FROM command)
- From State: TX
- To States: TX, OK (comma separated)

**Rate Calculator**
- RPM: 2.75 default

**Carrier Info**
- Name: Ken Korbel
- Company: XTX Transport
- Gmail: contact@xtxtransport.com
- Cell: 972-677-8688
- MC: 1610666

Click Save All Settings
Click Connect Gmail OAuth → authorize in popup

---

## Bid Popup

When a new load is found, a popup appears:

```
⚡ ACE — Load Alert
Grand Prairie, TX → Milburn, OK
PU: 05/06 1:00PM  DEL: 05/06 4:00PM

Miles: 131  |  Small Straight  |  567 lbs
Order: 295671  |  Broker: Express Logistics LLC
pamela@capacityexpress.com  |  95% credit  |  27 day pay

Suggested: $360
[Your bid amount field]

[✕ Pass]  [📋 Draft]  [⚡ Send Now]
```

- **Pass** — dismiss, no email, watch for next load
- **Draft** — creates Gmail draft for review before sending
- **Send Now** — fires email immediately to broker

Keyboard shortcuts:
- Cmd+Enter — Send Now
- Escape — Pass

---

## Password Updates

When you get a password change notification:
1. Click ACE icon in Chrome toolbar
2. Update Corporate Password or User Password field
3. Click Save All Settings
Extension uses new password on next login

---

## Future: Telnyx SMS Layer

When Telnyx is activated:
- SMS fires to your phone instead of popup (or both)
- Reply B [amount] to bid, P to pass
- FROM / TO commands to change search on the fly
- Works when you're away from the PC

---

## Broker Contact Log

Every broker you email via ACE is automatically logged in Chrome storage
for future EDGEai platform integration. No manual tracking needed.

---

ACE Load Capture v2.0 | XTX LLC | EDGEai Platform | PC Only
