// ACE Load Capture — background.js — Slim Orchestrator v3.0
// Calls modules only. No logic here.
// Handles: keepalive, load captured, bid popup, Gmail alert, metrics, broker upsert

const KEEPALIVE_MINUTES = 3;
const SYLECTUS_URL = 'https://www6.sylectus.com/Main.aspx?page=II14_managepostedloads.asp?loadboard=True';
const POPUP_DEDUP_MS = 15 * 60 * 1000; // 15 minutes
let _popupOffsetCount = 0;

// ─── STARTUP ─────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  chrome.alarms.create('keepalive', { periodInMinutes: KEEPALIVE_MINUTES });
  console.log('[ACE] v3.0 background installed');
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

  // Session expired — re-login
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

  // New qualifying load captured — fire Gmail alert + bid popup
  if (message.action === 'load_captured') {
    _handleLoadCaptured(message.load, message.suggested_rate, message.t2_detected_at);
    sendResponse({ status: 'ok' });
    return false;
  }

  // Bid action — send email + log metrics + upsert broker
  if (message.action === 'create_draft') {
    const load        = message.load;
    const bidAmount   = message.bid_amount;
    const sendNow     = message.send_now;
    const senderTabId = sender?.tab?.id ?? null;
    _getSettings().then(settings => {
      _getToken(settings).then(async token => {
        // If no token, attempt interactive refresh once
        let activeToken = token;
        if (!activeToken) {
          activeToken = await new Promise(res =>
            chrome.identity.getAuthToken({ interactive: true }, t => res(t || null))
          );
          if (activeToken) chrome.storage.local.set({ gmail_token: activeToken });
        }
        const t5 = new Date().toISOString();
        if (sendNow) {
          const success = await _sendBidEmail(load, bidAmount, activeToken, settings, t5);
          const msg = success
            ? { action: 'bid_sent', load: { ...load, t5_decision_at: t5 }, bid_amount: bidAmount }
            : { action: 'bid_failed', order_no: load.order_no };
          if (senderTabId) chrome.tabs.sendMessage(senderTabId, msg).catch(() => {});
          _broadcastToDashboard(msg);
          _broadcastToPopups(msg);
        } else {
          const drafted = await _createDraftOnly(load, bidAmount, activeToken, settings);
          const msg = drafted
            ? { action: 'draft_created', order_no: load.order_no }
            : { action: 'bid_failed', order_no: load.order_no };
          if (senderTabId) chrome.tabs.sendMessage(senderTabId, msg).catch(() => {});
          _broadcastToDashboard(msg);
          _broadcastToPopups(msg);
        }
      });
    });
    sendResponse({ status: 'ok' });
    return false;
  }

  if (message.action === 'log_win') {
    _getSettings().then(settings => {
      const load = message.load || {};
      const payload = _buildMetricsPayload(load, 'win', load.bid_amount, {
        t1: load.t1_posted_at,  t2: load.t2_detected_at,
        t3: load.t3_alerted_at, t4: load.t4_reviewed_at,
        t5: load.t5_decision_at, t6: load.t6_sent_at
      });
      payload.won_at = load.won_at || new Date().toISOString();
      _logMetrics(payload, settings);
      _updateBrokerOnWin(load, settings);
    });
    sendResponse({ status: 'ok' });
    return false;
  }

  if (message.action === 'log_delete') {
    _getSettings().then(settings => {
      const load = message.load || {};
      const payload = _buildMetricsPayload(load, 'deleted', load.bid_amount, {
        t1: load.t1_posted_at,  t2: load.t2_detected_at,
        t3: load.t3_alerted_at, t4: load.t4_reviewed_at,
        t5: load.t5_decision_at, t6: load.t6_sent_at
      });
      _logMetrics(payload, settings);
    });
    sendResponse({ status: 'ok' });
    return false;
  }

  // Pass on load — log metrics + sync dashboard
  if (message.action === 'pass_load') {
    _getSettings().then(settings => {
      const t5 = new Date().toISOString();
      const load = message.load || {};
      // Guard — only log if this order has no prior decision in metrics log
      chrome.storage.local.get('ace_metrics_log', (r) => {
        const log = r.ace_metrics_log || [];
        const alreadyLogged = log.some(m => String(m.order_no) === String(load.order_no) && m.decision !== 'identified');
        if (!alreadyLogged) {
          const payload = _buildMetricsPayload(load, 'pass', null, {
            t1: load.t1_posted_at, t2: load.t2_detected_at,
            t3: load.t3_alerted_at, t4: load.t4_reviewed_at,
            t5, t6: null
          });
          _logMetrics(payload, settings);
        }
      });
    });
    chrome.storage.local.remove('pending_bid_load');

    // Remove from board loads + increment pass tally in storage
    const orderNo = (message.load || {}).order_no;
    if (orderNo) {
      chrome.storage.local.get(['ace_board_loads', 'ace_pass_tracker'], (r) => {
        const loads = (r.ace_board_loads || []).filter(l => String(l.order_no) !== String(orderNo));
        const tracker = r.ace_pass_tracker || {};
        if (!tracker[orderNo]) tracker[orderNo] = { count: 0, lastPassAt: null };
        tracker[orderNo].count++;
        tracker[orderNo].lastPassAt = Date.now();
        chrome.storage.local.set({ ace_board_loads: loads, ace_pass_tracker: tracker });
      });
      // Broadcast to any open dashboard window
      _broadcastToDashboard({ action: 'pass_load', order_no: orderNo, source: message.source || 'unknown' });
      // Broadcast to any open bid popup windows so popup closes if same order
      _broadcastToPopups({ action: 'pass_load', order_no: orderNo, source: message.source || 'unknown' });
    }

    sendResponse({ status: 'ok' });
    return false;
  }

  // Open ACE load board window
  if (message.action === 'open_board') {
    _getOrCreateDashboard();
    sendResponse({ status: 'ok' });
    return false;
  }

  return false;
});

