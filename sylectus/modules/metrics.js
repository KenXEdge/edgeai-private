// ACE — metrics.js
// First to Bid timestamp capture and Supabase logging
// Feeds both Carrier Dashboard and CMO Dashboard

const ACEMetrics = (() => {

  // Performance targets (seconds)
  const TARGETS = {
    detection:  10,   // T1 → T2: < 10 seconds
    alert:       5,   // T2 → T3: < 5 seconds
    response:   30,   // T3 → T5: < 30 seconds (carrier decision)
    total_bid:  45    // T1 → T6: < 45 seconds (post to bid sent)
  };

  // Performance tier thresholds (seconds)
  const TIERS = {
    elite:    45,     // < 45 sec — green
    good:    120,     // 45 sec - 2 min — yellow
    coaching: Infinity // > 2 min — red, carrier needs coaching
  };

  function getTier(totalBidSec) {
    if (!totalBidSec) return 'unknown';
    if (totalBidSec <= TIERS.elite)   return 'elite';
    if (totalBidSec <= TIERS.good)    return 'good';
    return 'coaching';
  }

  function buildPayload(load, decision, bidAmount, timestamps) {
    const { t1, t2, t3, t4, t5, t6 } = timestamps;

    const detectionSec  = ACEUtils.secDiff(t1, t2);
    const alertSec      = ACEUtils.secDiff(t2, t3);
    const responseSec   = ACEUtils.secDiff(t3, t5);
    const bidSpeedSec   = ACEUtils.secDiff(t1, t6);
    const tier          = getTier(bidSpeedSec);

    return {
      carrier_id:          load.carrier_id || null,
      order_no:            load.order_no,
      broker_name:         load.broker_name,
      broker_email:        load.broker_email,
      pickup_city:         load.pickup_city,
      pickup_state:        load.pickup_state,
      delivery_city:       load.delivery_city,
      delivery_state:      load.delivery_state,
      miles:               parseFloat(load.miles) || 0,
      load_type:           load.load_type,
      suggested_rate:      load.suggested_rate || 0,
      bid_amount:          bidAmount ? parseFloat(bidAmount) : null,
      decision:            decision, // 'bid' | 'pass' | 'expired'
      t1_posted_at:        t1 || null,
      t2_detected_at:      t2 || null,
      t3_alerted_at:       t3 || null,
      t4_reviewed_at:      t4 || null,
      t5_decision_at:      t5 || null,
      t6_sent_at:          t6 || null,
      detection_speed_sec: detectionSec,
      alert_speed_sec:     alertSec,
      response_time_sec:   responseSec,
      bid_speed_sec:       bidSpeedSec,
      performance_tier:    tier,
      meets_target:        bidSpeedSec !== null && bidSpeedSec <= TARGETS.total_bid
    };
  }

  // Log to Supabase via Cloud Run /log-load-activity
  async function log(payload, settings) {
    const carrierUuid = settings.carrier_uuid;
    if (!carrierUuid) {
      console.warn('[ACE:metrics] No carrier UUID — metrics not logged');
      return;
    }

    payload.carrier_id = carrierUuid;

    try {
      const resp = await fetch('https://edgeai-gmail-webhook-417422203146.us-central1.run.app/log-load-activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (resp.ok) {
        console.log(`[ACE:metrics] ✓ Logged — order ${payload.order_no} | bid speed: ${payload.bid_speed_sec}s | tier: ${payload.performance_tier}`);
      } else {
        console.warn('[ACE:metrics] Log failed:', resp.status);
      }
    } catch(e) {
      console.error('[ACE:metrics] Log error:', e);
    }
  }

  // Store metrics locally for dashboard display
  function storeLocal(payload) {
    chrome.storage.local.get('ace_metrics_log', (r) => {
      const log = r.ace_metrics_log || [];
      log.unshift({ ...payload, stored_at: ACEUtils.now() });
      if (log.length > 200) log.length = 200; // keep last 200
      chrome.storage.local.set({ ace_metrics_log: log });
    });
  }

  return { buildPayload, log, storeLocal, getTier, TARGETS, TIERS };
})();
