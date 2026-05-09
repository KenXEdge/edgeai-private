// ACE — email.js
// Gmail alert email (load notification to carrier's phone)
// Bid email formation and send
// All carrier info pulled from settings — nothing hardcoded

const ACEEmail = (() => {

  // Send load alert email to carrier's own Gmail address
  // This triggers Gmail push notification on iPhone/iPad
  async function sendAlert(load, suggestedRate, token, settings) {
    if (!token) { console.warn('[ACE:email] No Gmail token for alert'); return null; }

    const t3 = ACEUtils.now(); // T3 — alert sent timestamp

    const to      = settings.gmail_address || settings.carrier_email || '';
    const subject = `⚡ ACE LOAD — ${load.pickup_city} ${load.pickup_state} → ${load.delivery_city} ${load.delivery_state} — $${suggestedRate} suggested`;

    // Mobile-friendly alert — tap to open ace bid page
    const aceUrl = `https://xtxtec.com/ace?order=${load.order_no}&carrier=${settings.carrier_uuid || ''}`;

    const body = `
<div style="font-family:Arial,sans-serif;font-size:14px;max-width:480px;">

<div style="background:#E8A020;color:#000;padding:12px 16px;border-radius:6px 6px 0 0;">
  <strong>⚡ ACE LOAD ALERT</strong>
</div>

<div style="background:#111;color:#fff;padding:16px;border-radius:0 0 6px 6px;">

  <p style="font-size:20px;font-weight:bold;margin:0 0 8px;">
    ${load.pickup_city}, ${load.pickup_state} → ${load.delivery_city}, ${load.delivery_state}
  </p>

  <table style="width:100%;font-size:13px;color:#ccc;border-collapse:collapse;">
    <tr><td style="padding:4px 0;"><strong style="color:#fff;">Order:</strong></td><td>${load.order_no}</td></tr>
    <tr><td style="padding:4px 0;"><strong style="color:#fff;">Pickup:</strong></td><td>${load.pickup_date}</td></tr>
    <tr><td style="padding:4px 0;"><strong style="color:#fff;">Delivery:</strong></td><td>${load.delivery_date}</td></tr>
    <tr><td style="padding:4px 0;"><strong style="color:#fff;">Miles:</strong></td><td>${load.miles}</td></tr>
    <tr><td style="padding:4px 0;"><strong style="color:#fff;">Vehicle:</strong></td><td>${load.vehicle_size}</td></tr>
    <tr><td style="padding:4px 0;"><strong style="color:#fff;">Weight:</strong></td><td>${load.weight} lbs</td></tr>
    <tr><td style="padding:4px 0;"><strong style="color:#fff;">Broker:</strong></td><td>${load.broker_name}</td></tr>
    <tr><td style="padding:4px 0;"><strong style="color:#E8A020;font-size:16px;">Suggested:</strong></td><td style="color:#E8A020;font-size:16px;font-weight:bold;">$${suggestedRate}</td></tr>
  </table>

  <div style="margin-top:16px;text-align:center;">
    <a href="${aceUrl}" style="background:#E8A020;color:#000;padding:12px 24px;border-radius:5px;font-weight:bold;font-size:15px;text-decoration:none;display:inline-block;">
      ⚡ Open ACE to Bid
    </a>
  </div>

  <p style="margin-top:12px;font-size:11px;color:#666;text-align:center;">
    ACE Load Capture · EDGEai · ${new Date().toLocaleTimeString()}
  </p>
</div>

</div>`.trim();

    const result = await _sendEmail(to, subject, body, token);
    return { ...result, t3_alerted_at: t3 };
  }

  // Send bid email to broker
  async function sendBid(load, bidAmount, token, settings) {
    if (!token) { console.warn('[ACE:email] No Gmail token for bid'); return null; }
    if (!load.broker_email) { console.warn('[ACE:email] No broker email'); return null; }

    const t6 = ACEUtils.now(); // T6 — bid sent timestamp

    const from    = settings.gmail_address || '';
    const subject = `${load.pickup_city} ${load.pickup_state} to ${load.delivery_city} ${load.delivery_state}- $${bidAmount}`;

    // Raw load block — authentic Sylectus copy/paste appearance
    const loadBlock = load.raw_row_text ||
      `${load.load_type}  ${load.pickup_city}, ${load.pickup_state}  ${load.pickup_date}\n${load.order_no}  ${load.delivery_city}, ${load.delivery_state}  ${load.delivery_date}\nMiles: ${load.miles}  ${load.vehicle_size}  ${load.pieces} pcs  ${load.weight} lbs`;

    const carrierName     = settings.carrier_name     || '';
    const companyName     = settings.company_name     || '';
    const carrierLocation = settings.carrier_location || '';
    const carrierPhone    = settings.carrier_phone    || '';
    const mcNumber        = settings.mc_number        || '';

    const body = `<div style="font-family:Arial,sans-serif;font-size:13px;color:#000;">

<p><strong>QUOTE: $${bidAmount}</strong><br>
MC ${mcNumber}</p>

<pre style="font-family:monospace;font-size:11px;background:#f5f5f5;padding:8px;border-radius:3px;">${_escapeHtml(loadBlock)}</pre>

<p>*******************<br>
Equipment:<br>
26' Straight,<br>
Dock-high, Air-ride, 3 row e-tracks<br>
Box Door: 94"W x 97"H<br>
Box Interior 98.5"W x 26'L<br>
TWIC<br>
Gear:<br>
Lift gate<br>
Pallet jack<br>
Load bars, Straps, Blankets.</p>

<p>--</p>

<p>Thank you,<br>
${_escapeHtml(carrierName)}<br>
${_escapeHtml(companyName)}<br>
${_escapeHtml(carrierLocation)}<br>
CELL: ${_escapeHtml(carrierPhone)}</p>

</div>`;

    const result = await _sendEmail(load.broker_email, subject, body, token, from);
    return { ...result, t6_sent_at: t6 };
  }

  // Core Gmail API send
  async function _sendEmail(to, subject, htmlBody, token, from) {
    // Create draft then send immediately
    const fromLine = from ? `From: ${from}\r\n` : '';
    const raw = `To: ${to}\r\n${fromLine}Subject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${htmlBody}`;

    const encoded = btoa(unescape(encodeURIComponent(raw)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    try {
      // Create draft
      const draftRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { raw: encoded } })
      });

      if (!draftRes.ok) {
        const err = await draftRes.json();
        console.error('[ACE:email] Draft failed:', err);
        return { success: false, error: err };
      }

      const draft = await draftRes.json();

      // Send immediately
      const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts/send', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: draft.id })
      });

      if (sendRes.ok) {
        console.log(`[ACE:email] ✓ Sent to ${to}`);
        return { success: true };
      } else {
        console.warn('[ACE:email] Send failed — draft saved');
        return { success: false, draft_saved: true };
      }

    } catch(e) {
      console.error('[ACE:email] Error:', e);
      return { success: false, error: e.message };
    }
  }

  // Create draft only — no send (carrier reviews first)
  async function createDraftOnly(load, bidAmount, token, settings) {
    if (!token || !load.broker_email) return null;

    const from    = settings.gmail_address || '';
    const subject = `${load.pickup_city} ${load.pickup_state} to ${load.delivery_city} ${load.delivery_state}- $${bidAmount}`;
    const mcNumber = settings.mc_number || '';
    const loadBlock = load.raw_row_text || '';
    const carrierName = settings.carrier_name || '';
    const companyName = settings.company_name || '';
    const carrierLocation = settings.carrier_location || '';
    const carrierPhone = settings.carrier_phone || '';

    const body = `<div style="font-family:Arial,sans-serif;font-size:13px;">
<p><strong>QUOTE: $${bidAmount}</strong><br>MC ${mcNumber}</p>
<pre style="font-size:11px;background:#f5f5f5;padding:8px;">${_escapeHtml(loadBlock)}</pre>
<p>*******************<br>Equipment:<br>26' Straight,<br>Dock-high, Air-ride, 3 row e-tracks<br>Box Door: 94"W x 97"H<br>Box Interior 98.5"W x 26'L<br>TWIC<br>Gear:<br>Lift gate<br>Pallet jack<br>Load bars, Straps, Blankets.</p>
<p>--</p>
<p>Thank you,<br>${carrierName}<br>${companyName}<br>${carrierLocation}<br>CELL: ${carrierPhone}</p>
</div>`;

    const fromLine = from ? `From: ${from}\r\n` : '';
    const raw = `To: ${load.broker_email}\r\n${fromLine}Subject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${body}`;
    const encoded = btoa(unescape(encodeURIComponent(raw)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    try {
      const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { raw: encoded } })
      });
      if (res.ok) {
        console.log('[ACE:email] ✓ Draft created');
        return { success: true, draft: true };
      }
      return { success: false };
    } catch(e) {
      console.error('[ACE:email] Draft error:', e);
      return { success: false };
    }
  }

  function _escapeHtml(str) {
    return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { sendAlert, sendBid, createDraftOnly };
})();
