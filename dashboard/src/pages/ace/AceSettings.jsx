// ACE Sylectus — Settings page
// Path: dashboard/src/pages/ace/AceSettings.jsx   (matches App.jsx import)
// Gated upstream by RequireAceAccess (ace_vm_access.active === true).
//
// Cloud model (Console Spec §1/§5): this page writes carrier state DIRECTLY to
// Supabase via the carrier's auth session. The VM reads these rows and acts.
//
// Verified live against project siafwhlzazefyoevslde (2026-06-11):
//   ace_syl_settings       — unique(carrier_id); NO example_miles column
//   loadboard_credentials  — credentials jsonb; unique(carrier_id, source); source NOT NULL
//   ace_vm_access          — active/paused bool; unique(carrier_id, source); source = 'syl'
//
// ── OPEN CONTRACT CONFIRMS (must match the VM-side reader before any external carrier) ──
//   1. CRED_KEYS.corpId / .username — identifier key names in credentials jsonb are
//      UNCONFIRMED. Only the two password keys are verified (extension settings.js).
//   2. SOURCE 'syl' — loadboard_credentials.source string the VM credential reader expects.
//      Set to match ace_vm_access ('syl'); confirm the VM uses the same string.
//   3. LOAD_TYPE_OPTIONS values — must match the VM Sylectus matcher. Live row uses
//      ["ltl","expedite"]; the retired extension used different strings.

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'

const SOURCE = 'syl' // ⚠️ confirm VM credential reader keys on 'syl'

// credentials jsonb keys. corpPassword + password are VERIFIED. corpId + username
// are UNCONFIRMED — confirm against the VM Sylectus login code before external use.
const CRED_KEYS = {
  corpId:       'sylectus_corp_id',       // ⚠️ UNCONFIRMED
  corpPassword: 'sylectus_corp_password', // verified
  username:     'sylectus_username',      // ⚠️ UNCONFIRMED
  password:     'sylectus_password',      // verified
}

// ⚠️ values must match the VM Sylectus matcher. Live data uses 'ltl' / 'expedite'.
const LOAD_TYPE_OPTIONS = [
  { value: 'expedite',       label: 'Expedite' },
  { value: 'ltl',            label: 'LTL' },
  { value: 'large straight', label: 'Large Straight' },
  { value: 'small straight', label: 'Small Straight' },
]

const BLUE = '#0C447C'

const EMPTY_SETTINGS = {
  mc_number: '', bid_contact_name: '',
  search_from_city: '', search_from_state: '', search_to_states_raw: '',
  pickup_radius: '', max_weight: '', max_miles: '', max_load_age: '', rpm: '',
}

const toIntOrNull = v => {
  if (v === '' || v == null) return null
  const n = parseInt(v, 10); return Number.isNaN(n) ? null : n
}
const toNumOrNull = v => {
  if (v === '' || v == null) return null
  const n = parseFloat(v); return Number.isNaN(n) ? null : n
}

