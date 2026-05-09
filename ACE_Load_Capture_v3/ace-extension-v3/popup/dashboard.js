// ACE Load Dashboard v3.1
// Active Queue | Bids Sent | Wins
// Synchronized with bid popup

const PASS_BYPASS_COUNT = 2;
const PASS_BYPASS_MS    = 72 * 60 * 60 * 1000;
const DEDUP_MS          = 15 * 60 * 1000;
let sortAsc = false;

function el(id) { return document.getElementById(id); }
function fmt(ts) { return ts ? new Date(ts).toLocaleTimeString() : '—'; }
function secToStr(s) { if (!s && s !== 0) return '—'; return s < 60 ? `${s}s` : `${Math.floor(s/60)}m ${s%60}s`; }

// ─── STATE ────────────────────────────────────────────────────────────────────

let queueLoads = [];
let bidLoads   = [];
let winLoads   = [];
let passTracker = {}; // orderNo -> { count, lastPassAt }

function loadState() {
  chrome.storage.local.get([
    'ace_board_loads', 'ace_bid_loads', 'ace_win_loads',
    'ace_pass_tracker', 'ace_metrics_log'
  ], (r) => {
    queueLoads  = r.ace_board_loads  || [];
    bidLoads    = r.ace_bid_loads    || [];
    winLoads    = r.ace_win_loads    || [];
    passTracker = r.ace_pass_tracker || {};
    renderAll();
    updateMetrics(r.ace_metrics_log || []);
  });
}

function saveState() {
  chrome.storage.local.set({
    ace_board_loads:  queueLoads,
    ace_bid_loads:    bidLoads,
    ace_win_loads:    winLoads,
    ace_pass_tracker: passTracker
  });
}

// ─── RENDER ───────────────────────────────────────────────────────────────────

function renderAll() {
  renderQueue();
  renderBids();
  renderWins();
  updateCounts();
}

