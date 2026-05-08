// ACE Load Capture — Background Service Worker v2.0
// No Telnyx dependency — uses Chrome windows for bid popup

const KEEPALIVE_MINUTES = 3;
const SYLECTUS_URL = 'https://www6.sylectus.com/Main.aspx?page=II14_managepostedloads.asp?loadboard=True';

// ─── STARTUP ─────────────────────────────────────────────────────────────────

function adoptOrOpenSylectusTab() {
  chrome.tabs.query({ url: '*://*.sylectus.com/*' }, (tabs) => {
    if (tabs.length > 0) {
      chrome.storage.local.set({ sylectus_tab_id: tabs[0].id });
      chrome.tabs.sendMessage(tabs[0].id, { action: 'keepalive' }).catch(() => {});
      console.log('[ACE] Adopted existing Sylectus tab:', tabs[0].id);
    } else {
      chrome.tabs.create({ url: SYLECTUS_URL, active: false }, (tab) => {
        chrome.storage.local.set({ sylectus_tab_id: tab.id });
        console.log('[ACE] Opened new Sylectus tab:', tab.id);
      });
    }
  });
}

function openSylectusTab() {
  adoptOrOpenSylectusTab();
}

chrome.runtime.onInstalled.addListener((details) => {
  chrome.alarms.create('keepalive', { periodInMinutes: KEEPALIVE_MINUTES });
  console.log('[ACE] v2.0 installed — no SMS dependency');
  // Only open a tab on first install, not on every extension reload/update
  if (details.reason === 'install') openSylectusTab();
});

// ─── ALARMS ──────────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'keepalive') return;

  chrome.storage.local.get(['ace_paused', 'sylectus_tab_id'], (r) => {
    if (r.ace_paused) return;

    if (r.sylectus_tab_id) {
      chrome.tabs.get(r.sylectus_tab_id, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          // Stored ID is stale — adopt existing tab or open one (never blind-create)
          chrome.storage.local.remove('sylectus_tab_id');
          adoptOrOpenSylectusTab();
        } else {
          chrome.tabs.sendMessage(r.sylectus_tab_id, { action: 'keepalive' }).catch(() => {});
        }
      });
    } else {
      adoptOrOpenSylectusTab();
    }
  });
});

// ─── MESSAGE HANDLER ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.action === 'session_expired') {
    chrome.storage.local.get(['sylectus_corp_password', 'sylectus_password'], (r) => {
      if (r.sylectus_corp_password && r.sylectus_password) {
        chrome.tabs.sendMessage(sender.tab.id, {
          action: 'do_login',
          corp_password: r.sylectus_corp_password,
          user_password: r.sylectus_password
        }).catch(() => {});
      } else {
        chrome.windows.create({
          url: chrome.runtime.getURL('popup/settings.html'),
          type: 'popup', width: 360, height: 620
        });
      }
    });
    sendResponse({ status: 'ok' });
    return false;
  }

  if (message.action === 'open_profile_tab') {
    chrome.tabs.create({ url: message.url, active: false }, (tab) => {
      console.log(`[ACE] Profile tab opened — tab ${tab.id}`);
    });
    sendResponse({ status: 'ok' });
    return false;
  }

  if (message.action === 'open_board') {
    getOrCreateAceWindow((windowId) => {
      chrome.windows.update(windowId, { focused: true, state: 'normal' });
    });
    sendResponse({ status: 'ok' });
    return false;
  }

  if (message.action === 'load_captured') {
    addToBoardLoads(message.load, message.suggested_rate);
    openBidPopup(message.load, message.suggested_rate);
    sendResponse({ status: 'popup_opened' });
    return false;
  }

  if (message.action === 'create_draft') {
    getSettings().then(settings => {
      createGmailEmail(message.load, message.bid_amount, message.send_now, settings);
    });
    sendResponse({ status: 'ok' });
    return false;
  }

  if (message.action === 'pass_load') {
    console.log(`[ACE] Passed on order ${message.load?.order_no}`);
    chrome.storage.local.remove('pending_bid_load');
    sendResponse({ status: 'ok' });
    return false;
  }

  return false;
});

