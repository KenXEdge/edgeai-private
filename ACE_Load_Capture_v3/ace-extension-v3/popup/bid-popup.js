// ACE — bid-popup.js v3.0
// Interactive bid popup — Pass / Draft / Send Now
// Captures T4 (reviewed) and T5 (decision) timestamps

let currentLoad = null;
let suggestedRate = 0;

function el(id) { return document.getElementById(id); }

function loadCurrentLoad() {
  chrome.storage.local.get(['pending_bid_load', 'rpm'], (r) => {
    if (!r.pending_bid_load) {
      showFeedback('No active load — ACE is watching...', 'pass');
      return;
    }
    currentLoad = r.pending_bid_load;

    // T4 — carrier reviewed timestamp
    currentLoad.t4_reviewed_at = new Date().toISOString();

    const rpm = parseFloat(r.rpm) || 2.75;
    const miles = parseFloat(currentLoad.miles) || 0;
    suggestedRate = Math.round(miles * rpm);

    render(currentLoad, rpm, suggestedRate);
  });
}

function render(load, rpm, suggested) {
  el('pickup-city').textContent  = `${load.pickup_city || '—'}, ${load.pickup_state || ''}`;
  el('delivery-city').textContent = `${load.delivery_city || '—'}, ${load.delivery_state || ''}`;
  el('pickup-date').textContent  = load.pickup_date   || '—';
  el('delivery-date').textContent = load.delivery_date || '—';
  el('load-type').textContent    = load.load_type     || '—';
  el('miles').textContent        = load.miles         || '—';
  el('vehicle').textContent      = load.vehicle_size  || '—';
  el('weight').textContent       = load.weight ? `${load.weight} lbs` : '—';
  el('posted-amount').textContent = load.posted_amount || '—';
  el('pickup-full').textContent  = `${load.pickup_city || ''}, ${load.pickup_state || ''}`;
  el('delivery-full').textContent = `${load.delivery_city || ''}, ${load.delivery_state || ''}`;
  el('order-no').textContent     = load.order_no      || '—';
  el('broker-name').textContent  = load.broker_name   || '—';
  el('broker-email').textContent = load.broker_email  || '—';
  el('broker-contact').textContent = load.broker_contact_name
    ? `${load.broker_contact_name}${load.broker_title ? ' · ' + load.broker_title : ''}`
    : '—';
  el('credit-score').textContent = load.credit_score  || '—';
  el('days-to-pay').textContent  = load.days_to_pay   ? `${load.days_to_pay} day pay` : '—';
  el('raw-block').textContent    = load.other_info || '';
  el('sug-amt').textContent      = `$${suggested}`;
  el('sug-calc').textContent     = `${load.miles} mi × $${rpm}\nsuggested rate`;
  el('bid-amount').value         = suggested;
  el('bid-amount').placeholder   = String(suggested);
  el('captured-at').textContent  = load.captured_at   || '';
}

function getBidAmount() {
  const val = parseFloat(el('bid-amount').value);
  if (!val || val < 100) {
    el('bid-amount').style.borderColor = '#e74c3c';
    setTimeout(() => el('bid-amount').style.borderColor = 'rgba(232,160,32,0.3)', 1500);
    el('bid-amount').focus();
    return null;
  }
  return val;
}

// PASS
el('btn-pass').addEventListener('click', () => {
  if (!currentLoad) return;
  const t5 = new Date().toISOString();
  el('btn-pass').disabled = true;
  chrome.runtime.sendMessage({
    action: 'pass_load',
    load: { ...currentLoad, t5_decision_at: t5 }
  }, () => {
    showFeedback('✕ Passed — watching for next load', 'pass');
    setTimeout(() => window.close(), 1800);
  });
});