// ─── LOAD CAPTURED HANDLER ───────────────────────────────────────────────────

async function _handleLoadCaptured(load, suggestedRate, t2) {
  const settings = await _getSettings();
  const token = await _getToken(settings);
  const t3 = new Date().toISOString();

  load.t2_detected_at = t2 || t3;
  load.t3_alerted_at  = t3;
  load.suggested_rate = suggestedRate;

  // Add to dashboard loads list
  _addToDashboardLoads(load, suggestedRate);

  // Broadcast to any open dashboard window — real-time update
  _broadcastToDashboard({ action: 'new_load', load: { ...load, suggested_rate: suggestedRate, captured_at: Date.now() }, suggested_rate: suggestedRate });

  // Store as pending bid load
  chrome.storage.local.set({
    pending_bid_load: { ...load, suggested_rate: suggestedRate, captured_at: new Date().toLocaleString() }
  });

  // Send Gmail alert email to carrier — triggers iPhone/iPad push notification
  if (token && (settings.gmail_address)) {
    _sendGmailAlert(load, suggestedRate, token, settings, t3);
  }

  // Open bid popup — stacked, 1 hour dedup
  _openBidPopup(load, suggestedRate);
}

// ─── BID POPUP ───────────────────────────────────────────────────────────────

function _openBidPopup(load, suggestedRate) {
  const orderNo = load.order_no;
  chrome.storage.local.get('ace_popup_shown', (r) => {
    const shown = r.ace_popup_shown || {};
    // 1 hour dedup
    if (orderNo && shown[orderNo] && (Date.now() - shown[orderNo]) < POPUP_DEDUP_MS) {
      console.log(`[ACE] Popup suppressed — order ${orderNo} shown within 1hr`);
      return;
    }
    if (orderNo) {
      shown[orderNo] = Date.now();
      chrome.storage.local.set({ ace_popup_shown: shown });
    }
    chrome.system.display.getInfo(displays => {
      const d = displays[0] || {};
      const w = 440, h = 680;
      const baseLeft = (d.bounds?.width || 1920) - w - 20;
      const baseTop  = 20;
      // Stack offset — 30px down and left per additional popup
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
        console.log(`[ACE] Bid popup opened — order ${orderNo} at ${left},${top}`);
      });
    });
  });
}

