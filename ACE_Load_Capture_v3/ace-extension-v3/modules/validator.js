// ACE — validator.js
// EDGEai platform license gate
// Validates carrier UUID against EDGEai Supabase via Cloud Run
// No valid active subscription = ACE disabled

const ACEValidator = (() => {

  const CLOUD_RUN_URL = 'https://edgeai-gmail-webhook-417422203146.us-central1.run.app';
  const CACHE_TTL_MS = 60 * 60 * 1000; // re-validate every 1 hour

  async function validate(carrierUuid) {
    if (!carrierUuid) {
      console.warn('[ACE:validator] No carrier UUID configured');
      return { valid: false, reason: 'no_uuid' };
    }

    // Check cache first
    const cached = await _getCached(carrierUuid);
    if (cached) return cached;

    try {
      const resp = await fetch(`${CLOUD_RUN_URL}/validate-carrier?uuid=${carrierUuid}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (resp.ok) {
        const data = await resp.json();
        const result = {
          valid:    data.active === true,
          reason:   data.active ? 'active' : (data.reason || 'inactive'),
          carrier:  data.carrier || null,
          tier:     data.tier || null
        };
        _cacheResult(carrierUuid, result);
        // Write carrier fields from validation response into storage
        chrome.storage.local.set({
          secondary_email:  data.secondary_email  || '',
          ace_tier:         data.tier             || '',
          ace_carrier_name: data.carrier_name     || '',
          email_signature:  data.email_signature  || ''
        });
        console.log(`[ACE:validator] ✓ UUID validated — ${result.valid ? 'ACTIVE' : 'INACTIVE'} | tier: ${result.tier}`);
        return result;
      } else {
        console.warn('[ACE:validator] Validation failed:', resp.status);
        // Fail open in offline/error scenarios to not break carrier workflow
        return { valid: true, reason: 'offline_failopen' };
      }
    } catch(e) {
      console.warn('[ACE:validator] Network error — failing open:', e.message);
      return { valid: true, reason: 'offline_failopen' };
    }
  }

  function _getCached(uuid) {
    return new Promise(resolve => {
      chrome.storage.local.get('ace_validation_cache', (r) => {
        const cache = r.ace_validation_cache || {};
        const entry = cache[uuid];
        if (entry && (Date.now() - entry.ts) < CACHE_TTL_MS) {
          console.log('[ACE:validator] Using cached validation');
          resolve(entry.result);
        } else {
          resolve(null);
        }
      });
    });
  }

  function _cacheResult(uuid, result) {
    chrome.storage.local.get('ace_validation_cache', (r) => {
      const cache = r.ace_validation_cache || {};
      cache[uuid] = { result, ts: Date.now() };
      chrome.storage.local.set({ ace_validation_cache: cache });
    });
  }

  function clearCache() {
    chrome.storage.local.remove('ace_validation_cache');
  }

  return { validate, clearCache };
})();
