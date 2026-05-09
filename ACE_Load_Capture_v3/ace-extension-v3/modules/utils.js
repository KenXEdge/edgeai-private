// ACE — utils.js
// Shared utilities: sleep, randomDelay, iframe access, operating hours
/* global chrome */

const ACEUtils = (() => {

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function randomDelay(min = 500, max = 2000) {
    return sleep(Math.floor(Math.random() * (max - min + 1)) + min);
  }

  // Target iframe1 directly — confirmed Sylectus load board iframe
  function getFrameDoc() {
    const iframe = document.getElementById('iframe1');
    if (iframe) {
      try {
        return iframe.contentDocument || iframe.contentWindow.document;
      } catch(e) {}
    }
    return document;
  }

  function findResultsDoc() {
    const iframe = document.getElementById('iframe1');
    if (iframe) {
      try {
        const d = iframe.contentDocument || iframe.contentWindow.document;
        if (d && d.querySelectorAll('tr').length > 5) return d;
      } catch(e) {}
    }
    return document;
  }

  // Operating hours check — optional, carrier configures start/end in settings
  // If not configured — runs 24/7
  function isWithinOperatingHours(settings) {
    const startHour = parseInt(settings.operating_start || '0');
    const endHour   = parseInt(settings.operating_end   || '24');
    // If both are 0/24 or not set — always on
    if (startHour === 0 && endHour === 24) return true;
    if (startHour === endHour) return true;
    const h = parseInt(new Date().toLocaleString('en-US', {
      timeZone: 'America/Chicago', hour: 'numeric', hour12: false
    }));
    return h >= startHour && h < endHour;
  }

  function now() {
    return new Date().toISOString();
  }

  function nowMs() {
    return Date.now();
  }

  function secDiff(isoA, isoB) {
    if (!isoA || !isoB) return null;
    return Math.round((new Date(isoB) - new Date(isoA)) / 1000);
  }

  return { sleep, randomDelay, getFrameDoc, findResultsDoc, isWithinOperatingHours, now, nowMs, secDiff };
})();