// ─── ACE WINDOW ──────────────────────────────────────────────────────────────

function getOrCreateAceWindow(callback) {
  chrome.storage.local.get('ace_window_id', (r) => {
    if (r.ace_window_id) {
      chrome.windows.get(r.ace_window_id, (win) => {
        if (chrome.runtime.lastError || !win) {
          createAceWindow(callback);
        } else {
          callback(r.ace_window_id);
        }
      });
    } else {
      createAceWindow(callback);
    }
  });
}

function createAceWindow(callback) {
  chrome.windows.create({
    url: chrome.runtime.getURL('popup/ace-board.html'),
    type: 'normal',
    state: 'minimized',
    width: 1280,
    height: 900
  }, (win) => {
    chrome.storage.local.set({ ace_window_id: win.id });
    console.log('[ACE] Board window created:', win.id);
    if (callback) callback(win.id);
  });
}

function addToBoardLoads(load, suggestedRate) {
  chrome.storage.local.get('ace_board_loads', (r) => {
    const loads = r.ace_board_loads || [];
    const filtered = loads.filter(l => String(l.order_no) !== String(load.order_no));
    filtered.unshift({ ...load, suggested_rate: suggestedRate, captured_at: Date.now() });
    if (filtered.length > 50) filtered.length = 50;
    chrome.storage.local.set({ ace_board_loads: filtered });
  });
}

// ─── BID POPUP ───────────────────────────────────────────────────────────────

function openBidPopup(load, suggestedRate) {
  const orderNo = load.order_no;
  const DEDUP_MS = 4 * 60 * 60 * 1000;

  chrome.storage.local.get('ace_popup_shown', (r) => {
    const shown = r.ace_popup_shown || {};
    if (orderNo && shown[orderNo] && (Date.now() - shown[orderNo]) < DEDUP_MS) {
      console.log(`[ACE] Popup suppressed — order ${orderNo} already shown`);
      return;
    }

    // Record this order as shown
    if (orderNo) {
      shown[orderNo] = Date.now();
      chrome.storage.local.set({ ace_popup_shown: shown });
    }

    chrome.storage.local.set({
      pending_bid_load: { ...load, suggested_rate: suggestedRate, captured_at: new Date().toLocaleString() }
    }, () => {
      // Position top-right of primary screen so it never hides behind other windows
      chrome.system.display.getInfo(displays => {
        const d = displays[0] || {};
        const w = 440, h = 680;
        const left = ((d.bounds?.width  || 1920) - w - 20);
        const top  = 20;

        chrome.windows.create({
          url: chrome.runtime.getURL('popup/bid-popup.html'),
          type: 'popup',
          width: w, height: h,
          left, top,
          focused: true
        }, win => {
          if (win) {
            // Force-raise after creation — overcomes Windows focus-stealing prevention
            setTimeout(() => {
              chrome.windows.update(win.id, { focused: true, state: 'normal' });
            }, 150);
          }
        });
        console.log(`[ACE] Bid popup opened — order ${orderNo}`);
      });
    });
  });
}

// ─── GMAIL ───────────────────────────────────────────────────────────────────

