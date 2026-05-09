// ACE Settings Popup v2.0

const KEYS = {
  'corp-password':  'sylectus_corp_password',
  'user-password':  'sylectus_password',
  'from-city':      'search_from_city',
  'from-state':     'search_from_state',
  'to-states':      'search_to_states_raw',
  'pickup-radius':  'pickup_radius',
  'bid-radius':     'bid_radius',
  'max-weight':     'max_weight',
  'rpm':            'rpm',
  'ex-miles':       'example_miles'
};

function el(id) { return document.getElementById(id); }

const DEFAULT_LOAD_TYPES = ['expedited load', 'large straight', 'small straight'];

function loadSettings() {
  chrome.storage.local.get([...Object.values(KEYS), 'ace_paused', 'gmail_token', 'target_load_types'], (r) => {
    Object.entries(KEYS).forEach(([fieldId, key]) => {
      const input = el(fieldId);
      if (input && r[key] !== undefined) input.value = r[key];
    });

    // Load type checkboxes — default to Expedited + Small/Large Straight
    const saved = r.target_load_types || DEFAULT_LOAD_TYPES;
    document.querySelectorAll('.lt-cb').forEach(cb => {
      cb.checked = saved.includes(cb.value);
    });
    updateLoadTypeSummary();

    updateRPM();
    updateSearchPreview();
    updateFilterSummary();
    updateStatus(r.ace_paused ? 'paused' : (r.gmail_token ? 'active' : 'nogmail'));
    el('pause-btn').textContent = r.ace_paused ? '▶ Resume ACE' : '⏸ Pause ACE';
  });
}

function saveSettings() {
  const toSave = {};
  Object.entries(KEYS).forEach(([fieldId, key]) => {
    const input = el(fieldId);
    if (input && input.value.trim()) toSave[key] = input.value.trim();
  });

  // Parse to-states into array
  if (toSave.search_to_states_raw) {
    toSave.search_to_states = toSave.search_to_states_raw
      .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  }

  // Save selected load types
  toSave.target_load_types = [...document.querySelectorAll('.lt-cb:checked')].map(cb => cb.value);

  chrome.storage.local.set(toSave, () => {
    const msg = el('saved-msg');
    msg.classList.add('show');
    setTimeout(() => msg.classList.remove('show'), 2000);
    updateSearchPreview();
    updateFilterSummary();
    updateLoadTypeSummary();

    // Notify content script of search changes
    chrome.tabs.query({ url: 'https://www6.sylectus.com/*' }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { action: 'update_search' }).catch(() => {});
      });
    });
  });
}

function updateRPM() {
  const rpm = parseFloat(el('rpm')?.value) || 2.75;
  const miles = parseFloat(el('ex-miles')?.value) || 250;
  const res = Math.round(miles * rpm);
  el('rpm-eq').textContent = `${miles} mi × $${rpm}`;
  el('rpm-res').textContent = `= $${res}`;
}

function updateSearchPreview() {
  const city   = el('from-city')?.value     || 'Dallas';
  const state  = el('from-state')?.value    || 'TX';
  const to     = el('to-states')?.value     || 'TX, OK';
  const radius = el('pickup-radius')?.value || '50';
  const checked = [...document.querySelectorAll('.lt-cb:checked')].map(cb =>
    cb.parentElement.textContent.trim()
  );
  const typesStr = checked.length ? checked.join(', ') : '<em style="color:#e74c3c">none selected</em>';
  el('search-preview').innerHTML =
    `Search: <strong>${city}, ${state}</strong> → <strong>${to}</strong> | <strong>${radius}mi</strong> radius<br>` +
    `<span style="color:rgba(255,255,255,0.35);font-size:10px;">Types: ${typesStr}</span>`;
}

function updateFilterSummary() {
  const radius = el('bid-radius')?.value  || '300';
  const weight = el('max-weight')?.value  || '9,000';
  const to     = el('to-states')?.value   || 'TX, OK';
  const wFmt   = Number(weight).toLocaleString();
  el('filter-summary').innerHTML =
    `Alert when: <strong>≤ ${radius} mi</strong> · <strong>≤ ${wFmt} lbs</strong> · delivery in <strong>${to}</strong>`;
}

function updateLoadTypeSummary() {
  const checked = [...document.querySelectorAll('.lt-cb:checked')].map(cb => {
    return cb.parentElement.textContent.trim();
  });
  const summary = el('lt-summary');
  if (!summary) return;
  if (checked.length === 0) {
    summary.innerHTML = 'Monitoring: <strong>none selected</strong>';
  } else {
    summary.innerHTML = `Monitoring: <strong>${checked.join(', ')}</strong>`;
  }
}

function updateStatus(status) {
  const dot  = el('status-dot');
  const text = el('status-text');
  const states = {
    active:   { cls: 'green', msg: 'ACE running — watching Sylectus' },
    paused:   { cls: 'amber', msg: 'ACE paused — click Resume to restart' },
    nogmail:  { cls: 'red',   msg: 'Gmail not connected — click Connect Gmail' },
    checking: { cls: 'amber', msg: 'Checking...' }
  };
  const s = states[status] || states.checking;
  dot.className = `dot ${s.cls}`;
  text.textContent = s.msg;
}

function connectGmail() {
  chrome.identity.getAuthToken({ interactive: true }, (token) => {
    if (chrome.runtime.lastError) {
      alert('Gmail connection failed: ' + chrome.runtime.lastError.message);
      return;
    }
    chrome.storage.local.set({ gmail_token: token }, () => {
      updateStatus('active');
      alert('✓ Gmail connected successfully');
    });
  });
}

function togglePause() {
  chrome.storage.local.get('ace_paused', (r) => {
    const newState = !r.ace_paused;
    chrome.storage.local.set({ ace_paused: newState }, () => {
      el('pause-btn').textContent = newState ? '▶ Resume ACE' : '⏸ Pause ACE';
      updateStatus(newState ? 'paused' : 'active');

      if (!newState) {
        chrome.tabs.query({ url: 'https://www6.sylectus.com/*' }, (tabs) => {
          if (tabs.length > 0) {
            tabs.forEach(tab => chrome.tabs.reload(tab.id));
          } else {
            chrome.tabs.create({
              url: 'https://www6.sylectus.com/Main.aspx?page=II14_managepostedloads.asp?loadboard=True',
              active: false
            });
          }
        });
      }
    });
  });
}

// Events
document.addEventListener('DOMContentLoaded', loadSettings);
el('save-btn').addEventListener('click', saveSettings);
el('board-btn').addEventListener('click', () => chrome.runtime.sendMessage({ action: 'open_board' }));
el('gmail-btn').addEventListener('click', connectGmail);
el('pause-btn').addEventListener('click', togglePause);
el('rpm')?.addEventListener('input', updateRPM);
el('ex-miles')?.addEventListener('input', updateRPM);
el('from-city')?.addEventListener('input', updateSearchPreview);
el('from-state')?.addEventListener('input', updateSearchPreview);
el('to-states')?.addEventListener('input', updateSearchPreview);
el('pickup-radius')?.addEventListener('input', updateSearchPreview);
el('bid-radius')?.addEventListener('input', updateFilterSummary);
el('max-weight')?.addEventListener('input', updateFilterSummary);
document.querySelectorAll('.lt-cb').forEach(cb => cb.addEventListener('change', () => {
  updateLoadTypeSummary();
  updateSearchPreview();
}));