// ─── GMAIL ALERT ─────────────────────────────────────────────────────────────

async function _sendGmailAlert(load, suggestedRate, token, settings, t3) {
  const to      = settings.gmail_address;
  const subject = `⚡ ACE LOAD — ${load.pickup_city} ${load.pickup_state} → ${load.delivery_city} ${load.delivery_state} — $${suggestedRate} suggested`;
  const mailSubject = encodeURIComponent(`${load.pickup_city},${load.pickup_state} to ${load.delivery_city},${load.delivery_state} - Bid $${suggestedRate}`);
  const composeUrl  = `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(load.broker_email)}&su=${mailSubject}`;

  const body = `<div style="font-family:Arial,sans-serif;font-size:14px;max-width:480px;">
<div style="background:#E8A020;color:#000;padding:12px 16px;border-radius:6px 6px 0 0;">
  <strong>⚡ ACE LOAD ALERT</strong>
</div>
<div style="background:#111;color:#fff;padding:16px;border-radius:0 0 6px 6px;">
  <p style="font-size:20px;font-weight:bold;margin:0 0 8px;">
    ${load.pickup_city}, ${load.pickup_state} → ${load.delivery_city}, ${load.delivery_state}
  </p>
  <table style="width:100%;font-size:13px;color:#ccc;border-collapse:collapse;">
    <tr><td style="padding:4px 0;"><strong style="color:#fff;">Order:</strong></td><td>${load.order_no}</td></tr>
    <tr><td style="padding:4px 0;"><strong style="color:#fff;">Pickup:</strong></td><td>${load.pickup_date}</td></tr>
    <tr><td style="padding:4px 0;"><strong style="color:#fff;">Delivery:</strong></td><td>${load.delivery_date}</td></tr>
    <tr><td style="padding:4px 0;"><strong style="color:#fff;">Miles:</strong></td><td>${load.miles}</td></tr>
    <tr><td style="padding:4px 0;"><strong style="color:#fff;">Type:</strong></td><td>${load.load_type}</td></tr>
    <tr><td style="padding:4px 0;"><strong style="color:#fff;">Weight:</strong></td><td>${load.weight} lbs</td></tr>
    <tr><td style="padding:4px 0;"><strong style="color:#fff;">Broker:</strong></td><td>${load.broker_name}</td></tr>
    <tr><td style="padding:4px 0;"><strong style="color:#E8A020;font-size:16px;">Suggested:</strong></td><td style="color:#E8A020;font-size:16px;font-weight:bold;">$${suggestedRate}</td></tr>
    <tr><td style="padding:4px 0;"><strong style="color:#fff;">Broker Posted:</strong></td><td>${load.posted_amount || '—'}</td></tr>
  </table>
  <div style="margin-top:16px;text-align:center;">
    <a href="${composeUrl}" style="background:#E8A020;color:#000;padding:12px 24px;border-radius:5px;font-weight:bold;font-size:15px;text-decoration:none;display:inline-block;">
      ⚡ Draft Bid
    </a>
  </div>
  <p style="margin-top:12px;font-size:11px;color:#666;text-align:center;">
    ACE · EDGEai · ${new Date().toLocaleTimeString()}
  </p>
</div>
</div>`;

  const alertResult = await _gmailSend(to, subject, body, token, settings.gmail_address);
  if (alertResult.success) {
    console.log(`[ACE] ✓ Gmail alert sent — order ${load.order_no}`);
  } else {
    console.warn(`[ACE] Gmail alert failed — order ${load.order_no}`);
  }
}

// ─── BID EMAIL ───────────────────────────────────────────────────────────────

