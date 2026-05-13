// ACE - scanner.js
// Load row scanning, data extraction, filtering, processing
// Timestamps every step for First to Bid metrics

const ACEScanner = (() => {

  const processedLoads = new Set();

  async function scan(settings) {
    await ACEUtils.randomDelay(2000, 4000);
    const doc = ACEUtils.findResultsDoc();
    const rows = doc.querySelectorAll('tr');

    console.log(`[ACE:scanner] Scanning ${rows.length} rows`);

    let newCount = 0;
    let skipped = 0;

    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 5) continue;

      // Find order number - must be 4+ digit number
      let orderNo = null;
      for (const link of row.querySelectorAll('a')) {
        const txt = (link.innerText || '').trim();
        if (/^\d{4,}$/.test(txt)) { orderNo = txt; break; }
      }
      if (!orderNo) continue;
      if (processedLoads.has(orderNo)) continue;

      const load = extractRowData(row, cells, orderNo);
      if (!load.pickup_city) continue;

      // T1 - load post time from Sylectus
      load.t1_posted_at = _parsePostDate(load.post_date);
      // T2 - ACE detected it right now
      load.t2_detected_at = ACEUtils.now();

      // Apply filters
      const maxWeight = parseFloat(settings.max_weight) || 0;
      const loadMiles  = parseFloat(load.miles)  || 0;
      const loadWeight = parseFloat(load.weight) || 0;

      if (maxWeight > 0 && loadWeight > 0 && loadWeight > maxWeight) {
        console.log(`[ACE:scanner] skip #${orderNo} - ${loadWeight}lbs > ${maxWeight}lbs`);
        processedLoads.add(orderNo);
        continue;
      }

      // Max load age filter - carrier configurable 10/30/60 min or off
      const maxAge = parseInt(settings.max_load_age) || 0;
      if (maxAge > 0 && load.post_date) {
        try {
          const posted = new Date(load.post_date);
          const ageMin = (Date.now() - posted.getTime()) / 60000;
          if (ageMin > maxAge) {
            console.log(`[ACE:scanner] skip #${orderNo} - ${Math.round(ageMin)}min old > ${maxAge}min limit`);
            processedLoads.add(orderNo);
            skipped++;
            continue;
          }
        } catch(e) {}
      }

      // Load type filter - match cells[1] load type OR cells[6] vehicle size
      // against carrier's selected load types in ACE settings
      const targetTypes = (settings.target_load_types && settings.target_load_types.length > 0)
        ? settings.target_load_types.map(t => t.toLowerCase().trim())
        : [];

      if (targetTypes.length > 0) {
        const loadType    = (load.load_type    || '').toLowerCase().trim();
        const vehicleSize = (load.vehicle_size || '').toLowerCase().trim();
        const matched = targetTypes.some(t =>
          loadType.includes(t) || t.includes(loadType) ||
          vehicleSize.includes(t) || t.includes(vehicleSize)
        );
        if (!matched) {
          console.log(`[ACE:scanner] skip #${orderNo} - type "${load.load_type}" / vehicle "${load.vehicle_size}" not in carrier selections`);
          processedLoads.add(orderNo);
          skipped++;
          continue;
        }
      }

      processedLoads.add(orderNo);
      newCount++;

      console.log(`[ACE:scanner] ✓ Load #${orderNo} - ${load.pickup_city}, ${load.pickup_state} → ${load.delivery_city}, ${load.delivery_state} | ${loadMiles}mi`);

      if (load.broker_href) {
        await processLoad(load, settings);
        await ACEUtils.randomDelay(1000, 2000);
      }
    }

    console.log(`[ACE:scanner] Done - new: ${newCount} skipped: ${skipped}`);
  }

  function extractRowData(row, cells, orderNo) {
    const load = {
      order_no:     orderNo,
      raw_row_text: row.innerText.trim(),
      raw_row_html: row.outerHTML
    };

    // cells[0] - broker name + profile URL + days to pay + credit score
    const { href, name } = ACEProfile.getBrokerHref(cells[0]);
    load.broker_href = href;
    load.broker_name = name;

    const cell0Text = cells[0]?.innerText || '';
    const daysMatch   = cell0Text.match(/Days to Pay:\s*(\d+)/i);
    const creditMatch = cell0Text.match(/Credit Score:\s*(\d+%)/i);
    load.days_to_pay  = daysMatch  ? daysMatch[1]  : '';
    load.credit_score = creditMatch ? creditMatch[1] : '';
    load.has_safer    = cell0Text.includes('S.A.F.E.R');

    // cells[1] - load type, broker MC (leading blank line filtered by filter(Boolean))
    const c1 = (cells[1]?.innerText || '').trim().split('\n').map(s => s.trim()).filter(Boolean);
    load.load_type = c1[0] || '';
    load.broker_mc = c1[1] || '';

    // cells[2] - ref no, broker posted amount (e.g. "442844\nU$ 1,400.00")
    const c2 = (cells[2]?.innerText || '').trim().split('\n').map(s => s.trim()).filter(Boolean);
    load.ref_no = c2[0] || '';
    const rawAmt = c2[1] || '';
    if (rawAmt) {
      const num = parseFloat(rawAmt.replace(/[^\d.]/g, ''));
      load.posted_amount = num ? `$(${Math.round(num).toLocaleString()})` : '';
    } else {
      load.posted_amount = '';
    }

    // cells[3] - pickup city, state, zip, date
    const pu = (cells[3]?.innerText || '').trim().split('\n').map(s => s.trim()).filter(Boolean);
    if (pu[0]) {
      const cs = pu[0].split(',');
      load.pickup_city  = cs[0]?.trim() || '';
      const sz = (cs[1] || '').trim().split(' ');
      load.pickup_state = sz[0] || '';
      load.pickup_zip   = sz[1] || '';
    }
    load.pickup_date = pu[1] || '';

    // cells[4] - delivery city, state, zip, date
    const del = (cells[4]?.innerText || '').trim().split('\n').map(s => s.trim()).filter(Boolean);
    if (del[0]) {
      const cs = del[0].split(',');
      load.delivery_city  = cs[0]?.trim() || '';
      const sz = (cs[1] || '').trim().split(' ');
      load.delivery_state = sz[0] || '';
      load.delivery_zip   = sz[1] || '';
    }
    load.delivery_date = del[1] || '';

    // cells[5] - post date / expiry
    const dates = (cells[5]?.innerText || '').trim().split('\n').map(s => s.trim()).filter(Boolean);
    load.post_date   = dates[0] || '';
    load.expiry_date = dates[1] || '';

    // cells[6] - vehicle size / miles
    // Split on newline first; if that yields one token, split on the boundary
    // between the last letter and the first digit (handles "LARGE STRAIGHT117")
    const vehRaw = (cells[6]?.innerText || '').trim();
    const vehLines = vehRaw.split('\n').map(s => s.trim()).filter(Boolean);
    let vehSize = vehLines[0] || '';
    let vehMiles = vehLines[1] || '';
    if (!vehMiles) {
      const m = vehSize.match(/^([A-Za-z\s]+?)(\d+)$/);
      if (m) { vehSize = m[1].trim(); vehMiles = m[2]; }
    }
    load.vehicle_size = vehSize;
    load.miles        = vehMiles.replace(/[^0-9]/g, '');

    // cells[7] - pieces / weight
    const pcs = (cells[7]?.innerText || '').trim().split('\n').map(s => s.trim()).filter(Boolean);
    load.pieces = pcs[0] || '';
    load.weight = pcs[1] || '';

    // cells[8] - other info
    load.other_info = (cells[8]?.innerText || '').trim();

    return load;
  }

  async function processLoad(load, settings) {
    await ACEUtils.randomDelay();

    // Fetch broker profile - 6 critical fields
    const profileData = await ACEProfile.fetch6Fields(load.broker_href);
    const fullLoad = { ...load, ...profileData };

    if (!fullLoad.broker_email) {
      console.warn(`[ACE:scanner] No broker email for order ${fullLoad.order_no} - skipping`);
      return fullLoad;
    }

    if (settings.ace_harvest_mode) {
      chrome.runtime.sendMessage({ action: 'harvest_lane', load: fullLoad });
      return fullLoad;
    }

    // Calculate suggested rate
    const rpm = parseFloat(settings.rpm) || 2.75;
    const miles = parseFloat(fullLoad.miles) || 0;
    const suggestedRate = Math.round(miles * rpm);

    // Send to background for popup, Gmail alert, metrics
    chrome.runtime.sendMessage({
      action: 'load_captured',
      load: fullLoad,
      suggested_rate: suggestedRate,
      t2_detected_at: fullLoad.t2_detected_at
    });

    return fullLoad;
  }

  // Parse Sylectus post date string to ISO
  function _parsePostDate(dateStr) {
    if (!dateStr) return ACEUtils.now();
    try {
      return new Date(dateStr).toISOString();
    } catch(e) {
      return ACEUtils.now();
    }
  }

  function reset() { processedLoads.clear(); }

  return { scan, extractRowData, reset };
})();
