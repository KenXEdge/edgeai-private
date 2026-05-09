// ACE Load Capture — Background Service Worker v3.0
// Modular orchestrator — imports handled via manifest scripts array
// No hardcoded carrier values — all from chrome.storage settings

const KEEPALIVE_MINUTES = 3;
const SYLECTUS_URL = 'https://www6.sylectus.com/Main.aspx?page=II14_managepostedloads.asp?loadboard=True';
const POPUP_DEDUP_MS = 60 * 60 * 1000; // 1 hour dedup window
let _popupOffsetCount = 0; // for stacking multiple popups

// ─── STARTUP ─────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  chrome.alarms.create('keepalive', { periodInMinutes: KEEPALIVE_MINUTES });
  console.log('[ACE] v3.0 installed — modular build');
  if (details.reason === 'install') _adoptOrOpenSylectusTab();
});

// ─── ALARMS ──────────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'keepalive') return;

  chrome.storage.local.get(['ace_paused', 'sylectus_tab_id'], (r) => {
    if (r.ace_paused) return;

    if (r.sylectus_tab_id) {
      chrome.tabs.get(r.sylectus_tab_id, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          chrome.storage.local.remove('sylectus_tab_id');
          _adoptOrOpenSylectusTab();
        } else {
          chrome.tabs.sendMessage(r.sylectus_tab_id, { action: 'keepalive' }).catch(() => {});
        }
      });
    } else {
      _adoptOrOpenSylectusTab();
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
        _openSettings();
      }
    });
    sendResponse({ status: 'ok' });
    return false;
  }

  if (message.action === 'load_captured') {
    _handleLoadCaptured(message.load, message.suggested_rate, message.t2_detected_at);
    sendResponse({ status: 'ok' });
    return false;
  }

  if (message.action === 'create_draft') {
    _getSettings().then(settings => {
      _getToken(settings).then(token => {
        if (message.send_now) {
          ACEEmail.sendBid(message.load, message.bid_amount, token, settings)
            .then(result => {
              if (result?.success) {
                // Log metrics
                const payload = ACEMetrics.buildPayload(message.load, 'bid', message.bid_amount, {
                  t1: message.load.t1_posted_at,
                  t2: message.load.t2_detected_at,
                  t3: message.load.t3_alerted_at,
                  t4: message.load.t4_reviewed_at,
                  t5: message.t5_decision_at || ACEUtils.now(),
                  t6: result.t6_sent_at
                });
                ACEMetrics.log(payload, settings);
                ACEMetrics.storeLocal(payload);
                // Upsert broker to EDGEai
                ACEBroker.upsert(message.load, settings);
                ACEBroker.storeLocal(message.load, settings.carrier_uuid);
              }
            });
        } else {
          ACEEmail.createDraftOnly(message.load, message.bid_amount, token, settings);
        }
      });
    });
    sendResponse({ status: 'ok' });
    return false;
  }

  if (message.action === 'pass_load') {
    _getSettings().then(settings => {
      const payload = ACEMetrics.buildPayload(message.load, 'pass', null, {
        t1: message.load.t1_posted_at,
        t2: message.load.t2_detected_at,
        t3: message.load.t3_alerted_at,
        t4: message.load.t4_reviewed_at,
        t5: ACEUtils.now(),
        t6: null
      });
      ACEMetrics.log(payload, settings);
      ACEMetrics.storeLocal(payload);
    });
    chrome.storage.local.remove('pending_bid_load');
    sendResponse({ status: 'ok' });
    return false;
  }

  if (message.action === 'open_board') {
    _getOrCreateDashboard();
    sendResponse({ status: 'ok' });
    return false;
  }

  return false;
});

// ─── LOAD CAPTURED ───────────────────────────────────────────────────────────

async function _handleLoadCaptured(load, suggestedRate, t2) {
  const settings = await _getSettings();
  const token = await _getToken(settings);

  // T3 — alert time
  const t3 = ACEUtils.now();
  load.t3_alerted_at = t3;
  load.suggested_rate = suggestedRate;

  // Store for popup
  load.t2_detected_at = t2 || t3;

  // Add to dashboard loads list
  _addToDashboard(load, suggestedRate);

  // Send Gmail alert to carrier's phone
  if (token && settings.gmail_address) {
    ACEEmail.sendAlert(load, suggestedRate, token, settings);
  }

  // Open bid popup — stacked and deduped
  _openBidPopup(load, suggestedRate);
}

// ─── BID POPUP ───────────────────────────────────────────────────────────────

