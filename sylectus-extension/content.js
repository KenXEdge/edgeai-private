// ACE Load Capture — Content Script v2.0
// Autonomous Sylectus watcher — no SMS dependency
/* global chrome */

(function() {
  'use strict';

  const USERNAME = 'sni';
  const processedLoads = new Set();
  let searchComplete = false;

  const PROCESSED_TTL = 4 * 60 * 60 * 1000; // 4 hours

  function loadProcessedFromStorage() {
    return new Promise(resolve => {
      chrome.storage.local.get('ace_processed_loads', (r) => {
        const stored = r.ace_processed_loads || {};
        const cutoff = Date.now() - PROCESSED_TTL;
        Object.entries(stored).forEach(([orderNo, ts]) => {
          if (ts > cutoff) processedLoads.add(orderNo);
        });
        console.log(`[ACE] Loaded ${processedLoads.size} processed order#s from storage`);
        resolve();
      });
    });
  }

  function markProcessed(orderNo) {
    processedLoads.add(orderNo);
    chrome.storage.local.get('ace_processed_loads', (r) => {
      const stored = r.ace_processed_loads || {};
      const cutoff = Date.now() - PROCESSED_TTL;
      const cleaned = {};
      Object.entries(stored).forEach(([no, ts]) => {
        if (ts > cutoff) cleaned[no] = ts;
      });
      cleaned[orderNo] = Date.now();
      chrome.storage.local.set({ ace_processed_loads: cleaned });
    });
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function randomDelay(min = 500, max = 2000) {
    return sleep(Math.floor(Math.random() * (max - min + 1)) + min);
  }

  function isCSTOperatingHours() {
    const h = parseInt(new Date().toLocaleString('en-US', {
      timeZone: 'America/Chicago', hour: 'numeric', hour12: false
    }));
    return h >= 6 && h < 20;
  }


  function getSettings() {
    return new Promise(resolve => {
      try {
        chrome.storage.local.get([
          'sylectus_corp_password', 'sylectus_password', 'rpm',
          'search_from_city', 'search_from_state', 'search_to_states',
          'bid_radius', 'max_weight', 'ace_paused', 'target_load_types'
        ], resolve);
      } catch(e) {
        if ((e.message || '').includes('invalidated')) {
          console.log('[ACE] Extension context invalidated — reloading page to recover');
          window.location.reload();
        }
      }
    });
  }

  // ─── PAGE DETECTION ────────────────────────────────────────────────────────

  function isCorporateLoginPage() {
    const hasPwd = document.querySelectorAll('input[type="password"]').length >= 1;
    const noSelect = !document.querySelector('select');
    const text = document.body.innerText || '';
    return hasPwd && noSelect && !text.includes('SELECT USER');
  }

  function isUserLoginPage() {
    return !!(document.querySelector('select') &&
              document.querySelector('input[type="password"]'));
  }

  function isLoadBoardPage() {
    // Only match the inner iframe (II14_managepostedloads.asp), not Main.aspx wrapper
    return window.location.pathname.toLowerCase().includes('ii14_managepostedloads');
  }

  function isOrderProfilePage() {
    const url  = window.location.href.toLowerCase();
    const text = document.body.innerText || '';
    // Match order profile pages and broker contact popup pages
    if (url.includes('orderprofile') || url.includes('brokercontact') ||
        url.includes('viewbroker')   || url.includes('brokerinfo') ||
        url.includes('contactinfo')  || url.includes('ii21_')) {
      return true;
    }
    return (text.includes('ORDER PROFILE') || text.includes('BROKER')) &&
           (text.includes('E-MAIL') || text.includes('EMAIL') || text.includes('PHONE'));
  }

  // With all_frames:true the script runs directly in the content frame
  function getFrameDoc() { return document; }

  // ─── SESSION MANAGEMENT ───────────────────────────────────────────────────

  function isVisibleEl(el) {
    if (!el) return false;
    try {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 || rect.height > 0;
    } catch(e) { return true; }
  }

  function dismissInactivityModal() {
    function scanDoc(doc) {
      const bodyText = (doc.body?.innerText || '').toLowerCase();
      const isInactivityModal = bodyText.includes('automatic refresh paused') ||
                                bodyText.includes('still here') ||
                                bodyText.includes('are you still') ||
                                bodyText.includes('session') && bodyText.includes('expire');

      // ── Multi-session URL redirect (Login.aspx?sharing=true) ─────────────────
      // The poller runs in the inner iframe — check if the top frame landed on the sharing page
      try {
        const topUrl = (window.top.location.href || '').toLowerCase();
        if (topUrl.includes('login.aspx') && topUrl.includes('sharing=true')) {
          console.log('[ACE] Poller detected multi-session redirect — navigating to login');
          setTimeout(() => {
            try { window.top.location.href = 'https://www6.sylectus.com/Login.aspx'; } catch(e) {}
          }, 500);
          return 'multi_session';
        }
      } catch(e) { /* cross-origin guard */ }

      // ── DOM text fallback (banner still on page) ──────────────────────────────
      const isMultiSession = bodyText.includes('multiple user sessions') ||
                             (bodyText.includes('multiple') && bodyText.includes('session') && bodyText.includes('terminated'));
      if (isMultiSession) {
        doc.querySelectorAll('input[type="button"], input[type="submit"], button, a, span').forEach(el => {
          const t = (el.value || el.innerText || el.textContent || '').toLowerCase().trim();
          if (t === '×close' || t === 'close' || t === '×' || t === 'x') el.click();
        });
        console.log('[ACE] ✓ Multi-session DOM text detected — navigating to Login.aspx');
        setTimeout(() => {
          try { window.top.location.href = 'https://www6.sylectus.com/Login.aspx'; } catch(e) { window.location.href = 'https://www6.sylectus.com/Login.aspx'; }
        }, 1500);
        return 'multi_session';
      }

      const els = doc.querySelectorAll('input[type="button"], input[type="submit"], button, a');
      for (const el of els) {
        if (!isVisibleEl(el)) continue;
        const t = (el.value || el.innerText || el.textContent || '')
          .toLowerCase().replace(/[''‚‛]/g, "'").trim();
        // Match any variation of the "still here" / "wait" / "continue" confirm button
        if (t === 'wait!' || t === 'wait' ||
            t === "wait, i'm still here!" ||
            t.includes('still here') ||
            t.includes("i'm still") ||
            t.includes('i\'m here') ||
            (t.includes('continue') && isInactivityModal) ||
            (t.includes('yes') && isInactivityModal) ||
            (t.includes('ok') && isInactivityModal)) {
          el.click();
          console.log(`[ACE] ✓ Dismissed inactivity modal — button: "${t}"`);
          return true;
        }
      }
      // Last resort — modal detected, click the last VISIBLE button on the page
      if (isInactivityModal) {
        const btns = [...doc.querySelectorAll('input[type="button"], input[type="submit"], button')].filter(isVisibleEl);
        const last = btns[btns.length - 1];
        if (last) {
          last.click();
          console.log(`[ACE] ✓ Dismissed inactivity modal (last button: "${(last.value || last.innerText || '').trim()}")`);
          return true;
        }
      }
      return false;
    }

    if (scanDoc(document)) return true;

    // Scan child iframes
    for (const frame of document.querySelectorAll('iframe')) {
      try {
        const fdoc = frame.contentDocument || frame.contentWindow.document;
        if (scanDoc(fdoc)) return true;
      } catch (e) { /* cross-origin */ }
    }

    // Scan parent frames — modal may render in Main.aspx while script runs in inner iframe
    try { if (window.parent && window.parent !== window && scanDoc(window.parent.document)) return true; } catch(e) {}
    try { if (window.top && window.top !== window && window.top !== window.parent && scanDoc(window.top.document)) return true; } catch(e) {}

    return false;
  }

  function simulateActivity() {
    const x = Math.floor(Math.random() * 600) + 100;
    const y = Math.floor(Math.random() * 400) + 100;
    const targets = [document];
    // Also dispatch into parent/top frames — Sylectus inactivity timer runs at Main.aspx level
    try { if (window.parent && window.parent !== window) targets.push(window.parent.document); } catch(e) {}
    try { if (window.top && window.top !== window && window.top !== window.parent) targets.push(window.top.document); } catch(e) {}

    targets.forEach(doc => {
      doc.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
      doc.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y }));
      doc.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, clientX: x, clientY: y }));
      doc.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: ' ', keyCode: 32 }));
    });

    // Override confirm on all reachable windows so Sylectus dialogs auto-confirm
    [window, window.parent, window.top].forEach(w => {
      try { if (w && !w._aceConfirmPatched) { w.confirm = () => true; w._aceConfirmPatched = true; } } catch(e) {}
    });
  }

  // ─── LOGIN ─────────────────────────────────────────────────────────────────

  let _corpLoginAttempted = false;

  async function doCorporateLogin(corpPassword) {
    if (_corpLoginAttempted) return;
    _corpLoginAttempted = true;

    // Find the corporate password field — avoid Reset Password modal fields
    // by picking the field whose label context mentions "corporate" or "password" but not "reset/new/confirm"
    let passField = null;
    for (const f of document.querySelectorAll('input[type="password"]')) {
      const ctx = (f.closest('td,div,form,table')?.innerText || '').toLowerCase();
      if (ctx.includes('reset') || ctx.includes('new password') || ctx.includes('confirm')) continue;
      passField = f;
      break;
    }
    passField = passField || document.querySelector('input[type="password"]');
    if (!passField) { console.warn('[ACE] Corp login — no password field found'); return; }

    passField.focus();
    passField.value = corpPassword;
    passField.dispatchEvent(new Event('input',  { bubbles: true }));
    passField.dispatchEvent(new Event('change', { bubbles: true }));
    passField.dispatchEvent(new Event('blur',   { bubbles: true }));
    await randomDelay();

    // ASP.NET WebForms: form.defaultButton holds the ID of the Enter-key submit button
    const form = passField.closest('form') || document.querySelector('form');
    if (form) {
      const defaultBtnId = form.getAttribute('defaultbutton') || form.getAttribute('DefaultButton');
      const defaultBtn = defaultBtnId ? document.getElementById(defaultBtnId) : null;
      if (defaultBtn) {
        defaultBtn.click();
        console.log('[ACE] ✓ Corp login — defaultButton clicked:', defaultBtnId);
        return;
      }

      // Scan all elements (including <a> tags) for Continue / login text
      const noise = ['cancel', 'back', 'reset', 'close', 'cookie', 'reject', 'get start', 'member', 'forgot', 'detail'];
      for (const el of document.querySelectorAll('a, input, button')) {
        const t = (el.value || el.innerText || el.textContent || '').toLowerCase().trim();
        if (!t || noise.some(w => t.includes(w))) continue;
        if (t.includes('continu') || t.includes('log in') || t.includes('login') || t.includes('sign in')) {
          const href = el.getAttribute('href') || el.getAttribute('onclick') || '';
          console.log('[ACE] Continue el href:', href);

          // Extract __doPostBack target from any quote style
          const m = href.match(/__doPostBack\(['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\)/);
          if (m && typeof window.__doPostBack === 'function') {
            window.__doPostBack(m[1], m[2]);
            console.log('[ACE] ✓ Corp login — __doPostBack:', m[1]);
            return;
          }

          // ASP.NET: set __EVENTTARGET using $ format from href (not el.id which uses _)
          const postbackTarget = m ? m[1] : (el.id || '').replace(/_/g, '$');
          const evtTarget = form.querySelector('input[name="__EVENTTARGET"]');
          const evtArg    = form.querySelector('input[name="__EVENTARGUMENT"]');
          if (evtTarget) evtTarget.value = postbackTarget;
          if (evtArg)    evtArg.value    = '';
          console.log('[ACE] ✓ Corp login — __EVENTTARGET:', postbackTarget);
          form.submit();
          return;
        }
      }

      // No button found — press Enter on the password field
      passField.focus();
      ['keydown', 'keypress', 'keyup'].forEach(type =>
        passField.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', keyCode: 13, bubbles: true }))
      );
      console.log('[ACE] ✓ Corp login — Enter key on password field');
    }
  }

  async function doUserLogin(userPassword) {
    // Select the correct user from the dropdown
    const userSelect = document.querySelector('select');
    if (userSelect) {
      for (const opt of userSelect.options) {
        if ((opt.value || opt.text || '').toLowerCase().includes(USERNAME)) {
          userSelect.value = opt.value;
          userSelect.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
      }
    }
    await randomDelay();

    // Pick the correct password field — skip reset/new password modal fields
    let passField = null;
    for (const f of document.querySelectorAll('input[type="password"]')) {
      const ctx = (f.closest('td,div,form,table')?.innerText || '').toLowerCase();
      if (ctx.includes('reset') || ctx.includes('new password') || ctx.includes('confirm')) continue;
      passField = f;
      break;
    }
    passField = passField || document.querySelector('input[type="password"]');
    if (!passField) return;

    passField.focus();
    passField.value = userPassword;
    passField.dispatchEvent(new Event('input',  { bubbles: true }));
    passField.dispatchEvent(new Event('change', { bubbles: true }));
    passField.dispatchEvent(new Event('blur',   { bubbles: true }));
    await randomDelay();

    const form = passField.closest('form') || document.querySelector('form');
    if (!form) return;

    // Diagnostic — log all interactive elements to help debug if wrong button fires
    const allEls = [...document.querySelectorAll('a[href], input[type="submit"], input[type="button"], button')];
    console.log(`[ACE] User login page — ${allEls.length} interactive elements:`);
    allEls.forEach(el => {
      const t = (el.value || el.innerText || el.textContent || '').toLowerCase().trim().slice(0, 60);
      const href = (el.getAttribute('href') || '').slice(0, 80);
      console.log(`  [${el.tagName}#${el.id}] "${t}" href="${href}"`);
    });

    // Try ASP.NET defaultButton first (most reliable)
    const defaultBtnId = form.getAttribute('defaultbutton') || form.getAttribute('DefaultButton');
    const defaultBtn = defaultBtnId ? document.getElementById(defaultBtnId) : null;
    if (defaultBtn) {
      const href = defaultBtn.getAttribute('href') || defaultBtn.getAttribute('onclick') || '';
      const m = href.match(/__doPostBack\(['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\)/);
      if (m) {
        const evtTarget = form.querySelector('input[name="__EVENTTARGET"]');
        const evtArg    = form.querySelector('input[name="__EVENTARGUMENT"]');
        if (evtTarget) evtTarget.value = m[1];
        if (evtArg)    evtArg.value    = '';
        console.log('[ACE] ✓ User login — defaultButton __EVENTTARGET:', m[1]);
        form.submit();
        return;
      }
      defaultBtn.click();
      console.log('[ACE] ✓ User login — defaultButton clicked:', defaultBtnId);
      return;
    }

    // Scan for login button — prioritise elements with __doPostBack in href
    const noise = ['cancel', 'back', 'reset', 'close', 'cookie', 'reject', 'get start', 'member', 'forgot', 'detail', 'save', 'delete', 'remove'];
    const loginWords = ['continu', 'log in', 'login', 'sign in'];

    // First pass — only elements that have __doPostBack in href
    for (const el of document.querySelectorAll('a, input, button')) {
      const t = (el.value || el.innerText || el.textContent || '').toLowerCase().trim();
      if (!t || noise.some(w => t.includes(w))) continue;
      const href = el.getAttribute('href') || el.getAttribute('onclick') || '';
      if (!href.includes('__doPostBack')) continue;
      if (loginWords.some(w => t.includes(w))) {
        const m = href.match(/__doPostBack\(['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\)/);
        const postbackTarget = m ? m[1] : (el.id || '').replace(/_/g, '$');
        const evtTarget = form.querySelector('input[name="__EVENTTARGET"]');
        const evtArg    = form.querySelector('input[name="__EVENTARGUMENT"]');
        if (evtTarget) evtTarget.value = postbackTarget;
        if (evtArg)    evtArg.value    = '';
        console.log('[ACE] ✓ User login — __EVENTTARGET (postback):', postbackTarget, 'text:', t);
        form.submit();
        return;
      }
    }

    // Second pass — any element with login words (no postback requirement)
    for (const el of document.querySelectorAll('a, input[type="submit"], input[type="button"], button')) {
      const t = (el.value || el.innerText || el.textContent || '').toLowerCase().trim();
      if (!t || noise.some(w => t.includes(w))) continue;
      if (loginWords.some(w => t.includes(w))) {
        const href = el.getAttribute('href') || el.getAttribute('onclick') || '';
        const m = href.match(/__doPostBack\(['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\)/);
        const postbackTarget = m ? m[1] : (el.id || '').replace(/_/g, '$');
        const evtTarget = form.querySelector('input[name="__EVENTTARGET"]');
        const evtArg    = form.querySelector('input[name="__EVENTARGUMENT"]');
        if (evtTarget && postbackTarget) evtTarget.value = postbackTarget;
        if (evtArg)    evtArg.value    = '';
        console.log('[ACE] ✓ User login — __EVENTTARGET (fallback):', postbackTarget, 'text:', t);
        form.submit();
        return;
      }
    }

    // Last resort — Enter key
    passField.focus();
    ['keydown', 'keypress', 'keyup'].forEach(type =>
      passField.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', keyCode: 13, bubbles: true }))
    );
    console.log('[ACE] ✓ User login — Enter key');
  }

  function findSubmitButton() {
    const candidates = document.querySelectorAll(
      'input[type="submit"], input[type="image"], button[type="submit"], input[type="button"], button'
    );
    const accept = ['log in', 'login', 'sign in', 'submit', 'continu', 'next'];
    const reject = ['cookie', 'consent', 'close', 'dismiss', 'accept all', 'alert',
                    'cancel', 'back', 'reset', 'filter', 'clear', 'reject', 'detail'];

    for (const btn of candidates) {
      const t = (btn.value || btn.src || btn.innerText || btn.textContent || '').toLowerCase().trim();
      if (reject.some(r => t.includes(r))) continue;
      if (accept.some(a => t.includes(a))) return btn;
    }
    // Last resort — first candidate that isn't noise
    for (const btn of candidates) {
      const t = (btn.value || btn.src || btn.innerText || btn.textContent || '').toLowerCase().trim();
      if (!reject.some(r => t.includes(r))) return btn;
    }
    return null;
  }

  // ─── SEARCH SETUP ──────────────────────────────────────────────────────────

  async function setupSearch(settings) {
    if (searchComplete) return;
    console.log('[ACE] setupSearch — start');
    await randomDelay(1500, 2500);

    dismissInactivityModal();
    await randomDelay();

    const doc = getFrameDoc();

    const fromCity = settings.search_from_city || 'Dallas';
    const fromState = settings.search_from_state || 'TX';
    const toStates = settings.search_to_states || ['TX', 'OK'];
    const targetTypes = (settings.target_load_types && settings.target_load_types.length > 0)
      ? settings.target_load_types
      : ['expedited load', 'large straight', 'small straight'];
    console.log(`[ACE] setupSearch — from: ${fromCity}, ${fromState} | to: ${toStates} | types: ${targetTypes}`);

    // All known Sylectus load type label strings
    const allLoadTypes = [
      'expedited load', 'expedited truck load', 'truckload', 'less than truckload',
      'truckload/ltl', 'courier', 'flatbed', 'dump trailer', 'reefer', 'small straight',
      'large straight', 'lane/project', 'air freight', 'air charter', 'climate control',
      'cargo van', 'sprinter', 'other'
    ];

    // Load type checkboxes — label may be in adjacent td, next text node, or same cell
    const allCheckboxes = doc.querySelectorAll('input[type="checkbox"]');
    console.log(`[ACE] setupSearch — found ${allCheckboxes.length} checkboxes`);

    allCheckboxes.forEach(cb => {
      const cell = cb.closest('td');
      const nextCell = cell?.nextElementSibling;
      let txt = (cell?.innerText || cell?.textContent || '') + ' ' +
                (nextCell?.innerText || nextCell?.textContent || '');
      let node = cb.nextSibling;
      while (node) {
        if (node.nodeType === 3) txt += node.textContent;
        node = node.nextSibling;
      }
      txt = txt.toLowerCase().trim();

      const isLoadType = allLoadTypes.some(t => txt.includes(t));
      const isTarget   = targetTypes.some(t => txt.includes(t));

      if (isTarget && !cb.checked) {
        console.log(`[ACE] checking: "${txt.slice(0, 40)}"`);
        cb.click();
      } else if (isLoadType && !isTarget && cb.checked) {
        console.log(`[ACE] unchecking: "${txt.slice(0, 40)}"`);
        cb.click();
      }
    });

    await randomDelay(300, 800);

    // FROM city input
    const inputs = doc.querySelectorAll('input[type="text"]');
    console.log(`[ACE] setupSearch — found ${inputs.length} text inputs`);
    let fromCitySet = false;
    for (const inp of inputs) {
      const n = (inp.name || inp.id || '').toLowerCase();
      console.log(`[ACE]   input name/id: "${inp.name || inp.id}"`);
      if (n.includes('city') || n.includes('from_city') || n.includes('fromcity')) {
        inp.value = fromCity;
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        fromCitySet = true;
        console.log(`[ACE] ✓ FROM city set: ${fromCity}`);
        break;
      }
    }
    if (!fromCitySet) console.warn('[ACE] ✗ FROM city input not found');

    // FROM state select
    const selects = Array.from(doc.querySelectorAll('select'));
    console.log(`[ACE] setupSearch — found ${selects.length} selects`);
    selects.forEach(s => console.log(`[ACE]   select name/id: "${s.name || s.id}"`));

    let fromStateSet = false;
    for (const sel of selects) {
      const n = (sel.name || sel.id || '').toLowerCase();
      if (n.includes('from') && n.includes('state')) {
        for (const opt of sel.options) {
          if ((opt.value || opt.text || '').includes(fromState)) {
            sel.value = opt.value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            fromStateSet = true;
            console.log(`[ACE] ✓ FROM state set: ${fromState}`);
            break;
          }
        }
        break;
      }
    }
    if (!fromStateSet) console.warn('[ACE] ✗ FROM state select not found');

    await randomDelay(300, 900);

    // TO states — multi-select
    let toStateSet = false;
    for (const sel of selects) {
      const n = (sel.name || sel.id || '').toLowerCase();
      if (n.includes('to') && n.includes('state')) {
        for (const opt of sel.options) {
          const v = (opt.value || opt.text || '').toUpperCase();
          opt.selected = toStates.some(s => v.includes(s.toUpperCase()));
        }
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        toStateSet = true;
        console.log(`[ACE] ✓ TO states set: ${toStates}`);
        break;
      }
    }
    if (!toStateSet) console.warn('[ACE] ✗ TO states select not found');

    await randomDelay(300, 900);

    // Pickup within 50 miles
    let milesSet = false;
    for (const inp of inputs) {
      const n = (inp.name || inp.id || '').toLowerCase();
      if (n.includes('within') || n.includes('miles') || n.includes('radius')) {
        inp.value = '50';
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        milesSet = true;
        console.log('[ACE] ✓ Pickup radius set: 50 miles');
        break;
      }
    }
    if (!milesSet) console.warn('[ACE] ✗ Pickup radius input not found');

    await randomDelay(500, 1200);

    // Don't re-click Search All if this is a post-submit reload (not a manual F5 refresh)
    const navType = performance.getEntriesByType('navigation')[0]?.type;
    const lastSearchTs = parseInt(sessionStorage.getItem('ace_search_ts') || '0');
    const searchWasRecent = (Date.now() - lastSearchTs) < 45000;
    if (navType !== 'reload' && searchWasRecent) {
      console.log('[ACE] setupSearch — post-search reload detected, skipping re-click');
      searchComplete = true;
      return;
    }

    // Click Search All Postings — buttons only, never <a> tags (avoids nav links like SearchAlliance)
    const allButtons = doc.querySelectorAll('input[type="button"], input[type="submit"], button');
    console.log(`[ACE] setupSearch — scanning ${allButtons.length} buttons for search button`);
    for (const btn of allButtons) {
      const t = (btn.value || btn.innerText || btn.textContent || '').toLowerCase().trim();
      if (t) console.log(`[ACE]   btn: "${t.slice(0, 50)}"`);
      if (t.includes('search all')) {
        sessionStorage.setItem('ace_search_ts', String(Date.now()));
        btn.click();
        searchComplete = true;
        console.log('[ACE] ✓ Search All Postings clicked');
        return;
      }
    }

    console.warn('[ACE] ✗ Search All Postings button not found');
  }

  // ─── LOAD SCANNING ─────────────────────────────────────────────────────────

  function findResultsDoc() {
    // Try current document first
    if (document.querySelectorAll('tr').length > 5) return document;
    // Walk same-origin iframes looking for the results table
    for (const iframe of document.querySelectorAll('iframe')) {
      try {
        const d = iframe.contentDocument || iframe.contentWindow?.document;
        if (d && d.querySelectorAll('tr').length > 5) return d;
        // Two levels deep
        for (const inner of d.querySelectorAll('iframe')) {
          try {
            const d2 = inner.contentDocument || inner.contentWindow?.document;
            if (d2 && d2.querySelectorAll('tr').length > 5) return d2;
          } catch (e) { /* cross-origin */ }
        }
      } catch (e) { /* cross-origin */ }
    }
    return document;
  }

  let _emptyScans = 0;

  async function selfHeal(settings) {
    console.log('[ACE] selfHeal — attempting recovery...');

    // Step 1: try to dismiss any blocking modal
    const dismissed = dismissInactivityModal();
    if (dismissed) {
      console.log('[ACE] selfHeal — modal dismissed, resetting search');
      await randomDelay(2000, 3000);
    } else {
      console.log('[ACE] selfHeal — no modal found, resetting search anyway');
    }

    // Step 2: reset search and re-run it
    searchComplete = false;
    _emptyScans = 0;
    await setupSearch(settings);
    await randomDelay(3000, 5000);
    await scanLoadBoard(settings);
  }

  async function scanLoadBoard(settings) {
    await randomDelay(2000, 4000);

    // Always try to clear any modal before parsing
    dismissInactivityModal();

    const doc = findResultsDoc();
    const rows = doc.querySelectorAll('tr');
    console.log(`[ACE] scanLoadBoard — ${rows.length} rows | iframes: ${document.querySelectorAll('iframe').length} | doc: ${doc === document ? window.location.href.slice(-50) : 'iframe'}`);
    let newCount = 0;
    let skippedCells = 0;
    let skippedNoOrder = 0;
    let skippedNoCity = 0;

    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 5) { skippedCells++; continue; }

      const links = row.querySelectorAll('a');
      let orderNo = null;
      let orderLink = null;

      // Try links first
      for (const link of links) {
        const txt = (link.innerText || '').trim();
        if (/^\d{4,}$/.test(txt)) { orderNo = txt; orderLink = link; break; }
      }
      // Fall back to any line within any cell that is pure numeric
      if (!orderNo) {
        for (const cell of cells) {
          for (const line of (cell.innerText || '').split('\n')) {
            const txt = line.trim();
            if (/^\d{4,}$/.test(txt)) { orderNo = txt; break; }
          }
          if (orderNo) break;
        }
      }

      if (!orderNo) {
        // Diagnostic — log first 3 missed rows so we can see the actual cell content
        if (skippedNoOrder < 3) {
          console.log(`[ACE] no order# row — cells:${cells.length} | c0:"${cells[0]?.innerText?.trim().slice(0,40)}" | c1:"${cells[1]?.innerText?.trim().slice(0,40)}" | links:[${[...links].map(l=>`"${l.innerText?.trim().slice(0,20)}"`).join(',')}]`);
        }
        skippedNoOrder++;
        continue;
      }
      if (processedLoads.has(orderNo)) { skippedNoOrder++; continue; }

      const load = extractRowData(row, cells, orderNo, orderLink);
      if (!load.pickup_city) { skippedNoCity++; continue; }

      // Bid filters — miles and weight checked before fetching order profile
      const loadMiles  = parseFloat(load.miles)  || 0;
      const loadWeight = parseFloat(load.weight) || 0;
      const bidRadius  = parseFloat(settings.bid_radius)  || 300;
      const maxWeight  = parseFloat(settings.max_weight)  || 9000;

      if (loadMiles > 0 && loadMiles > bidRadius) {
        console.log(`[ACE] skip #${orderNo} — ${loadMiles}mi exceeds ${bidRadius}mi radius`);
        markProcessed(orderNo);
        continue;
      }
      if (loadWeight > 0 && loadWeight > maxWeight) {
        console.log(`[ACE] skip #${orderNo} — ${loadWeight}lbs exceeds ${maxWeight}lbs max`);
        markProcessed(orderNo);
        continue;
      }

      // Load type filter — exact match only, no substring spillover (e.g. "Van" must not pass for "Cargo Van")
      const targetTypes = (settings.target_load_types && settings.target_load_types.length > 0)
        ? settings.target_load_types
        : ['expedited load', 'large straight', 'small straight'];
      const loadTypeLower = (load.load_type || '').toLowerCase().trim();
      const typeMatches = targetTypes.length === 0 || !loadTypeLower ||
        targetTypes.some(t => loadTypeLower === t || loadTypeLower === t.toLowerCase());
      if (!typeMatches) {
        console.log(`[ACE] skip #${orderNo} — type "${load.load_type}" not in target list`);
        markProcessed(orderNo);
        continue;
      }

      markProcessed(orderNo);
      newCount++;
      console.log(`[ACE] load #${orderNo} — ${load.pickup_city}, ${load.pickup_state} → ${load.delivery_city}, ${load.delivery_state} | ${loadMiles}mi | ${loadWeight}lbs | profile link: ${load.broker_href ? load.broker_href.split('?')[0].split('/').pop() : 'NONE'}`);

      await processLoad(load, settings);
      await randomDelay(1500, 3500);
    }

    console.log(`[ACE] scanLoadBoard done — new: ${newCount}, skipped (cells<5): ${skippedCells}, no order#: ${skippedNoOrder}, no city: ${skippedNoCity}`);

    // Self-heal: if the table had almost no rows, the board is likely blocked
    // 3 consecutive empty scans triggers a full recovery attempt
    const tableIsEmpty = rows.length < 3;
    if (tableIsEmpty) {
      _emptyScans++;
      console.warn(`[ACE] Empty board detected (${_emptyScans}/3) — may be blocked`);
      if (_emptyScans >= 3) {
        await selfHeal(settings);
      }
    } else {
      _emptyScans = 0;
    }
  }

  function stripNoise(text) {
    if (!text) return '';
    return text
      .replace(/days to pay[:\s]*\d+/gi, '')
      .replace(/credit score[:\s]*[\d.]+\s*%?/gi, '')
      .replace(/s\.a\.f\.e\.r\.?/gi, '')
      .replace(/teana member/gi, '')
      .replace(/saferwatch/gi, '')
      .replace(/[\s,|\/;–-]+$/, '')
      .trim();
  }

  // Sylectus company links are javascript:window.open(...) — extract the real URL
  function extractProfileUrl(el) {
    if (!el) return '';
    const rawHref = el.getAttribute('href') || '';
    const onclick  = el.getAttribute('onclick') || '';
    const source   = rawHref + ' ' + onclick;

    // Already a plain usable URL
    if (rawHref && !rawHref.startsWith('javascript:') && !rawHref.startsWith('#')) {
      return el.href;
    }
    // window.open('/path', ...) pattern
    const wo = source.match(/window\.open\s*\(\s*['"]([^'"]+)['"]/i);
    if (wo) {
      const p = wo[1];
      return p.startsWith('http') ? p : `https://www6.sylectus.com${p.startsWith('/') ? '' : '/'}${p}`;
    }
    // Any quoted .asp path
    const asp = source.match(/['"]([^'"]*\.asp[^'"]*)['"]/i);
    if (asp) {
      const p = asp[1];
      return p.startsWith('http') ? p : `https://www6.sylectus.com/${p.replace(/^\//, '')}`;
    }
    console.log(`[ACE] extractProfileUrl unresolved — href="${rawHref}" onclick="${onclick.slice(0, 80)}"`);
    return '';
  }

  function extractRowData(row, cells, orderNo, orderLink) {
    // Skip SaferWatch link (always first) — find the Sylectus profile link
    const cellLinks = [...(cells[0]?.querySelectorAll('a') || [])];
    const companyLink = cellLinks.find(l => {
      const src = (l.getAttribute('href') || '') + (l.getAttribute('onclick') || '');
      return src.includes('window.open') || src.includes('.asp');
    }) || cellLinks[cellLinks.length - 1] || null;

    // Log raw link so we can see exactly what Sylectus puts on the red broker link
    if (companyLink) {
      console.log(`[ACE] cells[0] link — text="${companyLink.innerText?.trim().slice(0,40)}" href="${companyLink.getAttribute('href')?.slice(0,100)}" onclick="${(companyLink.getAttribute('onclick')||'').slice(0,120)}"`);
    }

    const profileUrl = extractProfileUrl(companyLink) || extractProfileUrl(orderLink);

    const load = {
      order_no: orderNo,
      raw_row_text: row.innerText.trim(),
      raw_row_html: row.outerHTML,
      broker_name: '',
      broker_href: profileUrl
    };

    // Column layout (from confirmed headers):
    // [0] POSTED BY / NOTES — broker company + credit info
    // [1] REF.NO / LOAD TYPE / BROKER MC# — ref number, load type, MC number
    // [2] ORDER NO / AMOUNT — order number (already captured), bid amount
    // [3] PICK-UP AT / DATE-TIME
    // [4] DELIVER TO / DATE-TIME
    // [5] POST DATE / EXPIRES
    // [6] VEH. SIZE / MILES
    // [7] PCS / WT
    // [8] Other Info.
    // [9] BID ON LOAD

    // cells[0]: broker posted-by info
    const cell0Lines = (cells[0]?.innerText || '').trim().split('\n').map(s => s.trim()).filter(Boolean);
    load.broker_name = cell0Lines[0] || '';

    // cells[1]: ref no / load type / MC#
    const cell1Lines = (cells[1]?.innerText || '').trim().split('\n').map(s => s.trim()).filter(Boolean);
    load.load_type = cell1Lines[0] || '';
    load.ref_no = cell1Lines[1] || '';
    load.mc_number_raw = cell1Lines[2] || '';

    // cells[2]: order no (already captured) / amount
    const cell2Lines = (cells[2]?.innerText || '').trim().split('\n').map(s => s.trim()).filter(Boolean);
    load.bid_amount_posted = cell2Lines[1] || '';

    // cells[3]: pickup city, state zip / pickup date
    const puLines = (cells[3]?.innerText || '').trim().split('\n').map(s => s.trim()).filter(Boolean);
    if (puLines.length >= 1) {
      const cs = puLines[0].split(',');
      load.pickup_city = cs[0]?.trim() || '';
      const stateZip = (cs[1] || '').trim().split(' ');
      load.pickup_state = stateZip[0] || '';
      load.pickup_zip = stateZip[1] || '';
    }
    load.pickup_date = puLines[1] || '';

    // cells[4]: delivery city, state zip / delivery date
    const delLines = (cells[4]?.innerText || '').trim().split('\n').map(s => s.trim()).filter(Boolean);
    if (delLines.length >= 1) {
      const cs = delLines[0].split(',');
      load.delivery_city = cs[0]?.trim() || '';
      const stateZip = (cs[1] || '').trim().split(' ');
      load.delivery_state = stateZip[0] || '';
      load.delivery_zip = stateZip[1] || '';
    }
    load.delivery_date = delLines[1] || '';

    // cells[5]: post date / expiry date
    const dateLines = (cells[5]?.innerText || '').trim().split('\n').map(s => s.trim()).filter(Boolean);
    load.post_date = dateLines[0] || '';
    load.expiry_date = dateLines[1] || '';

    // cells[6]: vehicle type / miles
    const vehLines = (cells[6]?.innerText || '').trim().split('\n').map(s => s.trim()).filter(Boolean);
    load.vehicle_size = vehLines[0] || '';
    load.miles = (vehLines[1] || '').replace(/[^0-9]/g, '');

    // cells[7]: pieces / weight
    const pcsLines = (cells[7]?.innerText || '').trim().split('\n').map(s => s.trim()).filter(Boolean);
    load.pieces = pcsLines[0] || '';
    load.weight = pcsLines[1] || '';

    // cells[8]: Other Info (P/U TIME, DEL TIME, special instructions)
    load.other_info = stripNoise((cells[8]?.innerText || '').trim().replace(/\s+/g, ' '));

    return load;
  }

  // Open profile in a real background tab — no fetch() to avoid corrupting ASP session
  async function processLoad(load, settings) {
    await randomDelay();

    const rpm = parseFloat(settings.rpm) || 2.75;
    const miles = parseFloat(load.miles) || 0;
    const suggestedRate = Math.round(miles * rpm);

    if (load.broker_href) {
      // Store base load so the profile tab can enrich it
      chrome.storage.local.set({ ace_pending_load: { ...load, suggested_rate: suggestedRate } });
      chrome.runtime.sendMessage({ action: 'open_profile_tab', url: load.broker_href });
      console.log(`[ACE] Opening profile tab — order ${load.order_no}`);
    } else {
      // No profile URL — show popup with row data only
      console.warn(`[ACE] No profile URL for order ${load.order_no} — showing popup with row data`);
      chrome.runtime.sendMessage({ action: 'load_captured', load, suggested_rate: suggestedRate });
    }
  }

  // ─── ORDER PROFILE EXTRACTION ──────────────────────────────────────────────

  function extractAndStoreOrderProfile() {
    // Try multiple label variations — order profile page vs broker contact popup use different labels
    function getField(...labels) {
      const tds = document.querySelectorAll('td');
      for (const label of labels) {
        for (let i = 0; i < tds.length; i++) {
          const cellText = (tds[i].innerText || '').trim().replace(/:$/, '').toUpperCase();
          if (cellText === label.toUpperCase()) {
            const val = tds[i + 1]?.innerText?.trim() || '';
            if (val) return val;
          }
        }
      }
      return '';
    }

    // Log every td pair so we can see what labels the broker popup actually uses
    const tds = document.querySelectorAll('td');
    console.log(`[ACE] Profile page — ${tds.length} tds | url: ${window.location.href.slice(-60)}`);
    for (let i = 0; i < Math.min(tds.length, 30); i += 2) {
      const label = (tds[i]?.innerText || '').trim().slice(0, 40);
      const value = (tds[i + 1]?.innerText || '').trim().slice(0, 60);
      if (label) console.log(`[ACE]   "${label}" → "${value}"`);
    }

    chrome.storage.local.get('ace_pending_load', (r) => {
      const base = r.ace_pending_load || {};

      const fullLoad = {
        ...base,
        broker_name:  getField('BROKER NAME', 'COMPANY', 'COMPANY NAME', 'NAME')           || base.broker_name,
        broker_phone: getField('POSTED BY PHONE', 'PHONE', 'PHONE NUMBER', 'CONTACT PHONE', 'TEL', 'TELEPHONE'),
        broker_email: getField('E-MAIL', 'EMAIL', 'E MAIL', 'CONTACT EMAIL', 'POSTED BY EMAIL'),
        order_no:     getField('ORDER NO', 'ORDER NUMBER', 'ORDER #')                       || base.order_no,
        ref_no:       getField('REF. NO', 'REF NO', 'REFERENCE NO')                        || base.ref_no,
        miles:        getField('TOTAL MILES', 'MILES')                                      || base.miles,
        weight:       getField('TOTAL WEIGHT', 'WEIGHT')                                    || base.weight,
        load_type:    getField('LOAD TYPE')                                                 || base.load_type,
        notes:        stripNoise(getField('NOTES', 'SPECIAL INSTRUCTIONS', 'COMMENTS')),
        mc_number:    getField('BROKER MC NUMBER', 'MC NUMBER', 'MC #', 'MC NO')
      };

      console.log(`[ACE] ✓ Profile extracted — name="${fullLoad.broker_name}" phone="${fullLoad.broker_phone}" email="${fullLoad.broker_email}"`);

      chrome.runtime.sendMessage({
        action: 'load_captured',
        load: fullLoad,
        suggested_rate: base.suggested_rate || 0
      });

      chrome.storage.local.remove('ace_pending_load');
      setTimeout(() => window.close(), 500);
    });
  }

  // ─── MAIN INIT ─────────────────────────────────────────────────────────────

  async function init() {
    console.log(`[ACE] init — url: ${window.location.href}`);
    await sleep(4000);

    if (dismissInactivityModal()) {
      console.log('[ACE] init — modal dismissed, settling...');
      await randomDelay(1500, 2500);
    }

    const settings = await getSettings();

    // Start poller BEFORE pause check — session must stay alive even when scanning is paused
    const onLoadBoard = isLoadBoardPage() || window.location.href.toLowerCase().includes('managepostedloads');
    if (onLoadBoard) startActivityPoller();

    if (settings.ace_paused) {
      console.log('[ACE] init — paused, poller running but scan skipped');
      return;
    }

    // ── Multi-session termination page (Login.aspx?sharing=true) ───────────────
    // Navigate away to the clean login URL — reloading this page just loops back here
    if (window.location.href.toLowerCase().includes('login.aspx') &&
        window.location.href.toLowerCase().includes('sharing=true')) {
      console.log('[ACE] ✓ Multi-session page — navigating to Login.aspx for re-login');
      window.location.href = 'https://www6.sylectus.com/Login.aspx';
      return;
    }

    console.log(`[ACE] init — page checks: orderProfile=${isOrderProfilePage()} corpLogin=${isCorporateLoginPage()} userLogin=${isUserLoginPage()} loadBoard=${isLoadBoardPage()}`);

    // Order Profile page — extract and close
    if (isOrderProfilePage()) {
      console.log('[ACE] init → extractAndStoreOrderProfile');
      extractAndStoreOrderProfile();
      return;
    }

    // Corporate login — always run regardless of operating hours
    if (isCorporateLoginPage()) {
      if (!settings.sylectus_corp_password) {
        console.warn('[ACE] Corporate password not set - open ACE settings');
        chrome.runtime.sendMessage({ action: 'session_expired' });
        return;
      }
      console.log('[ACE] init → doCorporateLogin');
      await doCorporateLogin(settings.sylectus_corp_password);
      return;
    }

    // User login — always run regardless of operating hours
    if (isUserLoginPage()) {
      if (settings.sylectus_password) {
        console.log('[ACE] init → doUserLogin');
        await doUserLogin(settings.sylectus_password);
      } else {
        console.warn('[ACE] User password not set — open ACE settings');
        chrome.runtime.sendMessage({ action: 'session_expired' });
      }
      return;
    }

    // Not on load board and not already showing the load board iframe — navigate there
    if (!isLoadBoardPage() && !window.location.href.toLowerCase().includes('managepostedloads')) {
      console.log('[ACE] init — not on load board, navigating now');
      window.location.href = 'https://www6.sylectus.com/Main.aspx?page=II14_managepostedloads.asp?loadboard=True';
      return;
    }

    // Main.aspx wrapper — poller already started above, nothing else to do here
    if (!isLoadBoardPage()) return;

    // Load board — only scan during operating hours
    if (isLoadBoardPage()) {
      if (!isCSTOperatingHours()) {
        console.log('[ACE] Load board reached outside operating hours (6am–8pm CST) — standing by');
        return;
      }
      await loadProcessedFromStorage();
      if (!searchComplete) {
        await setupSearch(settings);
        await randomDelay(3000, 5000);
      }
      await scanLoadBoard(settings);
      scheduleRescan(settings);
    }
  }

  let _activityPollerStarted = false;
  function startActivityPoller() {
    if (_activityPollerStarted) return;
    _activityPollerStarted = true;

    // Simulate activity every 60s to prevent Sylectus inactivity timer from firing
    setInterval(() => {
      try { simulateActivity(); } catch(e) {
        if ((e.message || '').includes('invalidated')) window.location.reload();
      }
    }, 60000);

    // Check for and dismiss inactivity modal every 5s
    setInterval(() => {
      try {
        if (dismissInactivityModal()) {
          console.log('[ACE] Poller caught and cleared inactivity modal — re-running search');
          searchComplete = false;
          randomDelay(2000, 3000)
            .then(() => getSettings().then(s => setupSearch(s)))
            .catch(() => window.location.reload());
        }
      } catch(e) {
        if ((e.message || '').includes('invalidated')) window.location.reload();
      }
    }, 5000);

    console.log('[ACE] Activity poller started — simulate every 60s, modal check every 5s');
  }

  function scheduleRescan(settings) {
    const delay = Math.floor(Math.random() * (45000 - 10000 + 1)) + 10000;
    console.log(`[ACE] Next scan in ${Math.round(delay / 1000)}s`);
    setTimeout(async () => {
      if (!isLoadBoardPage()) return;
      if (!isCSTOperatingHours()) {
        console.log('[ACE] Outside operating hours (6am–8pm CST) — rescans stopped');
        return;
      }
      await scanLoadBoard(settings);
      scheduleRescan(settings);
    }, delay);
  }

  // ─── MESSAGE LISTENER ──────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'keepalive') {
      simulateActivity();
      dismissInactivityModal();
      sendResponse({ status: 'alive' });
      return false;
    }
    if (message.action === 'do_login') {
      (async () => {
        if (isCorporateLoginPage()) await doCorporateLogin(message.corp_password);
        else await doUserLogin(message.user_password);
      })();
      sendResponse({ status: 'ok' });
      return false;
    }
    if (message.action === 'update_search' || message.action === 'run_search') {
      searchComplete = false;
      getSettings().then(s => setupSearch(s));
      sendResponse({ status: 'ok' });
      return false;
    }
    if (message.action === 'resume_ace') {
      if (!isLoadBoardPage()) { sendResponse({ status: 'not_load_board' }); return false; }
      dismissInactivityModal();
      getSettings().then(async s => {
        if (s.ace_paused) return;
        searchComplete = false;
        await setupSearch(s);
        await randomDelay(3000, 5000);
        await scanLoadBoard(s);
        scheduleRescan(s);
      });
      sendResponse({ status: 'ok' });
      return false;
    }
    return false;
  });

  // MutationObserver — watch for modal appearance and resume after dismissal
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.addedNodes.length > 0) {
        if (dismissInactivityModal()) {
          console.log('[ACE] MutationObserver caught and cleared inactivity modal — re-running search');
          if (isLoadBoardPage()) {
            searchComplete = false;
            randomDelay(2000, 3000).then(() => getSettings().then(s => setupSearch(s)));
          }
        }
        break;
      }
    }
  }).observe(document.body, { childList: true, subtree: true });

  // Run
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
