// Resolves 6-char opaque tokens (book/rebid/pass) to the correct page.
// Triggered by vercel.json rewrite: /:token([A-Za-z0-9]{6}) -> /api/:token
//
// Mirrors the logic of Cloud Run /<token> handler in main.py line 3290.
// Looks up the token in edge_load_activity, checks state, redirects.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  const { token } = req.query;

  // Basic shape check
  if (!token || !/^[A-Za-z0-9]{6}$/.test(token)) {
    return res.redirect(302, '/expired.html');
  }

  // Find the row that has this token in any of the three columns
  const { data, error } = await supabase
    .from('edge_load_activity')
    .select('book_token, rebid_token, pass_token, consumed_at, expires_at, rate_offered')
    .or(`book_token.eq.${token},rebid_token.eq.${token},pass_token.eq.${token}`)
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return res.redirect(302, '/expired.html');
  }

  // Already-used (any action taken on this row already)
  if (data.consumed_at) {
    return res.redirect(302, '/already-used.html');
  }

  // Time expiry
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return res.redirect(302, '/expired.html');
  }

  // Dispatch by which token matched
  if (token === data.book_token) {
    return res.redirect(302, `/book-confirm.html?t=${token}`);
  }
  if (token === data.rebid_token) {
    const offer = data.rate_offered ?? '';
    return res.redirect(302, `/rebid.html?t=${token}&offer=${encodeURIComponent(offer)}`);
  }
  if (token === data.pass_token) {
    return res.redirect(302, `/passed.html?t=${token}`);
  }

  // Shouldn't reach here given the OR query matched
  return res.redirect(302, '/expired.html');
}
