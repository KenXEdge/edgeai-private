// ACE Load Capture — Content Script v2.0
// Autonomous Sylectus watcher — no SMS dependency
/* global chrome */
(function() {
  'use strict';
  const USERNAME = 'sni';
  const processedLoads = new Set();
  let searchComplete = false;
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
      chrome.storage.local.get([
        'sylectus_corp_password', 'sylectus_password', 'rpm',
        'search_from_city', 'search_from_state', 'search_to_states',
        'bid_radius', 'max_weight', 'ace_paused'
      ], resolve);
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
    return window.location.pathname.toLowerCase().includes('ii14_managepostedloads');
  }
  function isOrderProfilePage() {
    const text = document.body.innerText || '';
    return text.includes('ORDER PROFILE') && text.includes('E-MAIL:');
  }
  function getFrameDoc() { return document; }
  // ─── SESSION MANAGEMENT ───────────────────────────────────────────────────
  function dismissInactivityModal() {
    function scanDoc(doc) {
      const els = doc.querySelectorAll('input[type="button"], input[type="submit"], button, a, td, div');
      for (const el of els) {
        const t = (el.value || el.innerText || el.textContent || '')
          .toLowerCase().replace(/[''‚‛]/g, "'").trim();
        if (t.includes('still here') || t.includes('wait') && t.includes('here')) {
          el.click();
          console.log('[ACE] ✓ Dismissed inactivity modal');
          return true;
        }
      }
      const bodyText = (doc.body?.innerText || '').toLowerCase();
      if (bodyText.includes('automatic refresh paused')) {
        const btns = doc.querySelectorAll('input[type="button"], input[type="submit"], button');
        if (btns.length > 0) {
          btns[btns.length - 1].click();
          console.log('[ACE] ✓ Dismissed inactivity modal (fallback button click)');
          return true;
        }
      }
      return false;
    }
    if (scanDoc(document)) return true;
    for (const frame of document.querySelectorAll('iframe')) {
      try {
        const fdoc = frame.contentDocument || frame.contentWindow.document;
        if (scanDoc(fdoc)) return true;
      } catch (e) { /* cross-origin */ }
    }
    // Modal lives in Main.aspx parent frame — scan up the frame tree
    try { if (window.parent && window.parent !== window && scanDoc(window.parent.document)) return true; } catch(e) {}
    try { if (window.top && window.top !== window && window.top !== window.parent && scanDoc(window.top.document)) return true; } catch(e) {}
    return false;
  }
  function simulateActivity() {
    document.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      clientX: Math.floor(Math.random() * 600) + 100,
      clientY: Math.floor(Math.random() * 400) + 100
    }));
  }
  // ─── LOGIN ─────────────────────────────────────────────────────────────────
  let _corpLoginAttempted = false;
  async function doCorporateLogin(corpPassword) {
    if (_corpLoginAttempted) return;
    _corpLoginAttempted = true;
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
    const form = passField.closest('form') || document.querySelector('form');
    if (form) {
      const defaultBtnId = form.getAttribute('defaultbutton') || form.getAttribute('DefaultButton');
      const defaultBtn = defaultBtnId ? document.getElementById(defaultBtnId) : null;
      if (defaultBtn) {
        defaultBtn.click();
        console.log('[ACE] ✓ Corp login — defaultButton clicked:', defaultBtnId);
        return;
      }
      const noise = ['cancel', 'back', 'reset', 'close', 'cookie', 'reject', 'get start', 'member', 'forgot', 'detail'];
      for (const el of document.querySelectorAll('a, input, button')) {
        const t = (el.value || el.innerText || el.textContent || '').toLowerCase().trim();
        if (!t || noise.some(w => t.includes(w))) continue;
        if (t.includes('continu') || t.includes('log in') || t.includes('login') || t.includes('sign in')) {
          const href = el.getAttribute('href') || el.getAttribute('onclick') || '';
          console.log('[ACE] Continue el href:', href);
          const m = href.match(/__doPostBack\(['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\)/);
          if (m && typeof window.__doPostBack === 'function') {
            window.__doPostBack(m[1], m[2]);
            console.log('[ACE] ✓ Corp login — __doPostBack:', m[1]);
            return;
          }
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
      passField.focus();
      ['keydown', 'keypress', 'keyup'].forEach(type =>
        passField.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', keyCode: 13, bubbles: true }))
      );
      console.log('[ACE] ✓ Corp login — Enter key on password field');
    }
  }
  async function doUserLogin(userPassword) {
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
    const allEls = [...document.querySelectorAll('a[href], input[type="submit"], input[type="button"], button')];
    console.log(`[ACE] User login page — ${allEls.length} interactive elements:`);
    allEls.forEach(el => {
      const t = (el.value || el.innerText || el.textContent || '').toLowerCase().trim().slice(0, 60);
      const href = (el.getAttribute('href') || '').slice(0, 80);
      console.log(`  [${el.tagName}#${el.id}] "${t}" href="${href}"`);
    });
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
    const noise = ['cancel', 'back', 'reset', 'close', 'cookie', 'reject', 'get start', 'member', 'forgot', 'detail', 'save', 'delete', 'remove'];
    const loginWords = ['continu', 'log in', 'login', 'sign in'];
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
    passField.focus();
    ['keydown', 'keypress', 'keyup'].forEach(type =>
      passField.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', keyCode: 13, bubbles: true }))
    );
    console.log('[ACE] ✓ User login — Enter key');
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
    const allLoadTypes = [
      'expedited load', 'expedited truck load', 'truckload', 'less than truckload',
      'truckload/ltl', 'courier', 'flatbed', 'dump trailer', 'reefer', 'small straight',
      'large straight', 'lane/project', 'air freight', 'air charter', 'climate control',
      'cargo van', 'sprinter', 'other'
    ];
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
    const inputs = doc.querySelectorAll('input[type="text"]');
    console.log(`[ACE] setupSearch — found ${inputs.length} text inputs`);
    let fromCitySet = false;
    for (const inp of inputs) {
      const n = (inp.name || inp.id || '').toLowerCase();
      if (n.includes('city') || n.includes('from_city') || n.includes('fromcity')) {
        inp.value = fromCity;
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        fromCitySet = true;
        console.log(`[ACE] ✓ FROM city set: ${fromCity}`);
        break;
      }
    }
    if (!fromCitySet) console.warn('[ACE] ✗ FROM city input not found');
    const selects = Array.from(doc.querySelectorAll('select'));
    console.log(`[ACE] setupSearch — found ${selects.length} selects`);
    let fromStateSet = false;
    for (const sel of selects) {
      const n = (sel.name || sel.id || '').toLowerCase();
      if (n.includes('from') && n.includes('state')) {
        const stateUpper = (fromState || '').trim().toUpperCase();
        for (const opt of sel.options) {
          const v = (opt.value || '').trim().toUpperCase();
          const t = (opt.text  || '').trim().toUpperCase();
          if (v === stateUpper || t === stateUpper || t.startsWith(stateUpper)) {
            sel.value = opt.value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            fromStateSet = true;
            console.log(`[ACE] ✓ FROM state set: ${fromState} → option value="${opt.value}"`);
            break;
          }
        }
        break;
      }
    }
    if (!fromStateSet) console.warn('[ACE] ✗ FROM state select not found');
    await randomDelay(300, 900);
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
    const navType = performance.getEntriesByType('navigation')[0]?.type;
    const lastSearchTs = parseInt(sessionStorage.getItem('ace_search_ts') || '0');
    const searchWasRecent = (Date.now() - lastSearchTs) < 45000;
    if (navType !== 'reload' && searchWasRecent) {
      console.log('[ACE] setupSearch — post-search reload detected, skipping re-click');
      searchComplete = true;
      return;
    }
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
    if (document.querySelectorAll('tr').length > 5) return document;
    for (const iframe of document.querySelectorAll('iframe')) {
      try {
        const d = iframe.contentDocument || iframe.contentWindow?.document;
        if (d && d.querySelectorAll('tr').length > 5) return d;
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
  async function scanLoadBoard(settings) {
    await randomDelay(2000, 4000);
    const doc = findResultsDoc();
    const rows = doc.querySelectorAll('tr');
    console.log(`[ACE] scanLoadBoard — ${rows.length} rows | iframes in page: ${document.querySelectorAll('iframe').length} | doc url: ${doc === document ? window.location.href.slice(-50) : 'iframe'}`);
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
      for (const link of links) {
        const txt = (link.innerText || '').trim();
        if (/^\d{4,}$/.test(txt)) { orderNo = txt; orderLink = link; break; }
      }
      if (!orderNo) {
        for (const cell of cells) {
          const txt = (cell.innerText || '').trim();
          if (/^\d{4,}$/.test(txt)) { orderNo = txt; break; }
        }
      }
      if (!orderNo) {
        if (skippedNoOrder < 3) {
          console.log(`[ACE] no order# row — cells:${cells.length} | c0:"${cells[0]?.innerText?.trim().slice(0,40)}" | c1:"${cells[1]?.innerText?.trim().slice(0,40)}" | links:[${[...links].map(l=>`"${l.innerText?.trim().slice(0,20)}"`).join(',')}]`);
        }
        skippedNoOrder++;
        continue;
      }
      if (processedLoads.has(orderNo)) { skippedNoOrder++; continue; }
      const load = extractRowData(row, cells, orderNo, orderLink);
      if (!load.pickup_city) { skippedNoCity++; continue; }
      const loadMiles  = parseFloat(load.miles)  || 0;
      const loadWeight = parseFloat(load.weight) || 0;
      const bidRadius  = parseFloat(settings.bid_radius)  || 300;
      const maxWeight  = parseFloat(settings.max_weight)  || 9000;
      if (loadMiles > 0 && loadMiles > bidRadius) {
        console.log(`[ACE] skip #${orderNo} — ${loadMiles}mi exceeds ${bidRadius}mi radius`);
        processedLoads.add(orderNo);
        continue;
      }
      if (loadWeight > 0 && loadWeight > maxWeight) {
        console.log(`[ACE] skip #${orderNo} — ${loadWeight}lbs exceeds ${maxWeight}lbs max`);
        processedLoads.add(orderNo);
        continue;
      }
      processedLoads.add(orderNo);
      newCount++;
      console.log(`[ACE] load #${orderNo} — ${load.pickup_city}, ${load.pickup_state} → ${load.delivery_city}, ${load.delivery_state} | ${loadMiles}mi | ${loadWeight}lbs | profile link: ${load.broker_href ? load.broker_href.split('?')[0].split('/').pop() : 'NONE'}`);
      if (load.broker_href) {
        await processLoad(load, settings);
        await randomDelay(1500, 3500);
      }
    }
    console.log(`[ACE] scanLoadBoard done — new: ${newCount}, skipped (cells<5): ${skippedCells}, no order#: ${skippedNoOrder}, no city: ${skippedNoCity}`);
  }
  function extractRowData(row, cells, orderNo, orderLink) {
    const companyLink = cells[0]?.querySelector('a');
    const profileLink = orderLink || companyLink;
    const load = {
      order_no: orderNo,
      raw_row_text: row.innerText.trim(),
      raw_row_html: row.outerHTML,
      broker_name: '',
      broker_href: profileLink?.href || ''
    };
    const cell0Lines = (cells[0]?.innerText || '').trim().split('\n').map(s => s.trim()).filter(Boolean);
    load.broker_name = cell0Lines[0] || '';
    const cell1Lines = (cells[1]?.innerText || '').trim().split('\n').map(s => s.trim()).filter(Boolean);
    load.load_type = cell1Lines[0] || '';
    load.ref_no = cell1Lines[1] || '';
    load.mc_number_raw = cell1Lines[2] || '';
    const cell2Lines = (cells[2]?.innerText || '').trim().split('\n').map(s => s.trim()).filter(Boolean);
    load.bid_amount_posted = cell2Lines[1] || '';
    const puLines = (cells[3]?.innerText || '').trim().split('\n').map(s => s.trim()).filter(Boolean);
    if (puLines.length >= 1) {
      const cs = puLines[0].split(',');
      load.pickup_city = cs[0]?.trim() || '';
      const stateZip = (cs[1] || '').trim().split(' ');
      load.pickup_state = stateZip[0] || '';
      load.pickup_zip = stateZip[1] || '';
    }
    load.pickup_date = puLines[1] || '';
    const delLines = (cells[4]?.innerText || '').trim().split('\n').map(s => s.trim()).filter(Boolean);
    if (delLines.length >= 1) {
      const cs = delLines[0].split(',');
      load.delivery_city = cs[0]?.trim() || '';
      const stateZip = (cs[1] || '').trim().split(' ');
      load.delivery_state = stateZip[0] || '';
      load.delivery_zip = stateZip[1] || '';
    }
    load.delivery_date = delLines[1] || '';
    const dateLines = (cells[5]?.innerText || '').trim().split('\n').map(s => s.trim()).filter(Boolean);
    load.post_date = dateLines[0] || '';
    load.expiry_date = dateLines[1] || '';
    const vehLines = (cells[6]?.innerText || '').trim().split('\n').map(s => s.trim()).filter(Boolean);
    load.vehicle_size = vehLines[0] || '';
    load.miles = (vehLines[1] || '').replace(/[^0-9]/g, '');
    const pcsLines = (cells[7]?.innerText || '').trim().split('\n').map(s => s.trim()).filter(Boolean);
    load.pieces = pcsLines[0] || '';
    load.weight = pcsLines[1] || '';
    return load;
  }
  async function processLoad(load, settings) {
    await randomDelay();
    let profileData = {};
    try {
      const resp = await fetch(load.broker_href, { credentials: 'include' });
      const html = await resp.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      function getField(label) {
        const tds = doc.querySelectorAll('td');
        for (let i = 0; i < tds.length; i++) {
          const cell = (tds[i].textContent || '').trim().replace(/:$/, '').toUpperCase();
          if (cell === label.toUpperCase()) return (tds[i + 1]?.textContent || '').trim();
        }
        return '';
      }
      profileData = {
        broker_name:          getField('BROKER NAME') || load.broker_name,
        broker_contact_name:  getField('POSTED BY'),
        broker_email:         getField('E-MAIL'),
        broker_phone:         getField('POSTED BY PHONE'),
        broker_title:         getField('POSTED BY TITLE'),
        order_no:             getField('ORDER NO') || load.order_no,
        ref_no:               getField('REF. NO') || load.ref_no,
        miles:                getField('TOTAL MILES') || load.miles,
        weight:               getField('TOTAL WEIGHT') || load.weight,
        load_type:            getField('LOAD TYPE') || load.load_type,
        notes:                getField('NOTES'),
        days_to_pay:          getField('TRANSCREDIT DAYS TO PAY'),
        credit_score:         getField('TRANSCREDIT CREDIT SCORE'),
        mc_number:            getField('BROKER MC NUMBER')
      };
    } catch (e) {
      console.error('[ACE] Failed to fetch order profile:', e);
    }
    const fullLoad = { ...load, ...profileData };
    const rpm = parseFloat(settings.rpm) || 2.75;
    const miles = parseFloat(fullLoad.miles) || 0;
    const suggestedRate = Math.round(miles * rpm);
    chrome.runtime.sendMessage({
      action: 'load_captured',
      load: fullLoad,
      suggested_rate: suggestedRate
    });
    return fullLoad;
  }
  // ─── ORDER PROFILE EXTRACTION ──────────────────────────────────────────────
  function extractAndStoreOrderProfile() {
    function getField(label) {
      const tds = document.querySelectorAll('td');
      for (let i = 0; i < tds.length; i++) {
        const cellText = (tds[i].innerText || '').trim().replace(/:$/, '').toUpperCase();
        if (cellText === label.toUpperCase()) {
          const val = tds[i + 1]?.innerText?.trim() || '';
          return val;
        }
      }
      return '';
    }
    const pending = sessionStorage.getItem('ace_pending_load');
    const base = pending ? JSON.parse(pending) : {};
    const profile = {
      ...base,
      broker_name: getField('BROKER NAME') || base.broker_name,
      broker_contact_name: getField('POSTED BY'),
      broker_email: getField('E-MAIL'),
      broker_phone: getField('POSTED BY PHONE'),
      broker_title: getField('POSTED BY TITLE'),
      order_no: getField('ORDER NO') || base.order_no,
      ref_no: getField('REF. NO') || base.ref_no,
      miles: getField('TOTAL MILES') || base.miles,
      weight: getField('TOTAL WEIGHT') || base.weight,
      load_type: getField('LOAD TYPE') || base.load_type,
      notes: getField('NOTES'),
      days_to_pay: getField('TRANSCREDIT DAYS TO PAY'),
      credit_score: getField('TRANSCREDIT CREDIT SCORE'),
      mc_number: getField('BROKER MC NUMBER')
    };
    chrome.storage.local.set({ ace_order_profile_data: profile }, () => {
      console.log(`[ACE] ✓ Profile extracted — ${profile.broker_email || 'no email found'}`);
      setTimeout(() => window.close(), 1000);
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
    if (settings.ace_paused) { console.log('[ACE] init — paused, exiting'); return; }
    console.log(`[ACE] init — page checks: orderProfile=${isOrderProfilePage()} corpLogin=${isCorporateLoginPage()} userLogin=${isUserLoginPage()} loadBoard=${isLoadBoardPage()}`);
    if (isOrderProfilePage()) {
      console.log('[ACE] init → extractAndStoreOrderProfile');
      extractAndStoreOrderProfile();
      return;
    }
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
    if (!isLoadBoardPage() && !window.location.href.toLowerCase().includes('managepostedloads')) {
      console.log('[ACE] init — not on load board, navigating now');
      window.location.href = 'https://www6.sylectus.com/Main.aspx?page=II14_managepostedloads.asp?loadboard=True';
      return;
    }
    if (isLoadBoardPage()) {
      if (!isCSTOperatingHours()) {
        console.log('[ACE] Load board reached outside operating hours (6am–8pm CST) — standing by');
        return;
      }
      startActivityPoller();
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
    setInterval(() => {
      simulateActivity();
      if (dismissInactivityModal()) {
        console.log('[ACE] Poller caught and cleared inactivity modal');
      }
    }, 30000);
    console.log('[ACE] Activity poller started — every 30s');
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
    return false;
  });
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.addedNodes.length > 0) {
        if (dismissInactivityModal() && isLoadBoardPage()) {
          randomDelay(1500, 2500).then(() => init());
        }
        break;
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