export default function AceSettings() {
  const [carrierId, setCarrierId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const [toast, setToast]     = useState('')

  const [entitled, setEntitled] = useState(true)
  const [paused, setPaused]     = useState(false)

  const [settings, setSettings]   = useState(EMPTY_SETTINGS)
  const [loadTypes, setLoadTypes] = useState([])

  const [creds, setCreds]       = useState({ corpId: '', username: '' }) // identifiers (not secret)
  const [corpPw, setCorpPw]     = useState('')
  const [userPw, setUserPw]     = useState('')
  const [corpPwSet, setCorpPwSet] = useState(false)
  const [userPwSet, setUserPwSet] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setError('Sign in to manage ACE settings.'); setLoading(false); return }
      const cid = session.user.id
      setCarrierId(cid)

      const [access, syl, lbc] = await Promise.all([
        supabase.from('ace_vm_access').select('active, paused')
          .eq('carrier_id', cid).eq('source', SOURCE).maybeSingle(),
        supabase.from('ace_syl_settings').select('*')
          .eq('carrier_id', cid).maybeSingle(),
        supabase.from('loadboard_credentials').select('credentials')
          .eq('carrier_id', cid).eq('source', SOURCE).maybeSingle(),
      ])

      setEntitled(!!access.data?.active)
      setPaused(!!access.data?.paused)

      if (syl.data) {
        setSettings({
          mc_number:            syl.data.mc_number ?? '',
          bid_contact_name:     syl.data.bid_contact_name ?? '',
          search_from_city:     syl.data.search_from_city ?? '',
          search_from_state:    syl.data.search_from_state ?? '',
          search_to_states_raw: syl.data.search_to_states_raw ?? '',
          pickup_radius:        syl.data.pickup_radius ?? '',
          max_weight:           syl.data.max_weight ?? '',
          max_miles:            syl.data.max_miles ?? '',
          max_load_age:         syl.data.max_load_age ?? '',
          rpm:                  syl.data.rpm ?? '',
        })
        setLoadTypes(Array.isArray(syl.data.target_load_types) ? syl.data.target_load_types : [])
      }

      const c = lbc.data?.credentials || {}
      setCreds({ corpId: c[CRED_KEYS.corpId] ?? '', username: c[CRED_KEYS.username] ?? '' })
      setCorpPwSet(!!c[CRED_KEYS.corpPassword])
      setUserPwSet(!!c[CRED_KEYS.password])
    } catch (e) {
      setError(e.message || 'Could not load settings.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const flash = msg => { setToast(msg); setTimeout(() => setToast(''), 2500) }
  const setField = (k, v) => setSettings(s => ({ ...s, [k]: v }))
  const toggleLoadType = v =>
    setLoadTypes(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])

  async function save() {
    if (!carrierId) return
    setSaving(true); setError('')
    try {
      // 1) ace_syl_settings — no example_miles column; max_load_age is NOT NULL
      const r1 = await supabase.from('ace_syl_settings').upsert({
        carrier_id:           carrierId,
        mc_number:            settings.mc_number.trim() || null,
        bid_contact_name:     settings.bid_contact_name.trim() || null,
        search_from_city:     settings.search_from_city.trim() || null,
        search_from_state:    settings.search_from_state.trim().toUpperCase() || null,
        search_to_states_raw: settings.search_to_states_raw
                                .split(',').map(s => s.trim().toUpperCase()).filter(Boolean).join(','),
        pickup_radius:        toIntOrNull(settings.pickup_radius),
        max_weight:           toIntOrNull(settings.max_weight),
        max_miles:            toIntOrNull(settings.max_miles),
        max_load_age:         toIntOrNull(settings.max_load_age) ?? 0,
        rpm:                  toNumOrNull(settings.rpm),
        target_load_types:    loadTypes,
        updated_at:           new Date().toISOString(),
      }, { onConflict: 'carrier_id' })
      if (r1.error) throw r1.error

      // 2) loadboard_credentials — MERGE (blank password leaves the stored one intact),
      //    keyed on (carrier_id, source); source is required.
      const existing = await supabase.from('loadboard_credentials')
        .select('credentials').eq('carrier_id', carrierId).eq('source', SOURCE).maybeSingle()
      const merged = { ...(existing.data?.credentials || {}) }
      if (creds.corpId.trim())   merged[CRED_KEYS.corpId]   = creds.corpId.trim()
      if (creds.username.trim()) merged[CRED_KEYS.username] = creds.username.trim()
      if (corpPw) merged[CRED_KEYS.corpPassword] = corpPw
      if (userPw) merged[CRED_KEYS.password]     = userPw

      const r2 = await supabase.from('loadboard_credentials').upsert({
        carrier_id: carrierId,
        source:     SOURCE,
        credentials: merged,
        active:     true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'carrier_id,source' })
      if (r2.error) throw r2.error

      if (corpPw) { setCorpPwSet(true); setCorpPw('') }
      if (userPw) { setUserPwSet(true); setUserPw('') }
      flash('Settings saved')
    } catch (e) {
      setError(e.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  async function togglePause() {
    if (!carrierId) return
    const next = !paused
    setPaused(next)
    const { error: e } = await supabase.from('ace_vm_access')
      .update({ paused: next, updated_at: new Date().toISOString() })
      .eq('carrier_id', carrierId).eq('source', SOURCE)
    if (e) { setPaused(!next); setError(e.message); return }
    flash(next ? 'ACE paused' : 'ACE resumed')
  }

  if (loading) return <div className="text-slate-400 text-sm animate-pulse">Loading ACE settings…</div>

  if (!entitled) return (
    <div className="max-w-xl bg-white rounded-xl border border-slate-200 p-6">
      <h2 className="text-lg font-bold text-slate-800">ACE Sylectus Edition isn’t active</h2>
      <p className="mt-2 text-sm text-slate-600">
        This account doesn’t have an active ACE Sylectus subscription. Activate it to
        configure load search, bid filters, and Sylectus access.
      </p>
      <a href="/subscribe" className="inline-block mt-4 px-4 py-2 rounded-lg text-white text-sm font-medium"
         style={{ background: BLUE }}>View plans</a>
    </div>
  )

  const pill = paused
    ? { label: 'Paused', cls: 'bg-amber-100 text-amber-700' }
    : { label: 'Running', cls: 'bg-green-100 text-green-700' }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">ACE · Sylectus</p>
          <h1 className="text-2xl font-bold text-slate-800">Settings</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${pill.cls}`}>{pill.label}</span>
          <button onClick={togglePause}
            className="px-3 py-2 rounded-lg text-sm font-medium border border-slate-300 text-slate-700 hover:bg-slate-50">
            {paused ? 'Resume ACE' : 'Pause ACE'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>
      )}

      <Section title="Sylectus access"
        note="Stored in your carrier record. Leave a password blank to keep the saved one.">
        <Grid>
          <Field label="Corporate ID">
            <Input value={creds.corpId} onChange={v => setCreds(c => ({ ...c, corpId: v }))}
              placeholder="Sylectus corporate ID" autoComplete="off" />
          </Field>
          <Field label="Corporate password" badge={corpPwSet ? 'Saved' : null}>
            <Input type="password" value={corpPw} onChange={setCorpPw} autoComplete="new-password"
              placeholder={corpPwSet ? '•••••••• (unchanged)' : 'Enter corporate password'} />
          </Field>
          <Field label="User ID">
            <Input value={creds.username} onChange={v => setCreds(c => ({ ...c, username: v }))}
              placeholder="Sylectus user ID" autoComplete="off" />
          </Field>
          <Field label="User password" badge={userPwSet ? 'Saved' : null}>
            <Input type="password" value={userPw} onChange={setUserPw} autoComplete="new-password"
              placeholder={userPwSet ? '•••••••• (unchanged)' : 'Enter user password'} />
          </Field>
        </Grid>
      </Section>

      <Section title="Bid identity">
        <Grid>
          <Field label="MC number">
            <Input value={settings.mc_number} onChange={v => setField('mc_number', v)} placeholder="1610666" />
          </Field>
          <Field label="Bid contact name">
            <Input value={settings.bid_contact_name} onChange={v => setField('bid_contact_name', v)}
              placeholder="Name shown to brokers" />
          </Field>
        </Grid>
      </Section>

      <Section title="Load search">
        <Grid>
          <Field label="From city">
            <Input value={settings.search_from_city} onChange={v => setField('search_from_city', v)} placeholder="Dallas" />
          </Field>
          <Field label="From state">
            <Input value={settings.search_from_state} onChange={v => setField('search_from_state', v.toUpperCase())}
              maxLength={2} placeholder="TX" />
          </Field>
          <Field label="To states" hint="Comma-separated">
            <Input value={settings.search_to_states_raw} onChange={v => setField('search_to_states_raw', v)} placeholder="TX, OK" />
          </Field>
          <Field label="Pickup radius (mi)">
            <Input type="number" value={settings.pickup_radius} onChange={v => setField('pickup_radius', v)} placeholder="50" />
          </Field>
        </Grid>
      </Section>

      <Section title="Bid filters" note="ACE only surfaces and bids loads inside these limits.">
        <Grid>
          <Field label="Max weight (lbs)">
            <Input type="number" value={settings.max_weight} onChange={v => setField('max_weight', v)} placeholder="9000" />
          </Field>
          <Field label="Max miles">
            <Input type="number" value={settings.max_miles} onChange={v => setField('max_miles', v)} placeholder="500" />
          </Field>
          <Field label="Max load age">
            <Input type="number" value={settings.max_load_age} onChange={v => setField('max_load_age', v)} placeholder="30" />
          </Field>
          <Field label="Target RPM ($)">
            <Input type="number" step="0.01" value={settings.rpm} onChange={v => setField('rpm', v)} placeholder="2.49" />
          </Field>
        </Grid>
      </Section>

      <Section title="Load types" note="ACE monitors only the types you select.">
        <div className="flex flex-wrap gap-2">
          {LOAD_TYPE_OPTIONS.map(opt => {
            const on = loadTypes.includes(opt.value)
            return (
              <button key={opt.value} onClick={() => toggleLoadType(opt.value)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  on ? 'text-white border-transparent' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
                style={on ? { background: BLUE } : undefined}>
                {opt.label}
              </button>
            )
          })}
        </div>
        {loadTypes.length === 0 && (
          <p className="mt-2 text-xs text-red-500">No types selected — ACE won’t surface any loads.</p>
        )}
      </Section>

      <div className="flex items-center gap-4 sticky bottom-0 bg-slate-100/80 backdrop-blur py-3">
        <button onClick={save} disabled={saving}
          className="px-5 py-2.5 rounded-lg text-white text-sm font-semibold disabled:opacity-60"
          style={{ background: BLUE }}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {toast && <span className="text-sm font-medium text-green-600">{toast}</span>}
      </div>
    </div>
  )
}

/* ── presentational helpers ── */
function Section({ title, note, children }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h2 className="text-sm font-bold text-slate-800">{title}</h2>
      {note && <p className="mt-0.5 text-xs text-slate-500">{note}</p>}
      <div className="mt-4">{children}</div>
    </div>
  )
}
function Grid({ children }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>
}
function Field({ label, hint, badge, children }) {
  return (
    <label className="block">
      <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
        {label}
        {badge && <span className="text-[10px] font-bold uppercase tracking-wide text-green-600 bg-green-50 px-1.5 py-0.5 rounded">{badge}</span>}
      </span>
      {hint && <span className="block text-xs text-slate-400 mb-1">{hint}</span>}
      <div className={hint ? '' : 'mt-1'}>{children}</div>
    </label>
  )
}
function Input({ value, onChange, type = 'text', placeholder, step, maxLength, autoComplete }) {
  return (
    <input
      type={type} step={step} maxLength={maxLength} autoComplete={autoComplete}
      value={value} placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800
                 focus:outline-none focus:ring-2 focus:ring-[#0C447C]/30 focus:border-[#0C447C]"
    />
  )
}