// DRAFT
el('btn-draft').addEventListener('click', () => {
  const amount = getBidAmount();
  if (!amount) return;
  const t5 = new Date().toISOString();
  el('btn-draft').disabled = true;
  el('btn-draft').textContent = 'Creating...';

  // Listen for background confirmation
  const handler = (message) => {
    if (message.action === 'draft_created' && String(message.order_no) === String(currentLoad.order_no)) {
      chrome.runtime.onMessage.removeListener(handler);
      showFeedback('📋 Draft Bid created in Gmail — review before sending', 'ok');
      setTimeout(() => window.close(), 2500);
    }
    if (message.action === 'bid_failed' && String(message.order_no) === String(currentLoad.order_no)) {
      chrome.runtime.onMessage.removeListener(handler);
      el('btn-draft').disabled = false;
      el('btn-draft').textContent = 'Draft Bid';
      showError('Gmail error — check Gmail is connected in Settings');
    }
  };
  chrome.runtime.onMessage.addListener(handler);
  // Timeout fallback — 12s
  setTimeout(() => {
    chrome.runtime.onMessage.removeListener(handler);
    if (el('btn-draft').disabled) {
      el('btn-draft').disabled = false;
      el('btn-draft').textContent = 'Draft Bid';
      showError('No response from Gmail — check connection');
    }
  }, 12000);

  chrome.runtime.sendMessage({
    action: 'create_draft',
    load: { ...currentLoad, t4_reviewed_at: currentLoad.t4_reviewed_at },
    bid_amount: amount,
    send_now: false,
    t5_decision_at: t5
  });
});

// SEND NOW
el('btn-send').addEventListener('click', () => {
  const amount = getBidAmount();
  if (!amount) return;
  const t5 = new Date().toISOString();
  el('btn-send').disabled = true;
  el('btn-send').textContent = 'Sending...';

  // Listen for background confirmation
  const handler = (message) => {
    if (message.action === 'bid_sent' && String(message.load?.order_no) === String(currentLoad.order_no)) {
      chrome.runtime.onMessage.removeListener(handler);
      showFeedback(`⚡ Bid sent — $${amount} to ${currentLoad.broker_name}`, 'ok');
      setTimeout(() => window.close(), 2500);
    }
    if (message.action === 'bid_failed' && String(message.order_no) === String(currentLoad.order_no)) {
      chrome.runtime.onMessage.removeListener(handler);
      el('btn-send').disabled = false;
      el('btn-send').textContent = '⚡ Send Bid';
      showError('Send failed — check Gmail is connected in Settings');
    }
  };
  chrome.runtime.onMessage.addListener(handler);
  // Timeout fallback — 15s
  setTimeout(() => {
    chrome.runtime.onMessage.removeListener(handler);
    if (el('btn-send').disabled) {
      el('btn-send').disabled = false;
      el('btn-send').textContent = '⚡ Send Bid';
      showError('No response from Gmail — check connection');
    }
  }, 15000);

  chrome.runtime.sendMessage({
    action: 'create_draft',
    load: { ...currentLoad, t4_reviewed_at: currentLoad.t4_reviewed_at },
    bid_amount: amount,
    send_now: true,
    t5_decision_at: t5
  });
});

// Use suggested
el('use-sug').addEventListener('click', () => {
  el('bid-amount').value = suggestedRate;
  el('bid-amount').focus();
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) el('btn-send').click();
  if (e.key === 'Escape') el('btn-pass').click();
});

// Listen for pass from dashboard — close popup if same order or no order loaded
chrome.runtime.onMessage.addListener((message) => {
  const incomingOrder = String(message.order_no || message.load?.order_no || '');
  const currentOrder  = String(currentLoad?.order_no || '');
  const isMatch = !currentLoad || incomingOrder === currentOrder;

  if (message.action === 'pass_load' && isMatch) {
    showFeedback('✕ Passed from dashboard', 'pass');
    setTimeout(() => window.close(), 1500);
  }

  if (message.action === 'bid_sent' && isMatch) {
    showFeedback('⚡ Bid sent from dashboard', 'ok');
    setTimeout(() => window.close(), 1500);
  }

  if (message.action === 'draft_created' && isMatch) {
    showFeedback('📋 Draft Bid created from dashboard', 'ok');
    setTimeout(() => window.close(), 1500);
  }
});

function showFeedback(msg, type) {
  const fb = el('feedback');
  fb.textContent = msg;
  fb.className = `feedback ${type}`;
  fb.style.display = 'block';
  document.querySelector('.btns').style.display = 'none';
  document.querySelector('.rate-row').style.display = 'none';
}

function showError(msg) {
  const fb = el('feedback');
  fb.textContent = `⚠ ${msg}`;
  fb.className = 'feedback pass';
  fb.style.display = 'block';
  // Keep buttons visible so carrier can retry
  setTimeout(() => { fb.style.display = 'none'; }, 5000);
}

// Init
document.addEventListener('DOMContentLoaded', loadCurrentLoad);