async function createGmailEmail(load, bidAmount, sendNow, settings) {
  // Try stored token first
  let token = settings.gmail_token;

  if (!token) {
    // Get fresh token
    token = await new Promise(resolve => {
      chrome.identity.getAuthToken({ interactive: false }, (t) => {
        resolve(t || null);
      });
    });
    if (token) chrome.storage.local.set({ gmail_token: token });
  }

  if (!token) {
    console.warn('[ACE] No Gmail token — cannot create email');
    chrome.windows.create({
      url: chrome.runtime.getURL('popup/settings.html'),
      type: 'popup', width: 360, height: 620
    });
    return;
  }

  if (!load.broker_email) {
    console.warn('[ACE] No broker email — cannot create email');
    return;
  }

  const subject = `${load.pickup_city} ${load.pickup_state} to ${load.delivery_city} ${load.delivery_state}- $${bidAmount}`;

  const body = buildEmailBody(load, bidAmount, settings);

  const rawEmail = [
    `To: ${load.broker_email}`,
    `From: ${CARRIER.email}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=utf-8`,
    ``,
    body
  ].join('\r\n');

  const encoded = btoa(unescape(encodeURIComponent(rawEmail)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  try {
    // Create draft
    const draftRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: { raw: encoded } })
    });

    if (!draftRes.ok) {
      const newToken = await refreshGmailToken(token);
      if (newToken) {
        chrome.storage.local.set({ gmail_token: newToken });
        await createGmailEmail(load, bidAmount, sendNow, { ...settings, gmail_token: newToken });
      } else {
        console.warn('[ACE] Token refresh failed — re-open settings to reconnect Gmail');
      }
      return;
    }

    const draft = await draftRes.json();
    console.log(`[ACE] ✓ Draft created — ${load.broker_name} — $${bidAmount}`);

    if (sendNow) {
      // Send immediately
      const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ id: draft.id })
      });

      if (sendRes.ok) {
        console.log(`[ACE] ✓ Email sent — ${load.broker_name} — $${bidAmount}`);
        // Add broker to tracking
        logBrokerContact(load);
      }
    }

  } catch (err) {
    console.error('[ACE] Gmail error:', err);
  }
}

function buildEmailBody(load, bidAmount, settings) {
  // Use raw HTML row for authentic Sylectus copy-paste appearance (colors, layout)
  // Fall back to preformatted plain text if HTML not available
  const loadBlock = load.raw_row_html
    ? `<table style="border-collapse:collapse;font-size:12px;font-family:Arial,sans-serif;">${load.raw_row_html}</table>`
    : `<pre style="font-family:monospace;font-size:11px;">${escapeHtml(load.raw_row_text || '')}</pre>`;

  const sig = `${CARRIER.name}<br>${CARRIER.company}<br>${CARRIER.location}<br>CELL: ${CARRIER.phone}`;

  return `<div style="font-family:Arial,sans-serif;font-size:13px;line-height:1.6;color:#000000;">

<p><strong>QUOTE: $${bidAmount}</strong><br>
MC 1610666</p>

${loadBlock}

<p>*******************<br>
Equipment:<br>
26' Straight,<br>
Dock-high, Air-ride, 3 row e-tracks<br>
Box Door: 94"W x 97"H<br>
Box Interior 98.5"W x 26'L<br>
TWIC<br>
Gear:<br>
Lift gate<br>
Pallet jack<br>
Load bars, Straps, Blankets.</p>

<p>--</p>

<p>Thank you,<br>
${sig}</p>

</div>`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function refreshGmailToken(expiredToken) {
  return new Promise(resolve => {
    const getNew = () => chrome.identity.getAuthToken({ interactive: false }, t => resolve(t || null));
    if (expiredToken) {
      chrome.identity.removeCachedAuthToken({ token: expiredToken }, getNew);
    } else {
      getNew();
    }
  });
}

function logBrokerContact(load) {
  // Store broker for future EDGEai integration
  if (!load.broker_email) return;
  chrome.storage.local.get('contacted_brokers', (r) => {
    const brokers = r.contacted_brokers || [];
    const exists = brokers.find(b => b.email === load.broker_email);
    if (!exists) {
      brokers.push({
        email: load.broker_email,
        name: load.broker_name,
        contact: load.broker_contact_name,
        first_contacted: new Date().toISOString(),
        order_no: load.order_no
      });
      chrome.storage.local.set({ contacted_brokers: brokers });
      console.log(`[ACE] Broker logged: ${load.broker_email}`);
    }
  });
}

// ─── UTILITIES ───────────────────────────────────────────────────────────────

const CARRIER = {
  name:     'Ken Korbel',
  company:  'XTX Transport',
  phone:    '972-677-8688',
  mc:       '1610666',
  email:    'contact@xtxtransport.com',
  location: 'Fort Worth, TX'
};

function getSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get([
      'sylectus_corp_password', 'sylectus_password', 'rpm',
      'gmail_token', 'search_from_city', 'search_from_state',
      'search_to_states', 'bid_radius', 'max_weight', 'ace_paused'
    ], resolve);
  });
}
