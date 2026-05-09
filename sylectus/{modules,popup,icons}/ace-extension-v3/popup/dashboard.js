// ACE Load Dashboard — dashboard.js v3.0

const renderedOrders = new Set();
let metricsLog = [];

function el(id) { return document.getElementById(id); }

function secToDisplay(sec) {
  if (sec === null || sec === undefined) return '—';
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec/60)}m ${sec%60}s`;
}

function renderLoad(load) {
  if (renderedOrders.has(load.order_no)) return;
  renderedOrders.add(load.order_no);

  el('empty-state').style.display = 'none';
  el('load-table').style.display = 'table';

  const tbody = el('load-tbody');
  const tr = document.createElement('tr');
  tr.id = `row-${load.order_no}`;
  tr.className = 'new-load';

  const bidSpeedSec = load.bid_speed_sec || null;
  const tier = _getTier(bidSpeedSec);
  const tierLabel = bidSpeedSec ? secToDisplay(bidSpeedSec) : 'pending';

  tr.innerHTML = `
    <td>
      <div class="lane">${load.pickup_city || '—'}, ${load.pickup_state || ''} → ${load.delivery_city || '—'}, ${load.delivery_state || ''}</div>
      <div class="sub">PU: ${load.pickup_date || '—'} · DEL: ${load.delivery_date || '—'}</div>
    </td>
    <td>
      <div class="broker-name">${load.broker_name || '—'}</div>
      <div class="broker-email">${load.broker_email || '—'}</div>
    </td>
    <td><span style="font-family:monospace">${load.order_no}</span></td>
    <td><span class="miles-val">${load.miles || '—'}</span></td>
    <td style="font-size:11px;color:rgba(255,255,255,0.6)">${load.load_type || '—'}</td>
    <td style="font-size:11px;color:rgba(255,255,255,0.5)">${load.weight || '—'}</td>
    <td style="font-size:12px;color:#2ecc71">${load.credit_score || '—'}</td>
    <td><span class="rate-val">$${load.suggested_rate || '—'}</span></td>
    <td><span class="time-val" id="speed-${load.order_no}">${tierLabel}</span></td>
    <td><span class="tier ${tier}" id="tier-${load.order_no}">${tier}</span></td>
    <td>
      <input type="number" class="rate-input" id="bid-${load.order_no}" 
             value="${load.suggested_rate || ''}" placeholder="${load.suggested_rate || ''}">
    </td>
    <td>
      <div class="actions">
        <button class="btn-pass" onclick="doPass('${load.order_no}')">✕ Pass</button>
        <button class="btn-draft" onclick="doDraft('${load.order_no}')">Draft</button>
        <button class="btn-send" onclick="doSend('${load.order_no}')">⚡ Send</button>
      </div>
    </td>
  `;

  tbody.insertBefore(tr, tbody.firstChild);
}

function doPass(orderNo) {
  chrome.storage.local.get('ace_board_loads', (r) => {
    const loads = r.ace_board_loads || [];
    const load = loads.find(l => String(l.order_no) === String(orderNo));
    if (!load) return;
    chrome.runtime.sendMessage({
      action: 'pass_load',
      load: { ...load, t5_decision_at: new Date().toISOString() }
    });
    _markRowDecision(orderNo, 'pass');
  });
}

function doDraft(orderNo) {
  const amount = el(`bid-${orderNo}`)?.value;
  if (!amount) { alert('Enter bid amount first'); return; }
  chrome.storage.local.get('ace_board_loads', (r) => {
    const load = (r.ace_board_loads || []).find(l => String(l.order_no) === String(orderNo));
    if (!load) return;
    chrome.runtime.sendMessage({
      action: 'create_draft',
      load: { ...load, t4_reviewed_at: new Date().toISOString() },
      bid_amount: amount,
      send_now: false,
      t5_decision_at: new Date().toISOString()
    });
    _markRowDecision(orderNo, 'draft');
  });
}

function doSend(orderNo) {
  const amount = el(`bid-${orderNo}`)?.value;
  if (!amount) { alert('Enter bid amount first'); return; }
  chrome.storage.local.get('ace_board_loads', (r) => {
    const load = (r.ace_board_loads || []).find(l => String(l.order_no) === String(orderNo));
    if (!load) return;
    const t5 = new Date().toISOString();
    chrome.runtime.sendMessage({
      action: 'create_draft',
      load: { ...load, t4_reviewed_at: t5 },
      bid_amount: amount,
      send_now: true,
      t5_decision_at: t5
    });
    _markRowDecision(orderNo, 'sent');
  });
}

function _markRowDecision(orderNo, decision) {
  const row = el(`row-${orderNo}`);
  if (!row) return;
  const colors = { pass: '#e74c3c', draft: 'rgba(255,255,255,0.3)', sent: '#2ecc71' };
  row.style.opacity = '0.5';
  const actionsCell = row.querySelector('.actions');
  if (actionsCell) {
    actionsCell.innerHTML = `<span style="color:${colors[decision]};font-weight:700;font-size:12px;text-transform:uppercase">${decision === 'sent' ? '⚡ SENT' : decision === 'draft' ? '📋 DRAFT' : '✕ PASSED'}</span>`;
  }
}

function _getTier(bidSpeedSec) {
  if (bidSpeedSec === null || bidSpeedSec === undefined) return 'pending';
  if (bidSpeedSec <= 45)  return 'elite';
  if (bidSpeedSec <= 120) return 'good';
  return 'coaching';
}

function updateMetrics() {
  chrome.storage.local.get('ace_metrics_log', (r) => {
    const log = r.ace_metrics_log || [];
    metricsLog = log;

    const today = new Date().toDateString();
    const todayLog = log.filter(m => new Date(m.created_at || m.stored_at).toDateString() === today);

    const bids   = todayLog.filter(m => m.decision === 'bid');
    const passes = todayLog.filter(m => m.decision === 'pass');

    el('m-qualified').textContent = todayLog.length;
    el('m-bids').textContent      = bids.length;
    el('m-passes').textContent    = passes.length;

    // Averages
    const avg = (arr, key) => {
      const vals = arr.map(m => m[key]).filter(v => v !== null && v !== undefined);
      if (!vals.length) return null;
      return Math.round(vals.reduce((a,b) => a+b, 0) / vals.length);
    };

    const avgDetect   = avg(todayLog, 'detection_speed_sec');
    const avgAlert    = avg(todayLog, 'alert_speed_sec');
    const avgBidSpeed = avg(bids, 'bid_speed_sec');
    const ftbCount    = bids.filter(m => m.bid_speed_sec !== null && m.bid_speed_sec <= 45).length;
    const ftbRate     = bids.length > 0 ? Math.round((ftbCount / bids.length) * 100) : null;

    el('m-detect').textContent   = avgDetect   !== null ? secToDisplay(avgDetect)   : '—';
    el('m-alert').textContent    = avgAlert     !== null ? secToDisplay(avgAlert)    : '—';
    el('m-bid-speed').textContent = avgBidSpeed !== null ? secToDisplay(avgBidSpeed) : '—';
    el('m-ftb-rate').textContent  = ftbRate     !== null ? `${ftbRate}%`             : '—';
  });

  chrome.storage.local.get('ace_board_loads', (r) => {
    el('m-scanned').textContent = (r.ace_board_loads || []).length;
    el('last-scan').textContent = `Last scan: ${new Date().toLocaleTimeString()}`;
  });
}

function loadExistingLoads() {
  chrome.storage.local.get('ace_board_loads', (r) => {
    const loads = r.ace_board_loads || [];
    loads.forEach(load => renderLoad(load));
    updateMetrics();
  });
}

// Listen for new loads from background
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'new_load') {
    renderLoad(message.load);
    updateMetrics();
  }
});

// Init
document.addEventListener('DOMContentLoaded', () => {
  loadExistingLoads();
  setInterval(updateMetrics, 15000);
});