async function _sendBidEmail(load, bidAmount, token, settings, t5) {
  if (!token || !load.broker_email) {
    console.warn('[ACE] _sendBidEmail — missing token or broker_email');
    return false;
  }

  // CARRIER from settings — not hardcoded
  const carrierName     = settings.carrier_name     || '';
  const companyName     = settings.company_name     || '';
  const carrierLocation = settings.carrier_location || '';
  const carrierPhone    = settings.carrier_phone    || '';
  const mcNumber        = settings.mc_number        || '';
  const fromEmail       = settings.gmail_address    || '';

  const subject = `${load.pickup_city} ${load.pickup_state} to ${load.delivery_city} ${load.delivery_state}- $${bidAmount}`;

  const loadTable = _buildLoadTable(load);

  const body = `<div style="font-family:verdana,arial,sans-serif;font-size:13px;color:#000;">
<p><strong>QUOTE: $${bidAmount}</strong><br>MC ${mcNumber}</p>
${loadTable}
<p style="margin-top:12px;">*******************<br>
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
${carrierName}<br>
${companyName}<br>
${carrierLocation}<br>
CELL: ${carrierPhone}</p>
</div>`;

  const t6 = new Date().toISOString();
  const result = await _gmailSend(load.broker_email, subject, body, token, fromEmail);

  if (result.success) {
    console.log(`[ACE] ✓ Bid email sent — ${load.broker_name} — $${bidAmount}`);

    // Log metrics
    const payload = _buildMetricsPayload(load, 'bid', bidAmount, {
      t1: load.t1_posted_at,  t2: load.t2_detected_at,
      t3: load.t3_alerted_at, t4: load.t4_reviewed_at,
      t5, t6
    });
    _logMetrics(payload, settings);

    // Upsert broker to EDGEai Supabase
    _upsertBroker(load, settings);

    chrome.storage.local.remove('pending_bid_load');
    return true;
  }
  console.warn('[ACE] _sendBidEmail — Gmail send failed');
  return false;
}

async function _createDraftOnly(load, bidAmount, token, settings) {
  if (!token || !load.broker_email) {
    console.warn('[ACE] _createDraftOnly — missing token or broker_email');
    return false;
  }
  const carrierName     = settings.carrier_name     || '';
  const companyName     = settings.company_name     || '';
  const carrierLocation = settings.carrier_location || '';
  const carrierPhone    = settings.carrier_phone    || '';
  const mcNumber        = settings.mc_number        || '';
  const fromEmail       = settings.gmail_address    || '';
  const subject = `${load.pickup_city} ${load.pickup_state} to ${load.delivery_city} ${load.delivery_state}- $${bidAmount}`;
  const loadTable = _buildLoadTable(load);
  const body = `<div style="font-family:verdana,arial,sans-serif;font-size:13px;color:#000;">
<p><strong>QUOTE: $${bidAmount}</strong><br>MC ${mcNumber}</p>
${loadTable}
<p style="margin-top:12px;">*******************<br>Equipment:<br>26' Straight,<br>Dock-high, Air-ride, 3 row e-tracks<br>Box Door: 94"W x 97"H<br>Box Interior 98.5"W x 26'L<br>TWIC<br>Gear:<br>Lift gate<br>Pallet jack<br>Load bars, Straps, Blankets.</p>
<p>--</p>
<p>Thank you,<br>${carrierName}<br>${companyName}<br>${carrierLocation}<br>CELL: ${carrierPhone}</p>
</div>`;
  const draft = await _gmailCreateDraft(load.broker_email, subject, body, token, fromEmail);
  if (draft) {
    console.log(`[ACE] ✓ Draft created — ${load.broker_name} — $${bidAmount}`);
    return true;
  }
  console.warn('[ACE] _createDraftOnly — Gmail draft creation failed');
  return false;
}

// ─── LOAD TABLE BUILDER ──────────────────────────────────────────────────────

