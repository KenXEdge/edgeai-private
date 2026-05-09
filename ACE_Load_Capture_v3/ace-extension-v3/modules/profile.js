// ACE — profile.js
// Broker profile fetch from Sylectus II14_promabprofile.asp
// Extracts 6 critical fields: broker_name, company_name, broker_contact_name,
// broker_email, broker_phone, broker_title
// URL constructed from onclick parameter extraction — no clicking required

const ACEProfile = (() => {

  // Extract broker profile URL from onclick attribute
  // onclick format: openawindow('II14_promabprofile.asp?pronumuk=X&mabcode=Y&postedby=Z', ...)
  function extractProfileUrl(onclickStr) {
    if (!onclickStr) return null;
    const match = onclickStr.match(/II14_promabprofile\.asp\?[^'"\\)]+/);
    if (!match) return null;
    return 'https://www6.sylectus.com/' + match[0];
  }

  // Extract broker href from load row cells[0]
  // The red underlined broker company name has the onclick with profile URL
  function getBrokerHref(cell0) {
    if (!cell0) return { href: '', name: '' };
    const links = cell0.querySelectorAll('a');
    for (const a of links) {
      const onclick = a.getAttribute('onclick') || '';
      if (onclick.includes('II14_promabprofile.asp')) {
        const href = extractProfileUrl(onclick);
        return {
          href: href || '',
          name: a.innerText?.trim() || ''
        };
      }
    }
    return { href: '', name: '' };
  }

  // Fetch and parse the 6 critical fields from the profile page
  async function fetch6Fields(profileUrl) {
    if (!profileUrl) return {};

    try {
      const resp = await fetch(profileUrl, { credentials: 'include' });
      if (!resp.ok) {
        console.warn(`[ACE:profile] Fetch failed: ${resp.status}`);
        return {};
      }

      const html = await resp.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      function getField(label) {
        const tds = doc.querySelectorAll('td');
        for (let i = 0; i < tds.length; i++) {
          const cell = (tds[i].textContent || '').trim().replace(/:$/, '').toUpperCase();
          if (cell === label.toUpperCase()) {
            return (tds[i + 1]?.textContent || '').trim();
          }
        }
        return '';
      }

      const result = {
        broker_name:         getField('BROKER NAME'),
        company_name:        getField('COMPANY NAME'),
        broker_contact_name: getField('POSTED BY'),
        broker_email:        getField('E-MAIL'),
        broker_phone:        getField('POSTED BY PHONE'),
        broker_title:        getField('POSTED BY TITLE')
      };

      console.log(`[ACE:profile] ✓ Fetched — email: ${result.broker_email || 'NOT FOUND'}`);
      return result;

    } catch(e) {
      console.error('[ACE:profile] Fetch error:', e);
      return {};
    }
  }

  return { getBrokerHref, fetch6Fields, extractProfileUrl };
})();
