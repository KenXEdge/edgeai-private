// ACE Load Capture — content.js — Slim Orchestrator v3.0
// Calls modules only. No logic here.
// Modules loaded via manifest.json content_scripts array before this file.
/* global chrome, ACEUtils, ACEModal, ACELogin, ACESearch, ACEScanner, ACEValidator */

(function() {
  'use strict';
  let _stopped = false;
  let _initialized = false;

  let _activityPollerStarted = false;
  let _rescheduleSettings = null;

  // ─── PAGE DETECTION ────────────────────────────────────────────────────────

  function isLoadBoardPage() {
    return window.location.href.toLowerCase().includes('managepostedloads');
  }

  // ─── SETTINGS ──────────────────────────────────────────────────────────────

  function getSettings() {
    return new Promise(resolve => {
      chrome.storage.local.get([
        'sylectus_corp_password', 'sylectus_password', 'rpm',
        'search_from_city', 'search_from_state', 'search_to_states',
        'search_to_city', 'pickup_radius', 'bid_radius', 'max_weight',
        'target_load_types', 'ace_paused', 'ace_locked',
        'operating_start', 'operating_end', 'carrier_uuid', 'gmail_address',
        'max_load_age'
      ], resolve);
    });
  }

  // ─── LICENSE BANNER ────────────────────────────────────────────────────────

  function showLicenseBanner() {
    if (document.getElementById('ace-license-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'ace-license-banner';
    banner.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:999999',
      'background:#E8A020', 'color:#000', 'padding:10px 16px',
      'font-family:Arial,sans-serif', 'font-size:13px', 'font-weight:bold',
      'text-align:center', 'cursor:pointer'
    ].join(';');
    banner.textContent = '⚡ ACE requires an active EDGEai subscription. Visit xedge-ai.com to subscribe.';
    banner.onclick = () => window.open('https://xedge-ai.com', '_blank');
    document.body?.prepend(banner);
  }

  // ─── ACTIVITY POLLER ───────────────────────────────────────────────────────

  function startActivityPoller() {
    if (_activityPollerStarted) return;
    _activityPollerStarted = true;
    setInterval(() => {
      ACEModal.simulateActivity();
      if (ACEModal.dismiss()) {
        console.log('[ACE] Poller dismissed inactivity modal');
        // If on load board, re-init after modal cleared
        if (isLoadBoardPage()) {
          ACEUtils.randomDelay(1500, 2500).then(() => {
            getSettings().then(s => {
              if (!s.ace_paused) ACESearch.reset();
            });
          });
        }
      }
    }, 30000);
    console.log('[ACE] Activity poller started — every 30s');
  }

  // ─── RESCAN SCHEDULER ──────────────────────────────────────────────────────

  function scheduleRescan(settings) {
    _rescheduleSettings = settings;
    const delay = Math.floor(Math.random() * (45000 - 10000 + 1)) + 10000;
    console.log(`[ACE] Next scan in ${Math.round(delay / 1000)}s`);
    setTimeout(async () => {
      if (_stopped) return;
      if (!isLoadBoardPage()) return;
      const s = await getSettings();
      if (s.ace_paused) return;
      if (!ACEUtils.isWithinOperatingHours(s)) {
        console.log('[ACE] Outside operating hours — rescans stopped');
        return;
      }
      // LOCKED mode — re-enforce search params on every rescan
      if (s.ace_locked !== false) {
        ACESearch.reset();
        await ACESearch.setup(s);
        await ACEUtils.randomDelay(2000, 4000);
      }
      await ACEScanner.scan(s);
      scheduleRescan(s);
    }, delay);
  }

  // ─── MAIN INIT ─────────────────────────────────────────────────────────────

  async function init() {
    if (_initialized) return;
    _initialized = true;
    console.log(`[ACE] init — ${window.location.href.slice(-60)}`);
    await ACEUtils.sleep(4000);

    // Always dismiss modal first
    if (ACEModal.dismiss()) {
      console.log('[ACE] init — modal dismissed, settling...');
      await ACEUtils.randomDelay(1500, 2500);
    }

    const settings = await getSettings();

    if (settings.ace_paused) {
      console.log('[ACE] init — paused, exiting');
      return;
    }

    // Validate EDGEai license — fail open if offline
    if (settings.carrier_uuid) {
      const validation = await ACEValidator.validate(settings.carrier_uuid);
      if (!validation.valid && validation.reason !== 'offline_failopen') {
        console.warn('[ACE] Invalid EDGEai subscription — ACE disabled');
        showLicenseBanner();
        return;
      }
    }

    // Operating hours check — optional, 24/7 if not configured
    if (!ACEUtils.isWithinOperatingHours(settings)) {
      console.log('[ACE] Outside configured operating hours — standing by');
      return;
    }

    // Corporate login page
    if (ACELogin.isCorporatePage()) {
      if (!settings.sylectus_corp_password) {
        console.warn('[ACE] Corporate password not set — open ACE settings');
        chrome.runtime.sendMessage({ action: 'session_expired' });
        return;
      }
      console.log('[ACE] init → doCorporate');
      await ACELogin.doCorporate(settings.sylectus_corp_password);
      return;
    }

    // User login page
    if (ACELogin.isUserPage()) {
      if (!settings.sylectus_password) {
        console.warn('[ACE] User password not set — open ACE settings');
        chrome.runtime.sendMessage({ action: 'session_expired' });
        return;
      }
      console.log('[ACE] init → doUser');
      await ACELogin.doUser(settings.sylectus_password);
      return;
    }

    // Not on load board — navigate there
    if (!isLoadBoardPage()) {
      console.log('[ACE] Not on load board — navigating');
      window.location.href = 'https://www6.sylectus.com/Main.aspx?page=II14_managepostedloads.asp?loadboard=True';
      return;
    }

    // On load board — start poller, setup search, scan
    startActivityPoller();

    // LOCKED mode (default) — ACE controls search params
    // OPEN mode — ACE reads results only, never touches form
    const isLocked = settings.ace_locked !== false;
    if (isLocked && !ACESearch.isComplete()) {
      await ACESearch.setup(settings);
      await ACEUtils.randomDelay(3000, 5000);
    }

    await ACEScanner.scan(settings);
    scheduleRescan(settings);
  }

  // ─── MESSAGE LISTENER ──────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    if (message.action === 'ace_stop') {
      _stopped = true;
      console.log('[ACE] ⏸ Stopped by Pause command');
      sendResponse({ status: 'stopped' });
      return false;
    }

    if (message.action === 'keepalive') {
      ACEModal.simulateActivity();
      ACEModal.dismiss();
      sendResponse({ status: 'alive' });
      return false;
    }

    if (message.action === 'do_login') {
      (async () => {
        if (ACELogin.isCorporatePage()) {
          await ACELogin.doCorporate(message.corp_password);
        } else {
          await ACELogin.doUser(message.user_password);
        }
      })();
      sendResponse({ status: 'ok' });
      return false;
    }

    if (message.action === 'update_search' || message.action === 'run_search') {
      _stopped = false;
      ACESearch.reset();
      getSettings().then(s => {
        console.log('[ACE] update_search — rerunning setup with new params');
        ACESearch.setup(s);
      });
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
          ACEUtils.randomDelay(1500, 2500).then(() => {
            _initialized = false; // allow re-init after modal cleared
            init();
          });
        }
        break;
      }
    }
  }).observe(document.body, { childList: true, subtree: true });

  // ─── RUN ───────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