function renderQueue() {
  const tbody = el('queue-tbody');
  if (!tbody) return;
  const sorted = [...queueLoads].sort((a, b) =>
    sortAsc ? a.captured_at - b.captured_at : b.captured_at - a.captured_at
  );
  if (sorted.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-msg">ACE is watching — loads appear here</td></tr>';
    return;
  }
  tbody.innerHTML = sorted.map(load => `
    <tr id="qrow-${load.order_no}" class="${load._draft ? 'draft-row' : ''}">
      <td>
        <div class="lane">${load.pickup_city||'—'}, ${load.pickup_state||''} → ${load.delivery_city||'—'}, ${load.delivery_state||''}</div>
        <div class="lane-sub">PU: ${load.pickup_date||'—'} · DEL: ${load.delivery_date||'—'}</div>
      </td>
      <td><div class="bname">${load.broker_name||'—'}</div><div class="bemail">${load.broker_email||'—'}</div></td>
      <td class="mono">${load.order_no}</td>
      <td class="gold-text">${load.miles||'—'}</td>
      <td style="font-size:11px;color:rgba(255,255,255,0.5)">${load.load_type||'—'}</td>
      <td style="font-size:11px;color:rgba(255,255,255,0.4)">${load.weight||'—'}</td>
      <td class="gold-text">$${load.suggested_rate||'—'}</td>
      <td><input type="number" class="bid-input" id="bid-${load.order_no}" value="${load.suggested_rate||''}" placeholder="${load.suggested_rate||''}"></td>
      <td>
        <div class="actions">
          ${load._draft ? '<span class="draft-badge">DRAFT</span>' : ''}
          <button class="btn-p" onclick="doPass('${load.order_no}')">✕ Pass</button>
          <button class="btn-d" onclick="doDraft('${load.order_no}')">Draft</button>
          <button class="btn-s" onclick="doSend('${load.order_no}')">⚡ Send</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function renderBids() {
  const tbody = el('bids-tbody');
  if (!tbody) return;
  if (bidLoads.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-msg">No bids sent yet</td></tr>';
    return;
  }
  tbody.innerHTML = bidLoads.map(load => `
    <tr id="brow-${load.order_no}" class="bid-row">
      <td><div class="lane">${load.pickup_city||'—'}, ${load.pickup_state||''} → ${load.delivery_city||'—'}, ${load.delivery_state||''}</div></td>
      <td><div class="bname">${load.broker_name||'—'}</div><div class="bemail">${load.broker_email||'—'}</div></td>
      <td class="mono">${load.order_no}</td>
      <td class="gold-text">${load.miles||'—'}</td>
      <td class="gold-text">$${load.bid_amount||'—'}</td>
      <td style="font-size:11px;color:rgba(255,255,255,0.35)">${fmt(load.bid_sent_at)}</td>
      <td>
        <div class="actions">
          <button class="btn-w" onclick="doWin('${load.order_no}')">✓ WIN</button>
          <button class="btn-x" onclick="doDelete('${load.order_no}')">DELETE</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function renderWins() {
  const tbody = el('wins-tbody');
  if (!tbody) return;
  if (winLoads.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-msg">No wins yet — keep bidding</td></tr>';
    return;
  }
  tbody.innerHTML = winLoads.map(load => `
    <tr class="win-row">
      <td><div class="lane">${load.pickup_city||'—'}, ${load.pickup_state||''} → ${load.delivery_city||'—'}, ${load.delivery_state||''}</div></td>
      <td><div class="bname">${load.broker_name||'—'}</div></td>
      <td class="mono">${load.order_no}</td>
      <td class="gold-text">${load.miles||'—'}</td>
      <td class="gold-text">$${load.bid_amount||'—'}</td>
      <td style="font-size:11px;color:rgba(255,255,255,0.35)">${fmt(load.won_at)}</td>
    </tr>
  `).join('');
}

function updateCounts() {
  el('queue-count').textContent = queueLoads.length;
  el('bids-count').textContent  = bidLoads.length;
  el('wins-count').textContent  = winLoads.length;
}

// ─── ACTIONS ──────────────────────────────────────────────────────────────────

function doPass(orderNo) {
  const load = queueLoads.find(l => String(l.order_no) === String(orderNo));
  if (!load) return;

  // Flash orange
  const row = el(`qrow-${orderNo}`);
  if (row) {
    row.classList.add('flash-pass');
    setTimeout(() => {
      queueLoads = queueLoads.filter(l => String(l.order_no) !== String(orderNo));
      saveState();
      renderQueue();
      updateCounts();
    }, 2000);
  }

  // Track pass count
  if (!passTracker[orderNo]) passTracker[orderNo] = { count: 0, lastPassAt: null };
  passTracker[orderNo].count++;
  passTracker[orderNo].lastPassAt = Date.now();

  // Send to background
  chrome.runtime.sendMessage({
    action: 'pass_load',
    load: { ...load, t5_decision_at: new Date().toISOString() }
  });
}

function doDraft(orderNo) {
  const amount = el(`bid-${orderNo}`)?.value;
  if (!amount) { alert('Enter bid amount first'); return; }
  const load = queueLoads.find(l => String(l.order_no) === String(orderNo));
  if (!load) return;
  const t5 = new Date().toISOString();

  // Mark as draft in queue
  const idx = queueLoads.findIndex(l => String(l.order_no) === String(orderNo));
  if (idx > -1) queueLoads[idx]._draft = true;
  saveState();
  renderQueue();

  chrome.runtime.sendMessage({
    action: 'create_draft',
    load: { ...load, t4_reviewed_at: t5 },
    bid_amount: amount,
    send_now: false,
    t5_decision_at: t5
  });
}

function doSend(orderNo) {
  const amount = el(`bid-${orderNo}`)?.value;
  if (!amount) { alert('Enter bid amount first'); return; }
  const load = queueLoads.find(l => String(l.order_no) === String(orderNo));
  if (!load) return;
  const t5 = new Date().toISOString();

  // Move from queue to bids
  queueLoads = queueLoads.filter(l => String(l.order_no) !== String(orderNo));
  bidLoads.unshift({ ...load, bid_amount: amount, bid_sent_at: t5 });
  if (bidLoads.length > 100) bidLoads.length = 100;
  saveState();
  renderAll();

  chrome.runtime.sendMessage({
    action: 'create_draft',
    load: { ...load, t4_reviewed_at: t5 },
    bid_amount: amount,
    send_now: true,
    t5_decision_at: t5
  });
}

function doWin(orderNo) {
  const load = bidLoads.find(l => String(l.order_no) === String(orderNo));
  if (!load) return;
  const wonAt = new Date().toISOString();

  // Move from bids to wins
  bidLoads = bidLoads.filter(l => String(l.order_no) !== String(orderNo));
  winLoads.unshift({ ...load, won_at: wonAt });
  if (winLoads.length > 100) winLoads.length = 100;
  saveState();
  renderAll();

  // Log win to Supabase
  chrome.runtime.sendMessage({
    action: 'log_win',
    load: { ...load, won_at: wonAt }
  });
}

function doDelete(orderNo) {
  bidLoads = bidLoads.filter(l => String(l.order_no) !== String(orderNo));
  saveState();
  renderBids();
  updateCounts();

  // Log delete to Supabase
  chrome.runtime.sendMessage({
    action: 'log_delete',
    load: { order_no: orderNo }
  });
}

// ─── METRICS ──────────────────────────────────────────────────────────────────

function updateMetrics(log) {
  if (!log) {
    chrome.storage.local.get('ace_metrics_log', (r) => updateMetrics(r.ace_metrics_log || []));
    return;
  }
  const today = new Date().toDateString();
  const todayLog = log.filter(m => new Date(m.created_at || m.stored_at).toDateString() === today);
  const bids   = todayLog.filter(m => m.decision === 'bid');
  const passes = todayLog.filter(m => m.decision === 'pass');
  const wins   = todayLog.filter(m => m.decision === 'win');

  el('m-scanned').textContent  = (queueLoads.length + bidLoads.length + winLoads.length + passes.length);
  el('m-qualified').textContent = todayLog.length;
  el('m-bids').textContent     = bids.length;
  el('m-passes').textContent   = passes.length;
  el('m-wins').textContent     = wins.length;

  const avg = (arr, key) => {
    const vals = arr.map(m => m[key]).filter(v => v != null);
    return vals.length ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length) : null;
  };
  const avgSpeed = avg(bids, 'bid_speed_sec');
  const ftbCount = bids.filter(m => m.bid_speed_sec != null && m.bid_speed_sec <= 45).length;
  const ftbRate  = bids.length > 0 ? Math.round((ftbCount/bids.length)*100) : null;

  el('m-avg-speed').textContent = avgSpeed != null ? secToStr(avgSpeed) : '—';
  el('m-ftb').textContent       = ftbRate  != null ? `${ftbRate}%`      : '—';
  el('last-scan').textContent   = `Updated: ${new Date().toLocaleTimeString()}`;
}

// ─── SORT ─────────────────────────────────────────────────────────────────────

el('sort-btn').addEventListener('click', () => {
  sortAsc = !sortAsc;
  el('sort-btn').textContent = sortAsc ? '⬆ Oldest First' : '⬇ Newest First';
  renderQueue();
});

// ─── MESSAGES ─────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'new_load') {
    const exists = queueLoads.find(l => String(l.order_no) === String(message.load.order_no));
    if (!exists) {
      queueLoads.unshift({ ...message.load, suggested_rate: message.suggested_rate, captured_at: Date.now() });
      if (queueLoads.length > 100) queueLoads.length = 100;
      saveState();
      renderQueue();
      updateCounts();
      updateMetrics();
    }
  }
  if (message.action === 'bid_sent') {
    // Sync from popup bid action
    queueLoads = queueLoads.filter(l => String(l.order_no) !== String(message.load.order_no));
    bidLoads.unshift({ ...message.load, bid_amount: message.bid_amount, bid_sent_at: new Date().toISOString() });
    saveState();
    renderAll();
  }
});

// ─── INIT ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadState();
  setInterval(() => updateMetrics(), 15000);
});
