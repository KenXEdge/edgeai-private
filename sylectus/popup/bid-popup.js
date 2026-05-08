// ACE Load Capture — Bid Popup Script v2.0

let currentLoad = null;
let suggestedRate = 0;

function el(id) { return document.getElementById(id); }

// Load the current load data from storage
function loadCurrentLoad() {
  chrome.storage.local.get(['pending_bid_load', 'rpm'], (result) => {
    if (!result.pending_bid_load) {
      showFeedback('No active load — ACE is watching...', 'passed');
      return;
    }

    currentLoad = result.pending_bid_load;
    const rpm = parseFloat(result.rpm) || 2.75;
    const miles = parseFloat(currentLoad.miles) || 0;
    suggestedRate = Math.round(miles * rpm);

    renderLoad(currentLoad, rpm, suggestedRate);
  });
}

function renderLoad(load, rpm, suggested) {
  // Lane
  el('pickup-city').textContent = `${load.pickup_city || '—'}, ${load.pickup_state || ''}`;
  el('delivery-city').textContent = `${load.delivery_city || '—'}, ${load.delivery_state || ''}`;
  el('pickup-date').textContent = load.pickup_date || '—';
  el('delivery-date').textContent = load.delivery_date || '—';
  const footnotes = load.other_info || load.notes || '';
  el('footnotes').textContent = footnotes;
  el('footnotes-wrap').style.display = footnotes ? 'block' : 'none';

  // Details
  el('miles').textContent = load.miles || '—';
  el('vehicle-size').textContent = load.vehicle_size || '—';
  el('weight').textContent = load.weight ? `${load.weight} lbs` : '—';
  el('pickup-full').textContent = `${load.pickup_city || ''}, ${load.pickup_state || ''}`;
  el('delivery-full').textContent = `${load.delivery_city || ''}, ${load.delivery_state || ''}`;
  el('order-no').textContent = load.order_no || '—';

  // Broker
  el('broker-name').textContent = load.broker_name || '—';
  el('broker-phone').textContent = load.broker_phone || '—';
  el('broker-email').textContent = load.broker_email || '—';

  // Raw block
  el('raw-block').textContent = load.raw_row_text || '—';

  // Notes
  if (load.notes) el('notes-text').textContent = load.notes;

  // Rate
  el('suggested-amount').textContent = `$${suggested}`;
  el('suggested-calc').textContent = `${load.miles} mi × $${rpm} RPM\nsuggested rate`;
  el('bid-amount').value = suggested;
  el('bid-amount').placeholder = suggested;
}

// Use suggested rate
el('use-suggested-btn').addEventListener('click', () => {
  el('bid-amount').value = suggestedRate;
  el('bid-amount').focus();
});

// PASS
el('btn-pass').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'pass_load', load: currentLoad });
  showFeedback('✕ Passed — watching for next load', 'passed');
  setTimeout(() => window.close(), 1800);
});

// DRAFT
el('btn-draft').addEventListener('click', async () => {
  const amount = el('bid-amount').value;
  if (!amount || amount < 100) {
    el('bid-amount').focus();
    el('bid-amount').style.borderColor = '#e74c3c';
    setTimeout(() => el('bid-amount').style.borderColor = 'rgba(232,160,32,0.3)', 1500);
    return;
  }
  el('btn-draft').disabled = true;
  el('btn-draft').textContent = 'Creating...';
  chrome.runtime.sendMessage({
    action: 'create_draft',
    load: currentLoad,
    bid_amount: amount,
    send_now: false
  });
  showFeedback('📋 Draft created in Gmail — review and send', 'success');
  setTimeout(() => window.close(), 2500);
});

// SEND NOW
el('btn-send').addEventListener('click', () => {
  const amount = el('bid-amount').value;
  if (!amount || amount < 100) {
    el('bid-amount').focus();
    el('bid-amount').style.borderColor = '#e74c3c';
    setTimeout(() => el('bid-amount').style.borderColor = 'rgba(232,160,32,0.3)', 1500);
    return;
  }
  el('btn-send').disabled = true;
  el('btn-send').textContent = 'Sending...';
  chrome.runtime.sendMessage({
    action: 'create_draft',
    load: currentLoad,
    bid_amount: amount,
    send_now: true
  });
  showFeedback(`⚡ Email sent — $${amount} bid to ${currentLoad.broker_name}`, 'success');
  setTimeout(() => window.close(), 2500);
});

// Keyboard shortcut — Enter to send
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.metaKey) el('btn-send').click();
  if (e.key === 'Escape') el('btn-pass').click();
});

function showFeedback(msg, type) {
  const fb = el('feedback');
  fb.textContent = msg;
  fb.className = `feedback ${type}`;
  fb.style.display = 'block';
  el('action-buttons') && (document.querySelector('.action-buttons').style.display = 'none');
  el('rate-section') && (document.querySelector('.rate-input-row').style.display = 'none');
}

// Init
loadCurrentLoad();
