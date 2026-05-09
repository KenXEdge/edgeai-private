// ACE — modal.js
// Inactivity modal detection and dismissal
// Sylectus fires "Automatic refresh paused" modal after inactivity

const ACEModal = (() => {

  function dismiss() {
    return _scanDoc(document) ||
           _scanIframes() ||
           _scanParentFrames();
  }

  function _scanDoc(doc) {
    if (!doc || !doc.body) return false;
    const bodyText = (doc.body.innerText || '').toLowerCase();
    const hasModal = bodyText.includes('automatic refresh paused') ||
                     bodyText.includes('limited user interaction') ||
                     bodyText.includes("still here");

    if (!hasModal) return false;

    // Scan all clickable elements for the dismiss button
    const els = doc.querySelectorAll('input[type="button"], input[type="submit"], button, a, td, div');
    for (const el of els) {
      const t = (el.value || el.innerText || el.textContent || '')
        .toLowerCase().replace(/[''‚‛]/g, "'").trim();
      if (t.includes('still here') || (t.includes('wait') && t.includes('here'))) {
        el.click();
        console.log('[ACE:modal] ✓ Dismissed inactivity modal');
        return true;
      }
    }

    // Fallback — click last button on page
    const btns = doc.querySelectorAll('input[type="button"], input[type="submit"], button');
    if (btns.length > 0) {
      btns[btns.length - 1].click();
      console.log('[ACE:modal] ✓ Dismissed modal (fallback last button)');
      return true;
    }

    return false;
  }

  function _scanIframes() {
    // Check iframe1 first — confirmed load board iframe
    const iframe1 = document.getElementById('iframe1');
    if (iframe1) {
      try {
        const d = iframe1.contentDocument || iframe1.contentWindow.document;
        if (_scanDoc(d)) return true;
      } catch(e) {}
    }
    // Scan all other iframes
    for (const frame of document.querySelectorAll('iframe')) {
      if (frame.id === 'iframe1') continue;
      try {
        const d = frame.contentDocument || frame.contentWindow.document;
        if (_scanDoc(d)) return true;
      } catch(e) {}
    }
    return false;
  }

  function _scanParentFrames() {
    try {
      if (window.parent && window.parent !== window) {
        if (_scanDoc(window.parent.document)) return true;
      }
    } catch(e) {}
    try {
      if (window.top && window.top !== window && window.top !== window.parent) {
        if (_scanDoc(window.top.document)) return true;
      }
    } catch(e) {}
    return false;
  }

  function simulateActivity() {
    document.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      clientX: Math.floor(Math.random() * 600) + 100,
      clientY: Math.floor(Math.random() * 400) + 100
    }));
  }

  return { dismiss, simulateActivity };
})();