function _openBidPopup(load, suggestedRate) {
  const orderNo = load.order_no;

  chrome.storage.local.get('ace_popup_shown', (r) => {
    const shown = r.ace_popup_shown || {};

    // 1 hour dedup window
    if (orderNo && shown[orderNo] && (Date.now() - shown[orderNo]) < POPUP_DEDUP_MS) {
      console.log(`[ACE] Popup suppressed — order ${orderNo} shown within 1hr`);
      return;
    }

    if (orderNo) {
      shown[orderNo] = Date.now();
      chrome.storage.local.set({ ace_popup_shown: shown });
    }

    chrome.storage.local.set({
      pending_bid_load: {
        ...load,
        suggested_rate: suggestedRate,
        captured_at: new Date().toLocaleString()
      }
    }, () => {
      chrome.system.display.getInfo(displays => {
        const d = displays[0] || {};
        const w = 440, h = 680;
        const baseLeft = (d.bounds?.width  || 1920) - w - 20;
        const baseTop  = 20;

        // Stack offset — each popup 30px down and left of previous
        const offset = (_popupOffsetCount % 5) * 30;
        const left = baseLeft - offset;
        const top  = baseTop  + offset;
        _popupOffsetCount++;

        chrome.windows.create({
          url: chrome.runtime.getURL('popup/bid-popup.html'),
          type: 'popup',
          width: w, height: h,
          left, top,
          focused: true
        }, win => {
          if (win) {
            setTimeout(() => {
              chrome.windows.update(win.id, { focused: true, state: 'normal' });
            }, 150);
          }
        });
        console.log(`[ACE] Bid popup opened — order ${orderNo} at ${left},${top}`);
      });
    });
  });
}

// ─── ACE LOAD DASHBOARD ──────────────────────────────────────────────────────

function _addToDashboard(load, suggestedRate) {
  chrome.storage.local.get('ace_board_loads', (r) => {
    const loads = r.ace_board_loads || [];
    const filtered = loads.filter(l => String(l.order_no) !== String(load.order_no));
    filtered.unshift({ ...load, suggested_rate: suggestedRate, captured_at: Date.now() });
    if (filtered.length > 100) filtered.length = 100;
    chrome.storage.local.set({ ace_board_loads: filtered });
  });

  // Notify dashboard window if open
  chrome.storage.local.get('ace_dashboard_id', (r) => {
    if (!r.ace_dashboard_id) return;
    chrome.windows.get(r.ace_dashboard_id, (win) => {
      if (chrome.runtime.lastError || !win) return;
      chrome.tabs.query({ windowId: r.ace_dashboard_id }, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, {
            action: 'new_load',
            load: { ...load, suggested_rate: suggestedRate }
          }).catch(() => {});
        });
      });
    });
  });
}

function _getOrCreateDashboard() {
  chrome.storage.local.get('ace_dashboard_id', (r) => {
    if (r.ace_dashboard_id) {
      chrome.windows.get(r.ace_dashboard_id, (win) => {
        if (chrome.runtime.lastError || !win) {
          _createDashboard();
        } else {
          chrome.windows.update(r.ace_dashboard_id, { focused: true, state: 'normal' });
        }
      });
    } else {
      _createDashboard();
    }
  });
}

function _createDashboard() {
  chrome.windows.create({
    url: chrome.runtime.getURL('popup/dashboard.html'),
    type: 'normal',
    state: 'normal',
    width: 1200,
    height: 800
  }, (win) => {
    chrome.storage.local.set({ ace_dashboard_id: win.id });
    console.log('[ACE] Dashboard opened:', win.id);
  });
}

// ─── UTILITIES ───────────────────────────────────────────────────────────────

function _adoptOrOpenSylectusTab() {
  chrome.tabs.query({ url: '*://*.sylectus.com/*' }, (tabs) => {
    if (tabs.length > 0) {
      chrome.storage.local.set({ sylectus_tab_id: tabs[0].id });
      chrome.tabs.sendMessage(tabs[0].id, { action: 'keepalive' }).catch(() => {});
    } else {
      chrome.tabs.create({ url: SYLECTUS_URL, active: false }, (tab) => {
        chrome.storage.local.set({ sylectus_tab_id: tab.id });
      });
    }
  });
}

function _openSettings() {
  chrome.windows.create({
    url: chrome.runtime.getURL('popup/settings.html'),
    type: 'popup', width: 380, height: 700
  });
}

function _getSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get([
      'sylectus_corp_password', 'sylectus_password', 'rpm',
      'gmail_token', 'gmail_address', 'carrier_uuid',
      'carrier_name', 'company_name', 'carrier_phone',
      'carrier_location', 'mc_number', 'search_from_city',
      'search_from_state', 'search_to_states', 'search_to_city',
      'pickup_radius', 'bid_radius', 'max_weight',
      'target_load_types', 'ace_paused', 'ace_locked',
      'operating_start', 'operating_end'
    ], resolve);
  });
}

function _getToken(settings) {
  return new Promise(resolve => {
    if (settings.gmail_token) { resolve(settings.gmail_token); return; }
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (token) chrome.storage.local.set({ gmail_token: token });
      resolve(token || null);
    });
  });
}

// Expose for modules that need it
const ACEUtils = {
  now: () => new Date().toISOString(),
  nowMs: () => Date.now(),
  secDiff: (a, b) => {
    if (!a || !b) return null;
    return Math.round((new Date(b) - new Date(a)) / 1000);
  }
};
