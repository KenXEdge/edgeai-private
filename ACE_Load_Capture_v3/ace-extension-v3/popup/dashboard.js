// ACE Load Dashboard v3.1
// Active Queue | Bids Sent | Wins
// Synchronized with bid popup

const PASS_BYPASS_COUNT = 2;
const PASS_BYPASS_MS    = 72 * 60 * 60 * 1000;
const DEDUP_MS          = 15 * 60 * 1000;
let sortAsc = false;
let passCount = 0; // authoritative in-memory pass tally for this session

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
    passCount = Object.values(passTracker).reduce((sum, t) => sum + (t.count || 0), 0);
    expireOldLoads();
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
      <td style="font-size:11px;color:rgba(255,255,255,0.4)">${load.weight||'—'}${load.posted_amount ? '<br><span style="color:#E8A020;font-size:10px;">' + load.posted_amount + '</span>' : ''}</td>
      <td class="gold-text">$${load.suggested_rate||'—'}</td>
      <td><input type="number" class="bid-input" id="bid-${load.order_no}" value="${load.suggested_rate||''}" placeholder="${load.suggested_rate||''}"></td>
      <td>
        <div class="actions">
          ${load._draft ? '<span class="draft-badge">DRAFT</span>' : ''}
          <button class="btn-p" data-action="pass" data-order="${load.order_no}">✕ Pass</button>
          <button class="btn-d" data-action="draft" data-order="${load.order_no}">Draft Bid</button>
          <button class="btn-s" data-action="send" data-order="${load.order_no}">⚡ Send Bid</button>
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
          <button class="btn-w" data-action="win" data-order="${load.order_no}">✓ WIN</button>
          <button class="btn-x" data-action="delete" data-order="${load.order_no}">DELETE</button>
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

// ─── EXPIRY ───────────────────────────────────────────────────────────────────

const EXPIRY_MS = 2 * 60 * 60 * 1000; // 2 hours from T2 detection

function expireOldLoads() {
  const now = Date.now();
  const expired = queueLoads.filter(l => {
    const detected = l.t2_detected_at ? new Date(l.t2_detected_at).getTime() : (l.captured_at || 0);
    return (now - detected) >= EXPIRY_MS;
  });
  if (expired.length === 0) return;

  // Remove expired from queue
  queueLoads = queueLoads.filter(l => {
    const detected = l.t2_detected_at ? new Date(l.t2_detected_at).getTime() : (l.captured_at || 0);
    return (now - detected) < EXPIRY_MS;
  });

  // Log each as a pass — background guards against duplicate order entries
  expired.forEach(load => {
    // passCount incremented by pass_load message listener — do not increment here
    if (!passTracker[load.order_no]) passTracker[load.order_no] = { count: 0, lastPassAt: null };
    passTracker[load.order_no].count++;
    passTracker[load.order_no].lastPassAt = now;
    chrome.runtime.sendMessage({
      action: 'pass_load',
      source: 'expiry',
      load: { ...load, t5_decision_at: new Date().toISOString() }
    });
  });

  saveState();
  console.log(`[ACE Dashboard] Expired ${expired.length} unactioned loads — logged as passes`);
}

// ─── ACTIONS ──────────────────────────────────────────────────────────────────

function doPass(orderNo) {
  const load = queueLoads.find(l => String(l.order_no) === String(orderNo));
  if (!load) return;

  // Immediate visual feedback on the button
  const btn = document.querySelector(`button[data-action="pass"][data-order="${orderNo}"]`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = '✕ Passed';
    btn.style.background = 'rgba(231,76,60,0.35)';
    btn.style.color = '#fff';
  }

  // Flash orange then remove — passCount incremented by message listener only
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

  // Send to background — background broadcasts pass_load back to dashboard listener
  // which is the single place passCount is incremented
  chrome.runtime.sendMessage({
    action: 'pass_load',
    source: 'dashboard',
    load: { ...load, t5_decision_at: new Date().toISOString() }
  });
}