function _buildLoadTable(load) {
  const postParts   = (load.post_date   || '').split(' ');
  const expiryParts = (load.expiry_date || '').split(' ');
  const postStr   = postParts.length > 1   ? `${postParts[0]}<br>${postParts[1]}`   : (load.post_date   || '');
  const expiryStr = expiryParts.length > 1 ? `${expiryParts[0]}<br>${expiryParts[1]}` : (load.expiry_date || '');
  return `
<table style="font-family:verdana,arial,sans-serif;font-size:13px;color:#000;border-collapse:collapse;background:#f0f0f0;display:inline-table;">
  <tr>
    <td style="padding:2px 4px;vertical-align:top;border:1px solid #d0d0d0;"><br>${load.load_type||''}<br>${load.ref_no||''}${load.posted_amount ? '<br>' + load.posted_amount : ''}</td>
    <td style="padding:2px 4px;vertical-align:top;text-align:left;border:1px solid #d0d0d0;"><br><span style="color:#cc0000;text-decoration:underline;">${load.order_no||''}</span></td>
    <td style="padding:2px 4px;vertical-align:top;text-align:left;border:1px solid #d0d0d0;">${load.pickup_city||''},${load.pickup_state||''}<br>${load.pickup_zip||''}<br>${load.pickup_date||''}</td>
    <td style="padding:2px 4px;vertical-align:top;text-align:left;border:1px solid #d0d0d0;">${load.delivery_city||''},${load.delivery_state||''}<br>${load.delivery_zip||''}<br>${load.delivery_date||''}</td>
    <td style="padding:2px 4px;vertical-align:top;text-align:left;border:1px solid #d0d0d0;">${postStr}<br>${expiryStr}</td>
    <td style="padding:2px 4px;vertical-align:top;text-align:left;border:1px solid #d0d0d0;"><br>${load.vehicle_size||''}<br>${load.miles||''}</td>
    <td style="padding:2px 4px;vertical-align:top;text-align:right;border:1px solid #d0d0d0;"><br>${load.pieces||''}<br>${load.weight||''}</td>
  </tr>
</table>`;
}

// ─── GMAIL API ────────────────────────────────────────────────────────────────

async function _gmailSend(to, subject, htmlBody, token, from) {
  const draft = await _gmailCreateDraft(to, subject, htmlBody, token, from);
  if (!draft) return { success: false };
  try {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts/send', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: draft.id })
    });
    return { success: res.ok };
  } catch(e) {
    console.error('[ACE] Gmail send error:', e);
    return { success: false };
  }
}

async function _gmailCreateDraft(to, subject, htmlBody, token, from) {
  const fromLine = from ? `From: ${from}\r\n` : '';
  const raw = `To: ${to}\r\n${fromLine}Subject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${htmlBody}`;
  const encoded = btoa(unescape(encodeURIComponent(raw))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  try {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { raw: encoded } })
    });
    if (!res.ok) {
      // Token expired — refresh and retry once
      const newToken = await _refreshToken(token);
      if (!newToken) return null;
      chrome.storage.local.set({ gmail_token: newToken });
      const retry = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${newToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { raw: encoded } })
      });
      if (!retry.ok) { console.warn('[ACE] Gmail draft failed after token refresh'); return null; }
      return await retry.json();
    }
    return await res.json();
  } catch(e) {
    console.error('[ACE] Gmail draft error:', e);
    return null;
  }
}

function _refreshToken(expired) {
  return new Promise(resolve => {
    const get = () => chrome.identity.getAuthToken({ interactive: false }, t => resolve(t || null));
    if (expired) chrome.identity.removeCachedAuthToken({ token: expired }, get);
    else get();
  });
}

// ─── METRICS ─────────────────────────────────────────────────────────────────

