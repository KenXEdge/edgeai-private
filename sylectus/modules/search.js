// ACE — search.js
// Bidirectional Sylectus search form control
// Uses exact confirmed field names from Sylectus DOM inspection
// Sets ONLY what carrier configured — clears what carrier left empty
// Never hardcodes values

const ACESearch = (() => {

  let _searchComplete = false;

  // Confirmed Sylectus load type checkbox name map
  // Verified from DOM: input[name="cb_pt1"] through cb_pt18
  const LOAD_TYPE_MAP = {
    'expedited load':       'cb_pt1',
    'expedited truck load': 'cb_pt2',
    'truckload':            'cb_pt3',
    'less than truckload':  'cb_pt4',
    'truckload/ltl':        'cb_pt5',
    'courier type work':    'cb_pt6',
    'flatbed':              'cb_pt7',
    'dump trailer':         'cb_pt8',
    'reefer':               'cb_pt9',
    'small straight':       'cb_pt10',
    'large straight':       'cb_pt11',
    'lane/project rfq':     'cb_pt12',
    'air freight':          'cb_pt13',
    'air charter':          'cb_pt14',
    'other':                'cb_pt15',
    'climate control':      'cb_pt16',
    'cargo van':            'cb_pt17',
    'sprinter':             'cb_pt18'
  };

  async function setup(settings) {
    if (_searchComplete) return;
    console.log('[ACE:search] Setup start');

    await ACEUtils.randomDelay(1500, 2500);
    ACEModal.dismiss();
    await ACEUtils.randomDelay();

    const doc = ACEUtils.getFrameDoc();

    // ── LOAD TYPE CHECKBOXES ──────────────────────────────────────────────────
    const targetTypes = (settings.target_load_types && settings.target_load_types.length > 0)
      ? settings.target_load_types.map(t => t.toLowerCase())
      : []; // empty = don't touch checkboxes

    if (targetTypes.length > 0) {
      Object.entries(LOAD_TYPE_MAP).forEach(([label, cbName]) => {
        const cb = doc.querySelector(`input[name="${cbName}"]`);
        if (!cb) { console.warn(`[ACE:search] checkbox not found: ${cbName}`); return; }
        const shouldCheck = targetTypes.includes(label);
        if (shouldCheck && !cb.checked) {
          cb.click();
          console.log(`[ACE:search] ✓ checked: ${label}`);
        } else if (!shouldCheck && cb.checked) {
          cb.click();
          console.log(`[ACE:search] ✓ unchecked: ${label}`);
        }
      });
      await ACEUtils.randomDelay(300, 800);
    }

    // ── FROM CITY — id=fromCity name=fromcity ─────────────────────────────────
    const fromCityInput = doc.getElementById('fromCity') ||
                          doc.querySelector('input[name="fromcity"]');
    if (fromCityInput) {
      const val = settings.search_from_city || '';
      fromCityInput.value = val;
      fromCityInput.dispatchEvent(new Event('change', { bubbles: true }));
      console.log(`[ACE:search] ✓ FROM city: "${val}"`);
    } else {
      console.warn('[ACE:search] ✗ FROM city input not found');
    }

    // ── FROM STATE — id=msFromState name=fromstate (select-multiple) ──────────
    const fromStateSelect = doc.getElementById('msFromState') ||
                            doc.querySelector('select[name="fromstate"]');
    if (fromStateSelect) {
      const fromState = (settings.search_from_state || '').toUpperCase().trim();
      for (const opt of fromStateSelect.options) {
        opt.selected = fromState ? opt.value.toUpperCase() === fromState : false;
      }
      fromStateSelect.dispatchEvent(new Event('change', { bubbles: true }));
      console.log(`[ACE:search] ✓ FROM state: "${fromState || 'cleared'}"`);
    } else {
      console.warn('[ACE:search] ✗ FROM state select not found');
    }

    await ACEUtils.randomDelay(300, 900);

    // ── TO CITY — id=toCity name=tocity ──────────────────────────────────────
    const toCityInput = doc.getElementById('toCity') ||
                        doc.querySelector('input[name="tocity"]');
    if (toCityInput) {
      const val = settings.search_to_city || '';
      toCityInput.value = val;
      toCityInput.dispatchEvent(new Event('change', { bubbles: true }));
      console.log(`[ACE:search] ✓ TO city: "${val}"`);
    }

    // ── TO STATE — id=msToState name=tostate (select-multiple) ───────────────
    const toStateSelect = doc.getElementById('msToState') ||
                          doc.querySelector('select[name="tostate"]');
    if (toStateSelect) {
      const toStates = settings.search_to_states || [];
      const toUpper = toStates.map(s => s.toUpperCase().trim());
      for (const opt of toStateSelect.options) {
        opt.selected = toUpper.length > 0
          ? toUpper.includes(opt.value.toUpperCase())
          : false;
      }
      toStateSelect.dispatchEvent(new Event('change', { bubbles: true }));
      console.log(`[ACE:search] ✓ TO states: [${toUpper.join(', ') || 'cleared'}]`);
    } else {
      console.warn('[ACE:search] ✗ TO state select not found');
    }

    await ACEUtils.randomDelay(300, 900);

    // ── PICKUP WITHIN MILES — id=milesPickUp name=miles ──────────────────────
    const milesInput = doc.getElementById('milesPickUp') ||
                       doc.querySelector('input[name="miles"]');
    if (milesInput) {
      const val = settings.pickup_radius ? String(settings.pickup_radius) : '';
      milesInput.value = val;
      milesInput.dispatchEvent(new Event('change', { bubbles: true }));
      console.log(`[ACE:search] ✓ Pickup radius: "${val || 'cleared'}"`);
    } else {
      console.warn('[ACE:search] ✗ Pickup miles input not found');
    }

    await ACEUtils.randomDelay(500, 1200);

    // ── SEARCH ALL POSTINGS BUTTON ────────────────────────────────────────────
    // Skip re-click if search was run recently (within 45 seconds)
    const lastSearchTs = parseInt(sessionStorage.getItem('ace_search_ts') || '0');
    const searchWasRecent = (Date.now() - lastSearchTs) < 45000;
    const navType = performance.getEntriesByType('navigation')[0]?.type;
    if (navType !== 'reload' && searchWasRecent) {
      console.log('[ACE:search] Recent search detected — skipping re-click');
      _searchComplete = true;
      return;
    }

    const allButtons = doc.querySelectorAll('input[type="button"], input[type="submit"], button');
    for (const btn of allButtons) {
      const t = (btn.value || btn.innerText || btn.textContent || '').toLowerCase().trim();
      if (t.includes('search all')) {
        sessionStorage.setItem('ace_search_ts', String(Date.now()));
        btn.click();
        _searchComplete = true;
        console.log('[ACE:search] ✓ Search All Postings clicked');
        return;
      }
    }
    console.warn('[ACE:search] ✗ Search All Postings button not found');
  }

  function reset() { _searchComplete = false; }
  function isComplete() { return _searchComplete; }

  return { setup, reset, isComplete, LOAD_TYPE_MAP };
})();
