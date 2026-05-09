// ACE — ace.js — xtxtec.com/ace mobile bid page
// Reads load from URL params or Chrome storage (if opened from extension)
// Sends bid action back to extension via chrome.storage polling

(function() {
  'use strict';

  let currentLoad = null;
  let suggestedRate = 0;

  function el(id) { return document.getElementById(id); }

  // Get order number from URL params
  function getUrlParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  // Try to load from extension storage if available (opened from popup)
  function tryLoadFromExtension() {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get(['pending_bid_load', 'rpm'], (r) => {
        if (r.pending_bid_load) {
          currentLoad = r.pending_bid_load;
          const rpm = parseFloat(r.rpm) || 2.75;
          suggestedRate = Math.round((parseFloat(currentLoad.miles) || 0) * rpm);
          renderLoad(currentLoad, rpm, suggestedRate);
        } else {
          showNoLoad();
        }
      });
    } else {
      // Opened from Gmail link — fetch load from API
      const orderNo = getUrlParam('order');
      const carrierUuid = getUrlParam('carrier');
      if (orderNo && carrierUuid) {
        fetchLoadFromAPI(orderNo, carrierUuid);
      } else {
        showNoLoad();
      }
    }
  }

  async function fetchLoadFromAPI(orderNo, carrierUuid) {
    try {
      const resp = await fetch(
        `https://edgeai-gmail-webhook-417422203146.us-central1.run.app/get-pending-load?order=${orderNo}&carrier=${carrierUuid}`
      );
      if (resp.ok) {
        const data = await resp.json();
        if (data.load) {
          currentLoad = data.load;
          const rpm = data.rpm || 2.75;
          suggestedRate = Math.round((parseFloat(currentLoad.miles) || 0) * rpm);
          renderLoad(currentLoad, rpm, suggestedRate);
          return;
        }
      }
    } catch(e) {
      console.warn('ACE: Could not fetch load from API');
    }
    showNoLoad();
  }

  function renderLoad(load, rpm, suggested) {
    el('load-view').style.display = 'block';
    el('no-load-view').style.display = 'none';
    el('status-pill').textContent = 'NEW LOAD';

    el('pickup-city').textContent   = `${load.pickup_city || '—'}, ${load.pickup_state || ''}`;
    el('delivery-city').textContent = `${load.delivery_city || '—'}, ${load.delivery_state || ''}`;
    el('pickup-date').textContent   = load.pickup_date   || '—';
    el('delivery-date').textContent = load.delivery_date || '—';
    el('load-type').textContent     = load.load_type     || '—';
    el('miles').textContent         = load.miles         || '—';
    el('vehicle').textContent       = load.vehicle_size  || '—';
    el('weight').textContent        = load.weight ? `${load.weight} lbs` : '—';
    el('order-no').textContent      = load.order_no      || '—';
    el('broker-name').textContent   = load.broker_name   || '—';
    el('broker-email').textContent  = load.broker_email  || '—';
    el('broker-contact').textContent = load.broker_contact_name || '—';
    el('credit-score').textContent  = load.credit_score  || '—';
    el('days-to-pay').textContent   = load.days_to_pay   ? `${load.days_to_pay} day pay` : '—';
    el('sug-amt').textContent       = `$${suggested}`;
    el('sug-info').textContent      = `${load.miles} mi × $${rpm}\nsuggested rate`;
    el('bid-amount').value          = suggested;
    el('bid-amount').placeholder    = String(suggested);
  }

  function showNoLoad() {
    el('load-view').style.display = 'none';
    el('no-load-view').style.display = 'block';
    el('status-pill').textContent = 'IDLE';
  }

  function getBidAmount() {
    const val = parseFloat(el('bid-amount').value);
    if (!val || val < 100) {
      el('bid-amount').style.borderColor = '#e74c3c';
      setTimeout(() => el('bid-amount').style.borderColor = 'rgba(232,160,32,0.35)', 1500);
      el('bid-amount').focus();
      return null;
    }
    return val;
  }

  function sendCommand(action, bidAmount) {
    const carrierUuid = getUrlParam('carrier') || currentLoad?.carrier_id || '';
    const orderNo = currentLoad?.order_no || getUrlParam('order') || '';
    const t5 = new Date().toISOString();

    // If in extension context
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({
        action: action === 'bid' ? 'create_draft' : 'pass_load',
        load: { ...currentLoad, t4_reviewed_at: new Date().toISOString() },
        bid_amount: bidAmount,
        send_now: action === 'bid',
        t5_decision_at: t5
      });
      return;
    }

    // Opened from Gmail — send command to Cloud Run
    fetch('https://edgeai-gmail-webhook-417422203146.us-central1.run.app/mobile-bid-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        order_no: orderNo,
        carrier_uuid: carrierUuid,
        bid_amount: bidAmount,
        t5_decision_at: t5
      })
    }).catch(e => console.warn('ACE: Command send failed', e));
  }

  function showFeedback(msg, type) {
    const fb = el('feedback');
    fb.textContent = msg;
    fb.className = `feedback ${type}`;
    fb.style.display = 'block';
    el('load-view').style.display = 'none';
  }

  // SEND NOW
  el('btn-send').addEventListener('click', () => {
    const amount = getBidAmount();
    if (!amount) return;
    el('btn-send').disabled = true;
    el('btn-send').textContent = 'Sending...';
    sendCommand('bid', amount);
    showFeedback(`⚡ Bid sent — $${amount} to ${currentLoad?.broker_name || 'broker'}`, 'ok');
  });

  // DRAFT
  el('btn-draft').addEventListener('click', () => {
    const amount = getBidAmount();
    if (!amount) return;
    el('btn-draft').disabled = true;
    sendCommand('draft', amount);
    showFeedback('📋 Draft saved in Gmail — review before sending', 'ok');
  });

  // PASS
  el('btn-pass').addEventListener('click', () => {
    sendCommand('pass', null);
    showFeedback('✕ Passed — ACE is watching for next load', 'pass');
  });

  // Use suggested
  el('use-sug').addEventListener('click', () => {
    el('bid-amount').value = suggestedRate;
    el('bid-amount').focus();
  });

  // Init
  document.addEventListener('DOMContentLoaded', tryLoadFromExtension);

})();
