// ACE Load Capture — Content Script v3.0
// Modular orchestrator — all logic in modules/
// LOCKED mode: enforces ACE settings on every scan
// OPEN mode: reads results without touching search form
/* global chrome, ACEUtils, ACEModal, ACELogin, ACESearch, ACEScanner, ACEProfile */

(function() {
  'use strict';

  let _activityPollerStarted = false;

  // ─── PAGE DETECTION ────────────────────────────────────────────────────────

  function isLoadBoardPage() {
    return window.location.pathname.toLowerCase().includes('ii14_managepostedloads') ||
           window.location.href.toLowerCase().includes('managepostedloads');
  }

  // ─── MAIN INIT ─────────────────────────────────────────────────────────────

  async function init() {
    console.log(`[ACE] v3.0 init — ${window.location.href.slice(-60)}`);
    await ACEUtils.sleep(4000);

    // Always dismiss modal first
    if (ACEModal.dismiss()) {
      await ACEUtils.randomDelay(1500, 2500);
    }

    // Get settings
    const settings = await _getSettings();
    if (settings.ace_paused) { console.log('[ACE] Paused — exiting'); return; }

    // Validate EDGEai license
    if (settings.carrier_uuid) {
      const validation = await ACEValidator.validate(settings.carrier_uuid);
      if (!validation.valid) {
        console.warn('[ACE] Invalid EDGEai subscription — ACE disabled');
        _showLicenseError();
        return;
      }
    }

    // Check operating hours — optional
    if (!ACEUtils.isWithinOperatingHours(settings)) {
      console.log('[ACE] Outside configured operating hours — standing by');
      return;
    }

    // Page routing
    if (ACELogin.isCorporatePage()) {
      if (!settings.sylectus_corp_password) {
        chrome.runtime.sendMessage({ action: 'session_expired' });
        return;
      }
      await ACELogin.doCorporate(settings.sylectus_corp_password);
      return;
    }

    if (ACELogin.isUserPage()) {
      if (!settings.sylectus_password) {
        chrome.runtime.sendMessage({ action: 'session_expired' });
        return;
      }
      await ACELogin.doUser(settings.sylectus_password);
      return;
    }

    // Not on load board — navigate there
    if (!isLoadBoardPage()) {
      console.log('[ACE] Not on load board — navigating');
      window.location.href = 'https://www6.sylectus.com/Main.aspx?page=II14_managepostedloads.asp?loadboard=True';
      return;
    }

    // On load board
    startActivityPoller();

    // LOCKED mode — ACE controls search parameters
    // OPEN mode — ACE reads results only, never touches form
    const isLocked = settings.ace_locked !== false; // default to locked
    if (isLocked && !ACESearch.isComplete()) {
      await ACESearch.setup(settings);
      await ACEUtils.randomDelay(3000, 5000);
    }

    await ACEScanner.scan(settings);
    scheduleRescan(settings);
  }

  // ─── ACTIVITY POLLER ───────────────────────────────────────────────────────

  function startActivityPoller() {
    if (_activityPollerStarted) return;
    _activityPollerStarted = true;
    setInterval(() => {
      ACEModal.simulateActivity();
      if (ACEModal.dismiss()) {
        console.log('[ACE] Poller dismissed inactivity modal');
      }
    }, 30000);
    console.log('[ACE] Activity poller started — every 30s');
  }

  // ─── RESCAN SCHEDULER ──────────────────────────────────────────────────────

  function scheduleRescan(settings) {
    const delay = Math.floor(Math.random() * (45000 - 10000 + 1)) + 10000;
    console.log(`[ACE] Next scan in ${Math.round(delay/1000)}s`);
    setTimeout(async () => {
      if (!isLoadBoardPage()) return;
      const s = await _getSettings();
      if (s.ace_paused) return;
      if (!ACEUtils.isWithinOperatingHours(s)) {
        console.log('[ACE] Outside operating hours — rescans stopped');
        return;
      }
      // LOCKED mode — re-enforce search params on each rescan
      if (s.ace_locked !== false) {
        ACESearch.reset();
        await ACESearch.setup(s);
        await ACEUtils.randomDelay(2000, 4000);
      }
      await ACEScanner.scan(s);
      scheduleRescan(s);
    }, delay);
  }

  // ─── LICENSE ERROR ─────────────────────────────────────────────────────────

  function _showLicenseError() {
    // Show a non-intrusive banner on the page
    const banner = document.createElement('div');
    banner.style.cssText = `
      position:fixed;top:0;left:0;right:0;z-index:999999;
      background:#E8A020;color:#000;padding:10px 16px;
      font-family:Arial,sans-serif;font-size:13px;font-weight:bold;
      text-align:center;
    `;
    banner.textContent = '⚡ ACE requires an active EDGEai subscription. Visit xedge-ai.com to subscribe.';
    document.body?.prepend(banner);
  }

  // ─── MESSAGE LISTENER ──────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'keepalive') {
      ACEModal.simulateActivity();
      ACEModal.dismiss();
      sendResponse({ status: 'alive' });
      return false;
    }
    if (message.action === 'do_login') {
      (async () => {
        if (ACELogin.isCorporatePage()) await ACELogin.doCorporate(message.corp_password);
        else await ACELogin.doUser(message.user_password);
      })();
      sendResponse({ status: 'ok' });
      return false;
    }
    if (message.action === 'update_search' || message.action === 'run_search') {
      ACESearch.reset();
      _getSettings().then(s => ACESearch.setup(s));
      sendResponse({ status: 'ok' });
      return false;
    }
    return false;
  });

  // ─── MUTATION OBSERVER ─────────────────────────────────────────────────────

  new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.addedNodes.length > 0) {
        if (ACEModal.dismiss() && isLoadBoardPage()) {
          ACEUtils.randomDelay(1500, 2500).then(() => init());
        }
        break;
      }
    }
  }).observe(document.body, { childList: true, subtree: true });

  // ─── SETTINGS ──────────────────────────────────────────────────────────────

  function _getSettings() {
    return new Promise(resolve => {
      chrome.storage.local.get([
        'sylectus_corp_password', 'sylectus_password', 'rpm',
        'search_from_city', 'search_from_state', 'search_to_states',
        'search_to_city', 'pickup_radius', 'bid_radius', 'max_weight',
        'target_load_types', 'ace_paused', 'ace_locked', 'carrier_uuid',
        'operating_start', 'operating_end', 'gmail_address'
      ], resolve);
    });
  }

  // ─── RUN ───────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