function _buildMetricsPayload(load, decision, bidAmount, timestamps) {
  const { t1, t2, t3, t4, t5, t6 } = timestamps;
  function diff(a, b) {
    if (!a || !b) return null;
    return Math.round((new Date(b) - new Date(a)) / 1000);
  }
  const bidSpeedSec = diff(t1, t6);
  let tier = 'pending';
  if (bidSpeedSec !== null) {
    if (bidSpeedSec <= 45) tier = 'elite';
    else if (bidSpeedSec <= 120) tier = 'good';
    else tier = 'coaching';
  }
  return {
    carrier_id:          load.carrier_id || null,
    order_no:            load.order_no,
    broker_name:         load.broker_name,
    broker_email:        load.broker_email,
    pickup_city:         load.pickup_city,
    pickup_state:        load.pickup_state,
    delivery_city:       load.delivery_city,
    delivery_state:      load.delivery_state,
    miles:               parseFloat(load.miles) || 0,
    load_type:           load.load_type,
    suggested_rate:      load.suggested_rate || 0,
    bid_amount:          bidAmount ? parseFloat(bidAmount) : null,
    decision,
    t1_posted_at:        t1 || null,
    t2_detected_at:      t2 || null,
    t3_alerted_at:       t3 || null,
    t4_reviewed_at:      t4 || null,
    t5_decision_at:      t5 || null,
    t6_sent_at:          t6 || null,
    detection_speed_sec: diff(t1, t2),
    alert_speed_sec:     diff(t2, t3),
    response_time_sec:   diff(t3, t5),
    bid_speed_sec:       bidSpeedSec,
    performance_tier:    tier,
    meets_target:        bidSpeedSec !== null && bidSpeedSec <= 45,
    pass_count:          load.pass_count || 0
  };
}

async function _logMetrics(payload, settings) {
  const uuid = settings.carrier_uuid;
  if (!uuid) return;
  payload.carrier_id = uuid;
  // Store locally
  chrome.storage.local.get('ace_metrics_log', (r) => {
    const log = r.ace_metrics_log || [];
    log.unshift({ ...payload, stored_at: new Date().toISOString() });
    if (log.length > 200) log.length = 200;
    chrome.storage.local.set({ ace_metrics_log: log });
  });
  // Send to Cloud Run
  try {
    await fetch('https://edgeai-gmail-webhook-417422203146.us-central1.run.app/log-sylectus-activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    console.log(`[ACE] ✓ Metrics logged — ${payload.order_no} | tier: ${payload.performance_tier}`);
  } catch(e) {
    console.warn('[ACE] Metrics log failed:', e.message);
  }
}

// ─── BROKER UPSERT ───────────────────────────────────────────────────────────

async function _upsertBroker(load, settings) {
  const uuid = settings.carrier_uuid;
  if (!uuid || !load.broker_email) return;
  const now = new Date().toISOString();
  const payload = {
    carrier_id:            uuid,
    name:                  load.broker_contact_name || '',
    company:               load.company_name || load.broker_name || '',
    email:                 load.broker_email,
    phone:                 load.broker_phone || '',
    title:                 load.broker_title || '',
    primary_lanes:         `${load.pickup_state} - ${load.delivery_state}`,
    status:                'warm',
    priority:              'medium',
    preferred:             false,
    alert_requested:       false,
    days_cadence:          3,
    last_contacted:        now,
    response_count:        0,
    load_count:            1,
    touch_count:           1,
    contact_enabled:       true,
    last_load_date:        now,
    last_load_origin:      `${load.pickup_city} ${load.pickup_state}`.trim(),
    last_load_destination: `${load.delivery_city} ${load.delivery_state}`.trim(),
    broker_mc:             load.broker_mc || '',
    posted_amount:         load.posted_amount || '',
    notes:                 `ACE Sylectus — ${load.load_type} order ${load.order_no}`
  };
  try {
    await fetch('https://edgeai-gmail-webhook-417422203146.us-central1.run.app/add-broker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    console.log(`[ACE] ✓ Broker upserted — ${load.broker_email}`);
  } catch(e) {
    console.warn('[ACE] Broker upsert failed:', e.message);
  }

  // Write lane row to broker_lanes
  const nameParts = (load.broker_contact_name || '').trim().split(/\s+/);
  const lanePayload = {
    carrier_id:        uuid,
    broker_first_name: nameParts[0] || null,
    broker_last_name:  nameParts.length > 1 ? nameParts.slice(1).join(' ') : null,
    broker_company:    load.company_name || load.broker_name || null,
    broker_mc:         load.broker_mc    || null,
    broker_email:      load.broker_email,
    broker_phone:      load.broker_phone || null,
    pickup_city:       load.pickup_city  || null,
    pickup_state:      load.pickup_state || null,
    pickup_zip:        load.pickup_zip   || null,
    delivery_city:     load.delivery_city  || null,
    delivery_state:    load.delivery_state || null,
    delivery_zip:      load.delivery_zip   || null,
    vehicle_size:      load.vehicle_size   || null,
    miles:             parseInt(load.miles) || null,
    posted_amount:     load.posted_amount  || null,
    decision:          'harvest',
    source:            'SYL'
  };
  try {
    const laneRes = await fetch('https://edgeai-gmail-webhook-417422203146.us-central1.run.app/upsert-broker-lane', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lanePayload)
    });
    const laneData = await laneRes.json();
    if (laneData.success) {
      console.log(`[ACE] ✓ Lane written — ${load.pickup_city} ${load.pickup_state} → ${load.delivery_city} ${load.delivery_state} | MC: ${load.broker_mc || 'n/a'}`);
    } else {
      console.warn('[ACE] Lane write failed:', laneData.error);
    }
  } catch(e) {
    console.warn('[ACE] Lane fetch error:', e.message);
  }
}

