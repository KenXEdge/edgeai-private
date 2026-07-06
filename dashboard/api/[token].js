// Resolves 6-char opaque tokens (EDGE book/rebid/pass + ACE send/draft/pass) to the correct page.
// Triggered by vercel.json rewrite: /:token([A-Za-z0-9]{6}) -> /api/:token
//
// EDGE tokens live in edge_load_activity; ACE (Sylectus loadboard) tokens live in
// ace_sylectus_activity. On an EDGE miss, fall through to the ACE lookup.
// APPLY TO CANONICAL: edgeai-private/dashboard/api/[token].js  (NOT the XBase1 fork)

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  const { token } = req.query;

  if (!token || !/^[A-Za-z0-9]{6}$/.test(token)) {
    return res.redirect(302, '/expired.html');
  }

  // --- EDGE lookup ---
  const { data, error } = await supabase
    .from('edge_load_activity')
    .select('book_token, rebid_token, pass_token, consumed_at, expires_at, rate_offered')
    .or(`book_token.eq.${token},rebid_token.eq.${token},pass_token.eq.${token}`)
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    // Not an EDGE token — try ACE (Sylectus loadboard)
    return resolveAce(token, res);
  }

  if (data.consumed_at) {
    return res.redirect(302, '/already-used.html');
  }
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return res.redirect(302, '/expired.html');
  }
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
  return res.redirect(302, '/expired.html');
}

// --- ACE branch ---
async function resolveAce(token, res) {
  const { data, error } = await supabase
    .from('ace_sylectus_activity')
    .select('send_bid_token, draft_bid_token, pass_token, consumed_at, expires_at')
    .or(`send_bid_token.eq.${token},draft_bid_token.eq.${token},pass_token.eq.${token}`)
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return res.redirect(302, '/expired.html');
  }
  if (data.consumed_at) {
    return res.redirect(302, '/already-used.html');
  }
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return res.redirect(302, '/expired.html');
  }
  if (token === data.send_bid_token) {
    return res.redirect(302, `/ace-bid.html?t=${token}`);
  }
  if (token === data.draft_bid_token) {
    return res.redirect(302, `/ace-draft.html?t=${token}`);
  }
  if (token === data.pass_token) {
    return res.redirect(302, `/ace-pass.html?t=${token}`);
  }
  return res.redirect(302, '/expired.html');
}
