// ACE — broker.js
// Supabase brokers table upsert via EDGEai Cloud Run /add-broker
// Schema matches confirmed brokers table columns

const ACEBroker = (() => {

  const CLOUD_RUN_URL = 'https://edgeai-gmail-webhook-417422203146.us-central1.run.app';

  function buildPayload(load, carrierUuid) {
    if (!load.broker_email || !carrierUuid) return null;

    const now = ACEUtils.now();
    const lane = [
      load.pickup_state,
      load.delivery_state
    ].filter(Boolean).join(' - ');

    return {
      carrier_id:            carrierUuid,
      name:                  load.broker_contact_name || '',
      company:               load.company_name || load.broker_name || '',
      email:                 load.broker_email,
      phone:                 load.broker_phone || '',
      title:                 load.broker_title || '',
      primary_lanes:         lane,
      status:                'warm',
      priority:              'medium',
      preferred:             false,
      alert_requested:       false,
      days_cadence:          3,
      last_contacted:        now,
      response_count:        0,
      load_count:            1,
      touch_count:           1,
      contact_enabled:       true,
      last_load_date:        now,
      last_load_origin:      `${load.pickup_city} ${load.pickup_state}`.trim(),
      last_load_destination: `${load.delivery_city} ${load.delivery_state}`.trim(),
      notes:                 `First contact via ACE Sylectus load capture — ${load.load_type} order ${load.order_no}`
    };
  }

  async function upsert(load, settings) {
    const carrierUuid = settings.carrier_uuid;
    if (!carrierUuid) {
      console.warn('[ACE:broker] No carrier UUID — broker not logged');
      return;
    }
    if (!load.broker_email) {
      console.warn('[ACE:broker] No broker email — skipping');
      return;
    }

    const payload = buildPayload(load, carrierUuid);
    if (!payload) return;

    try {
      const resp = await fetch(`${CLOUD_RUN_URL}/add-broker`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (resp.ok) {
        console.log(`[ACE:broker] ✓ Broker upserted — ${load.broker_email}`);
      } else {
        console.warn('[ACE:broker] Upsert failed:', resp.status);
      }
    } catch(e) {
      console.error('[ACE:broker] Upsert error:', e);
    }
  }

  // Also log locally for dashboard broker list
  function storeLocal(load, carrierUuid) {
    if (!load.broker_email) return;
    chrome.storage.local.get('contacted_brokers', (r) => {
      const brokers = r.contacted_brokers || [];
      const exists = brokers.find(b => b.email === load.broker_email);
      if (!exists) {
        brokers.unshift({
          email:          load.broker_email,
          name:           load.broker_contact_name || '',
          company:        load.company_name || load.broker_name || '',
          phone:          load.broker_phone || '',
          first_seen:     ACEUtils.now(),
          order_no:       load.order_no,
          carrier_id:     carrierUuid
        });
        if (brokers.length > 500) brokers.length = 500;
        chrome.storage.local.set({ contacted_brokers: brokers });
      }
    });
  }

  return { buildPayload, upsert, storeLocal };
})();