async function _updateBrokerOnWin(load, settings) {
  const uuid = settings.carrier_uuid;
  if (!uuid || !load.broker_email) return;
  const now = new Date().toISOString();
  const payload = {
    carrier_id:            uuid,
    email:                 load.broker_email,
    load_count:            1,
    last_load_date:        now,
    last_load_origin:      `${load.pickup_city||''} ${load.pickup_state||''}`.trim(),
    last_load_destination: `${load.delivery_city||''} ${load.delivery_state||''}`.trim()
  };
  try {
    await fetch('https://edgeai-gmail-webhook-417422203146.us-central1.run.app/update-broker-win', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    console.log(`[ACE] ✓ Broker win logged — ${load.broker_email}`);
  } catch(e) {
    console.warn('[ACE] Broker win update failed:', e.message);
  }
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

function _addToDashboardLoads(load, suggestedRate) {
  chrome.storage.local.get('ace_board_loads', (r) => {
    const loads = r.ace_board_loads || [];
    const filtered = loads.filter(l => String(l.order_no) !== String(load.order_no));
    filtered.unshift({ ...load, suggested_rate: suggestedRate, captured_at: Date.now() });
    if (filtered.length > 100) filtered.length = 100;
    chrome.storage.local.set({ ace_board_loads: filtered });
  });
}

function _getOrCreateDashboard() {
  chrome.storage.local.get('ace_dashboard_id', (r) => {
    if (r.ace_dashboard_id) {
      chrome.windows.get(r.ace_dashboard_id, (win) => {
        if (chrome.runtime.lastError || !win) _createDashboard();
        else chrome.windows.update(r.ace_dashboard_id, { focused: true, state: 'normal' });
      });
    } else {
      _createDashboard();
    }
  });
}

function _createDashboard() {
  chrome.windows.create({
    url: chrome.runtime.getURL('popup/dashboard.html'),
    type: 'normal', state: 'normal', width: 1200, height: 800
  }, (win) => {
    chrome.storage.local.set({ ace_dashboard_id: win.id });
  });
}

// ─── UTILITIES ───────────────────────────────────────────────────────────────

function _broadcastToDashboard(message) {
  const dashUrl = chrome.runtime.getURL('popup/dashboard.html');
  chrome.tabs.query({ url: dashUrl }, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    });
  });
}

function _broadcastToPopups(message) {
  const popupUrl = chrome.runtime.getURL('popup/bid-popup.html');
  chrome.tabs.query({ url: popupUrl }, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    });
  });
}

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
    chrome.identity.getAuthToken({ interactive: false }, (t) => {
      if (t) chrome.storage.local.set({ gmail_token: t });
      resolve(t || null);
    });
  });
}
