// ACE Load Board v1.0

function el(id) { return document.getElementById(id); }

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

function renderBoard(loads) {
  const grid = el('tile-grid');
  const empty = el('empty-state');
  el('load-count').textContent = loads.length;

  if (!loads || loads.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  // Preserve existing tiles, only add/remove deltas
  const existing = new Set([...grid.querySelectorAll('.load-tile')].map(t => t.dataset.orderNo));
  const incoming = new Set(loads.map(l => String(l.order_no)));

  // Remove tiles no longer in list
  grid.querySelectorAll('.load-tile').forEach(tile => {
    if (!incoming.has(tile.dataset.orderNo)) tile.remove();
  });

  // Add new tiles at top
  loads.forEach(load => {
    const key = String(load.order_no);
    if (!existing.has(key)) {
      grid.insertBefore(createTile(load), grid.firstChild);
    }
  });
}

function createTile(load) {
  const tile = document.createElement('div');
  tile.className = 'load-tile';
  tile.dataset.orderNo = String(load.order_no);

  const footnotes = load.other_info || load.notes || '';
  const footHtml = footnotes
    ? `<div class="tile-footnote">📌 ${footnotes}</div>`
    : '';

  tile.innerHTML = `
    <div class="tile-lane">
      <div class="tile-cities">
        <span>${load.pickup_city || '—'}, ${load.pickup_state || ''}</span>
        <span class="lane-arrow">→</span>
        <span>${load.delivery_city || '—'}, ${load.delivery_state || ''}</span>
      </div>
      <div class="tile-meta">
        <div class="tile-chip">📅 PU: <strong>${load.pickup_date || '—'}</strong></div>
        <div class="tile-chip">🏁 DEL: <strong>${load.delivery_date || '—'}</strong></div>
        <div class="tile-chip">🔢 <strong>#${load.order_no || '—'}</strong></div>
      </div>
      ${footHtml}
    </div>
    <div class="tile-stats">
      <div class="stat-item">
        <div class="stat-label">Miles</div>
        <div class="stat-value gold">${load.miles || '—'}</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">Vehicle</div>
        <div class="stat-value">${load.vehicle_size || '—'}</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">Weight</div>
        <div class="stat-value">${load.weight ? load.weight + ' lbs' : '—'}</div>
      </div>
    </div>
    <div class="tile-broker">
      <div class="broker-name">${load.broker_name || 'Unknown Broker'}</div>
      <div class="broker-sub">${load.broker_phone || ''}</div>
      <div class="broker-sub broker-email">${load.broker_email || ''}</div>
    </div>
    <div class="tile-bid">
      <div class="suggested-label">Suggested Bid</div>
      <div class="suggested-row">
        <div class="suggested-rate">$${load.suggested_rate || '—'}</div>
        <div class="suggested-calc">${load.miles || '—'} mi × $2.75 RPM<br>suggested rate</div>
      </div>
      <div class="bid-row">
        <div class="bid-prefix">$</div>
        <input type="number" class="bid-input" value="${load.suggested_rate || ''}" placeholder="${load.suggested_rate || '360'}" min="100" max="9999" step="25">
        <span class="use-suggested">Use suggested</span>
      </div>
      <div class="tile-btns">
        <button class="btn-pass">✕ Pass</button>
        <button class="btn-draft">📋 Draft</button>
        <button class="btn-send">⚡ Send Now</button>
      </div>
      <div class="tile-feedback"></div>
    </div>
    <div class="tile-age">${load.captured_at ? timeAgo(load.captured_at) : ''}</div>
  `;

  const input = tile.querySelector('.bid-input');

  tile.querySelector('.use-suggested').addEventListener('click', () => {
    input.value = load.suggested_rate;
    input.focus();
  });

  tile.querySelector('.btn-pass').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'pass_load', load });
    showTileFeedback(tile, '✕ Passed', 'passed');
    setTimeout(() => removeFromBoard(load.order_no), 1200);
  });

  tile.querySelector('.btn-draft').addEventListener('click', () => {
    const amount = input.value;
    if (!amount || amount < 100) { highlightInput(input); return; }
    tile.querySelector('.btn-draft').disabled = true;
    chrome.runtime.sendMessage({ action: 'create_draft', load, bid_amount: amount, send_now: false });
    showTileFeedback(tile, '📋 Draft created in Gmail', 'success');
    setTimeout(() => removeFromBoard(load.order_no), 2000);
  });

  tile.querySelector('.btn-send').addEventListener('click', () => {
    const amount = input.value;
    if (!amount || amount < 100) { highlightInput(input); return; }
    tile.querySelector('.btn-send').disabled = true;
    chrome.runtime.sendMessage({ action: 'create_draft', load, bid_amount: amount, send_now: true });
    showTileFeedback(tile, `⚡ Sent — $${amount} to ${load.broker_name || 'broker'}`, 'success');
    setTimeout(() => removeFromBoard(load.order_no), 2000);
  });

  return tile;
}

function highlightInput(input) {
  input.focus();
  input.style.borderColor = '#e74c3c';
  setTimeout(() => { input.style.borderColor = 'rgba(232,160,32,0.3)'; }, 1500);
}

function showTileFeedback(tile, msg, type) {
  const fb = tile.querySelector('.tile-feedback');
  fb.textContent = msg;
  fb.className = `tile-feedback ${type}`;
  fb.style.display = 'block';
  tile.querySelector('.tile-btns').style.display = 'none';
  tile.querySelector('.bid-row').style.display = 'none';
}

function removeFromBoard(orderNo) {
  chrome.storage.local.get('ace_board_loads', (r) => {
    const loads = (r.ace_board_loads || []).filter(l => String(l.order_no) !== String(orderNo));
    chrome.storage.local.set({ ace_board_loads: loads });
  });
}

// View toggle
el('btn-tile-view').addEventListener('click', () => {
  el('board-body').classList.remove('list-view');
  el('btn-tile-view').classList.add('active');
  el('btn-list-view').classList.remove('active');
});

el('btn-list-view').addEventListener('click', () => {
  el('board-body').classList.add('list-view');
  el('btn-list-view').classList.add('active');
  el('btn-tile-view').classList.remove('active');
});

// Clear all
el('btn-clear-all').addEventListener('click', () => {
  if (confirm('Clear all captured loads from the board?')) {
    chrome.storage.local.set({ ace_board_loads: [] });
  }
});

// Live updates from storage
chrome.storage.onChanged.addListener((changes) => {
  if (changes.ace_board_loads) {
    renderBoard(changes.ace_board_loads.newValue || []);
  }
});

// Init
chrome.storage.local.get('ace_board_loads', (r) => {
  renderBoard(r.ace_board_loads || []);
});
