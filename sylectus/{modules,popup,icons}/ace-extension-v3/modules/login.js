// ACE — login.js
// Two-step Sylectus login: corporate password then user (sni) password
// Handles ASP.NET __doPostBack forms

const ACELogin = (() => {

  const USERNAME = 'sni';
  let _corpAttempted = false;

  function isCorporatePage() {
    const hasPwd = document.querySelectorAll('input[type="password"]').length >= 1;
    const noSelect = !document.querySelector('select');
    const text = document.body.innerText || '';
    return hasPwd && noSelect && !text.includes('SELECT USER');
  }

  function isUserPage() {
    return !!(document.querySelector('select') &&
              document.querySelector('input[type="password"]'));
  }

  async function doCorporate(password) {
    if (_corpAttempted) return;
    _corpAttempted = true;

    const passField = _findPasswordField();
    if (!passField) { console.warn('[ACE:login] Corp — no password field'); return; }

    passField.focus();
    passField.value = password;
    ['input', 'change', 'blur'].forEach(e =>
      passField.dispatchEvent(new Event(e, { bubbles: true }))
    );

    await ACEUtils.randomDelay();
    _submitForm(passField, 'corp');
    console.log('[ACE:login] ✓ Corporate login submitted');
  }

  async function doUser(password) {
    // Select sni from dropdown
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

    await ACEUtils.randomDelay();

    const passField = _findPasswordField();
    if (!passField) { console.warn('[ACE:login] User — no password field'); return; }

    passField.focus();
    passField.value = password;
    ['input', 'change', 'blur'].forEach(e =>
      passField.dispatchEvent(new Event(e, { bubbles: true }))
    );

    await ACEUtils.randomDelay();
    _submitForm(passField, 'user');
    console.log('[ACE:login] ✓ User login submitted');
  }

  function _findPasswordField() {
    for (const f of document.querySelectorAll('input[type="password"]')) {
      const ctx = (f.closest('td,div,form,table')?.innerText || '').toLowerCase();
      if (ctx.includes('reset') || ctx.includes('new password') || ctx.includes('confirm')) continue;
      return f;
    }
    return document.querySelector('input[type="password"]');
  }

  function _submitForm(field, type) {
    const form = field.closest('form') || document.querySelector('form');
    if (!form) {
      // Enter key fallback
      ['keydown', 'keypress', 'keyup'].forEach(t =>
        field.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', keyCode: 13, bubbles: true }))
      );
      return;
    }

    // Try defaultButton
    const defaultBtnId = form.getAttribute('defaultbutton') || form.getAttribute('DefaultButton');
    const defaultBtn = defaultBtnId ? document.getElementById(defaultBtnId) : null;
    if (defaultBtn) {
      const onclick = defaultBtn.getAttribute('href') || defaultBtn.getAttribute('onclick') || '';
      const m = onclick.match(/__doPostBack\(['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\)/);
      if (m && typeof window.__doPostBack === 'function') {
        window.__doPostBack(m[1], m[2]);
        console.log(`[ACE:login] ✓ ${type} — __doPostBack:`, m[1]);
        return;
      }
      defaultBtn.click();
      return;
    }

    // Scan for login button with __doPostBack
    const noise = ['cancel', 'back', 'reset', 'close', 'cookie', 'reject', 'forgot', 'detail'];
    const loginWords = ['continu', 'log in', 'login', 'sign in'];
    for (const el of document.querySelectorAll('a, input, button')) {
      const t = (el.value || el.innerText || el.textContent || '').toLowerCase().trim();
      if (!t || noise.some(w => t.includes(w))) continue;
      if (!loginWords.some(w => t.includes(w))) continue;
      const href = el.getAttribute('href') || el.getAttribute('onclick') || '';
      const m = href.match(/__doPostBack\(['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\)/);
      const target = m ? m[1] : (el.id || '').replace(/_/g, '$');
      const evtTarget = form.querySelector('input[name="__EVENTTARGET"]');
      const evtArg = form.querySelector('input[name="__EVENTARGUMENT"]');
      if (evtTarget && target) evtTarget.value = target;
      if (evtArg) evtArg.value = '';
      form.submit();
      console.log(`[ACE:login] ✓ ${type} — __EVENTTARGET:`, target);
      return;
    }

    // Final fallback — Enter key
    ['keydown', 'keypress', 'keyup'].forEach(t =>
      field.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', keyCode: 13, bubbles: true }))
    );
    console.log(`[ACE:login] ✓ ${type} — Enter key fallback`);
  }

  function resetAttemptFlag() { _corpAttempted = false; }

  return { isCorporatePage, isUserPage, doCorporate, doUser, resetAttemptFlag };
})();