function doDraft(orderNo) {
  const amount = el(`bid-${orderNo}`)?.value;
  if (!amount) { alert('Enter bid amount first'); return; }
  const load = queueLoads.find(l => String(l.order_no) === String(orderNo));
  if (!load) return;
  const t5 = new Date().toISOString();

  // Draft Bid = a bid — move to Bids Sent immediately, same as Send Bid
  queueLoads = queueLoads.filter(l => String(l.order_no) !== String(orderNo));
  bidLoads.unshift({ ...load, bid_amount: amount, bid_sent_at: t5, _drafted: true });
  if (bidLoads.length > 100) bidLoads.length = 100;
  saveState();
  renderAll();

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

  el('m-scanned').textContent   = (queueLoads.length + bidLoads.length + winLoads.length + passCount);
  el('m-qualified').textContent = todayLog.length;
  el('m-bids').textContent      = bids.length;
  el('m-passes').textContent    = passCount;
  el('m-wins').textContent      = wins.length;

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

// ─── EVENT DELEGATION — ALL BUTTON CLICKS ─────────────────────────────────────
// Inline onclick can't reach module-scope functions in extension pages.
// Delegate from the stable section containers instead.

function _wireTableDelegation() {
  // Queue tbody — pass / draft / send
  const qTbody = el('queue-tbody');
  if (qTbody) {
    qTbody.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const action  = btn.dataset.action;
      const orderNo = btn.dataset.order;
      if (action === 'pass')  doPass(orderNo);
      if (action === 'draft') doDraft(orderNo);
      if (action === 'send')  doSend(orderNo);
    });
  }

  // Bids tbody — win / delete
  const bTbody = el('bids-tbody');
  if (bTbody) {
    bTbody.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const action  = btn.dataset.action;
      const orderNo = btn.dataset.order;
      if (action === 'win')    doWin(orderNo);
      if (action === 'delete') doDelete(orderNo);
    });
  }

  // Sort button
  const sortBtn = el('sort-btn');
  if (sortBtn) {
    sortBtn.addEventListener('click', () => {
      sortAsc = !sortAsc;
      sortBtn.textContent = sortAsc ? '⬆ Oldest First' : '⬇ Newest First';
      renderQueue();
    });
  }
}

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

  // Popup or background confirmed bid sent — move to Bids Sent
  if (message.action === 'bid_sent') {
    const orderNo = message.load?.order_no;
    if (!orderNo) return;
    const load = queueLoads.find(l => String(l.order_no) === String(orderNo));
    if (load) {
      queueLoads = queueLoads.filter(l => String(l.order_no) !== String(orderNo));
      bidLoads.unshift({ ...load, bid_amount: message.bid_amount, bid_sent_at: new Date().toISOString() });
      if (bidLoads.length > 100) bidLoads.length = 100;
      saveState();
      renderAll();
    }
  }

  // Background confirmed draft created — show DRAFT badge in queue
  if (message.action === 'draft_created') {
    const orderNo = message.order_no;
    const idx = queueLoads.findIndex(l => String(l.order_no) === String(orderNo));
    if (idx > -1) {
      queueLoads[idx]._draft = true;
      saveState();
      renderQueue();
    }
  }

  // Pass from popup OR dashboard broadcast — single source of truth for passCount
  if (message.action === 'pass_load') {
    const orderNo = message.order_no;
    // Increment authoritative pass counter
    passCount++;
    el('m-passes').textContent = passCount;
    // If source is dashboard the row is already animating out — skip duplicate removal
    if (message.source === 'dashboard') return;
    const row = el(`qrow-${orderNo}`);
    if (row) {
      row.classList.add('flash-pass');
      setTimeout(() => {
        queueLoads = queueLoads.filter(l => String(l.order_no) !== String(orderNo));
        saveState();
        renderQueue();
        updateCounts();
        updateMetrics();
      }, 2000);
    } else {
      queueLoads = queueLoads.filter(l => String(l.order_no) !== String(orderNo));
      saveState();
      renderQueue();
      updateCounts();
      updateMetrics();
    }
  }

  // Background or popup reported bid failure — move load back to queue
  if (message.action === 'bid_failed') {
    const orderNo = message.order_no;
    const load = bidLoads.find(l => String(l.order_no) === String(orderNo));
    if (load) {
      bidLoads = bidLoads.filter(l => String(l.order_no) !== String(orderNo));
      const { bid_amount, bid_sent_at, ...restored } = load;
      queueLoads.unshift({ ...restored, _draft: false });
      saveState();
      renderAll();
      console.log(`[ACE Dashboard] bid_failed — order ${orderNo} moved back to queue`);
    }
  }
});

// ─── INIT ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  _wireTableDelegation();
  loadState();
  setInterval(() => updateMetrics(), 15000);
  setInterval(() => { expireOldLoads(); renderQueue(); updateCounts(); el('m-passes').textContent = passCount; }, 5 * 60 * 1000);
});
