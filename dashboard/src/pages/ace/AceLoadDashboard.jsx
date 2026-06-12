// ACE Sylectus — Load Dashboard (F38: load-landing / alert surface)
// Path: dashboard/src/pages/ace/AceLoadDashboard.jsx
// Route (add to App.jsx, inside RequireAceAccess): /ace/loads
//
// Cloud model: the VM PRODUCES rows (scrape → detect → qualify → write) and is the
// DOER (sends bids from the carrier's Gmail). This page READS those rows and writes
// carrier DECISIONS as intents. The VM reconciles.
//
// Verified live (project siafwhlzazefyoevslde, 2026-06-11) — status values are the
// authoritative DB CHECK constraints, not guesses:
//   ace_active_loads.status ∈ active|qualified|bidding|bid_sent|passed|won|lost|expired
//   ace_bid_loads.status    ∈ draft|sent|responded|won|lost|no_response|withdrawn
//   source                  ∈ syl|ntg|dat|highway|truckstop
//   unique: ace_active_loads & ace_pass_tracker on (carrier_id, source, order_no)
//   ace_bid_loads.load_id   → FK ace_active_loads.id
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ PROPOSED INTENT CONTRACT — confirm against the VM trigger logic before relying on it.
//   The schema has no explicit "send requested" flag, so the draft/send handoff below
//   is a PROPOSAL. PASS is terminal and safe. Draft/Send writes are schema-valid but
//   the VM must agree on which state it watches to draft vs. actually send the Gmail.
//
//   PASS        → upsert ace_pass_tracker (pass_count++)              [SAFE/terminal]
//                 + ace_active_loads.status = 'passed'
//                 + ace_metrics_events 'load_passed'
//   DRAFT BID   → insert ace_bid_loads (status='draft', bid_amount)  [⚠️ VM watches this?]
//                 + ace_active_loads.status = 'bidding'
//                 + ace_metrics_events 'bid_drafted'
//   SEND BID    → ace_bid_loads.status='sent', sent_at=now           [⚠️ does the VM own
//                 + ace_active_loads.status='bid_sent'                  the 'sent' flip after
//                 + ace_metrics_events 'bid_sent'                       it actually emails?]
//   If the VM is the sender, SEND should set an intent the VM watches and the VM should
//   own the 'sent'/sent_at transition. Adjust INTENT.sendBid once the trigger is confirmed.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'

const BLUE = '#0C447C'
const POLL_MS = 30000

const STATUS_STYLE = {
  active:    'bg-blue-100 text-blue-700',
  qualified: 'bg-indigo-100 text-indigo-700',
  bidding:   'bg-amber-100 text-amber-700',
  bid_sent:  'bg-amber-100 text-amber-700',
  draft:     'bg-amber-100 text-amber-700',
  sent:      'bg-amber-100 text-amber-700',
  responded: 'bg-violet-100 text-violet-700',
  won:       'bg-green-100 text-green-700',
  lost:      'bg-slate-200 text-slate-600',
  passed:    'bg-slate-200 text-slate-600',
  expired:   'bg-slate-200 text-slate-500',
  no_response: 'bg-slate-200 text-slate-500',
  withdrawn: 'bg-slate-200 text-slate-500',
}

const fmtRate = v => (v == null || v === '') ? '—' : `$${Number(v).toLocaleString()}`
const lane = (c1, s1, c2, s2) =>
  `${[c1, s1].filter(Boolean).join(', ') || '—'} → ${[c2, s2].filter(Boolean).join(', ') || '—'}`
const ago = ts => {
  if (!ts) return ''
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/* ── proposed intent writes — see contract block above ── */
const INTENT = {
  async pass(carrierId, load) {
    const { source, order_no, id } = load
    const existing = await supabase.from('ace_pass_tracker').select('pass_count')
      .eq('carrier_id', carrierId).eq('source', source).eq('order_no', order_no).maybeSingle()
    const now = new Date().toISOString()
    const count = (existing.data?.pass_count || 0) + 1
    await supabase.from('ace_pass_tracker').upsert({
      carrier_id: carrierId, source, order_no,
      pass_count: count,
      first_pass_at: existing.data ? undefined : now,
      last_pass_at: now, updated_at: now,
    }, { onConflict: 'carrier_id,source,order_no' })
    await supabase.from('ace_active_loads').update({
      status: 'passed', reviewed_at: now, decision_at: now, updated_at: now,
    }).eq('id', id)
    await supabase.from('ace_metrics_events').insert({
      carrier_id: carrierId, source, event_type: 'load_passed', order_no,
    })
  },
  async draftBid(carrierId, load, bidAmount) {
    const { source, order_no, id } = load
    const now = new Date().toISOString()
    await supabase.from('ace_bid_loads').insert({
      carrier_id: carrierId, source, order_no, load_id: id,
      broker_name: load.broker_name, broker_email: load.broker_email,
      pickup_city: load.pickup_city, pickup_state: load.pickup_state,
      delivery_city: load.delivery_city, delivery_state: load.delivery_state,
      miles: load.miles, vehicle_size: load.vehicle_size,
      suggested_rate: load.suggested_rate, bid_amount: bidAmount,
      status: 'draft', drafted_at: now,
    })
    await supabase.from('ace_active_loads').update({
      status: 'bidding', reviewed_at: now, decision_at: now, updated_at: now,
    }).eq('id', id)
    await supabase.from('ace_metrics_events').insert({
      carrier_id: carrierId, source, event_type: 'bid_drafted', order_no,
    })
  },
  async sendBid(carrierId, load, bidAmount) {
    // ⚠️ if the VM is the actual email sender, this should set an intent and let the VM
    //    own the 'sent'/sent_at transition. Confirm before treating 'sent' as truth.
    const { source, order_no, id } = load
    const now = new Date().toISOString()
    const draft = await supabase.from('ace_bid_loads').select('id')
      .eq('carrier_id', carrierId).eq('source', source).eq('order_no', order_no)
      .eq('status', 'draft').order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (draft.data) {
      await supabase.from('ace_bid_loads').update({
        status: 'sent', sent_at: now, bid_amount: bidAmount, updated_at: now,
      }).eq('id', draft.data.id)
    } else {
      await supabase.from('ace_bid_loads').insert({
        carrier_id: carrierId, source, order_no, load_id: id,
        broker_name: load.broker_name, broker_email: load.broker_email,
        suggested_rate: load.suggested_rate, bid_amount: bidAmount,
        status: 'sent', sent_at: now,
      })
    }
    await supabase.from('ace_active_loads').update({
      status: 'bid_sent', decision_at: now, updated_at: now,
    }).eq('id', id)
    await supabase.from('ace_metrics_events').insert({
      carrier_id: carrierId, source, event_type: 'bid_sent', order_no,
    })
  },
}

export default function AceLoadDashboard() {
  const [carrierId, setCarrierId] = useState(null)
  const [tab, setTab] = useState('queue')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const [sample, setSample] = useState(false)

  const [loads, setLoads] = useState([])
  const [bids, setBids] = useState([])
  const [wins, setWins] = useState([])

  const fetchAll = useCallback(async (cid) => {
    const [l, b, w] = await Promise.all([
      supabase.from('ace_active_loads').select('*').eq('carrier_id', cid)
        .order('detected_at', { ascending: false }),
      supabase.from('ace_bid_loads').select('*').eq('carrier_id', cid)
        .order('created_at', { ascending: false }),
      supabase.from('load_wins').select('*').eq('carrier_id', cid)
        .order('created_at', { ascending: false }),
    ])
    if (l.error || b.error || w.error) {
      setError((l.error || b.error || w.error).message)
    } else {
      setLoads(l.data || []); setBids(b.data || []); setWins(w.data || []); setError('')
    }
  }, [])

  useEffect(() => {
    let timer
    async function init() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setError('Sign in to view loads.'); setLoading(false); return }
      setCarrierId(session.user.id)
      await fetchAll(session.user.id)
      setLoading(false)
      timer = setInterval(() => { if (!sample) fetchAll(session.user.id) }, POLL_MS)
    }
    init()
    return () => timer && clearInterval(timer)
  }, [fetchAll, sample])

  async function act(fn, load, ...args) {
    if (sample) return
    setBusyId(load.id); setError('')
    try { await fn(carrierId, load, ...args); await fetchAll(carrierId) }
    catch (e) { setError(e.message || 'Action failed.') }
    finally { setBusyId(null) }
  }

  const view = sample ? SAMPLE : { loads, bids, wins }
  const queue = view.loads.filter(l => ['active', 'qualified', 'bidding', 'bid_sent'].includes(l.status))
  const metrics = {
    queue: view.loads.filter(l => ['active', 'qualified'].includes(l.status)).length,
    bidding: view.loads.filter(l => ['bidding', 'bid_sent'].includes(l.status)).length,
    sent: view.bids.filter(b => ['sent', 'responded'].includes(b.status)).length,
    won: view.wins.length,
    passed: view.loads.filter(l => l.status === 'passed').length,
  }

  if (loading) return <div className="text-slate-400 text-sm animate-pulse">Loading loads…</div>

  return (
    <div className="max-w-5xl space-y-5">
      {/* header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">ACE · Sylectus</p>
          <h1 className="text-2xl font-bold text-slate-800">Loads</h1>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer select-none">
          <input type="checkbox" checked={sample} onChange={e => setSample(e.target.checked)}
            className="accent-[#0C447C]" />
          Sample data (preview)
        </label>
      </div>

      {/* metrics bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Metric label="In queue" value={metrics.queue} />
        <Metric label="Bidding" value={metrics.bidding} />
        <Metric label="Bids sent" value={metrics.sent} />
        <Metric label="Won" value={metrics.won} accent="text-green-600" />
        <Metric label="Passed" value={metrics.passed} accent="text-slate-400" />
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}

      {/* tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {[['queue', `Queue (${queue.length})`], ['bids', `Bids (${view.bids.length})`], ['wins', `Wins (${view.wins.length})`]].map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === k ? 'border-[#0C447C] text-[#0C447C]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {lbl}
          </button>
        ))}
      </div>

      {tab === 'queue' && (
        queue.length === 0
          ? <Empty title="No loads in the queue" body="Qualifying loads detected by ACE land here for your decision." />
          : <div className="space-y-3">{queue.map(l =>
              <LoadCard key={l.id} load={l} busy={busyId === l.id} sample={sample} act={act} />)}</div>
      )}

      {tab === 'bids' && (
        view.bids.length === 0
          ? <Empty title="No bids yet" body="Bids you draft or send appear here with their outcome." />
          : <Table cols={['Lane', 'Broker', 'Bid', 'Status', 'When']}
              rows={view.bids.map(b => [
                lane(b.pickup_city, b.pickup_state, b.delivery_city, b.delivery_state),
                b.broker_name || b.broker_email || '—',
                fmtRate(b.bid_amount),
                <Badge status={b.status} />,
                ago(b.sent_at || b.created_at),
              ])} />
      )}

      {tab === 'wins' && (
        view.wins.length === 0
          ? <Empty title="No wins logged" body="Confirmed loads land in your WIN log." />
          : <Table cols={['Lane', 'Broker', 'Rate', 'Reference', 'When']}
              rows={view.wins.map(w => [
                `${w.load_origin || '—'} → ${w.load_destination || '—'}`,
                w.broker_company || w.broker_name || '—',
                fmtRate(w.rate_confirmed),
                w.load_reference || '—',
                ago(w.created_at),
              ])} />
      )}
    </div>
  )
}

/* ── load card with actions ── */
function LoadCard({ load, busy, sample, act }) {
  const [bidding, setBidding] = useState(false)
  const [amount, setAmount] = useState(load.suggested_rate ?? '')
  const decided = ['bidding', 'bid_sent', 'passed'].includes(load.status)

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-800">{lane(load.pickup_city, load.pickup_state, load.delivery_city, load.delivery_state)}</span>
            <Badge status={load.status} />
            <span className="text-[10px] uppercase tracking-wide text-slate-400 border border-slate-200 rounded px-1">{load.source}</span>
          </div>
          <div className="mt-1 text-sm text-slate-500 flex flex-wrap gap-x-4 gap-y-0.5">
            <span>{load.broker_name || load.broker_company || 'Unknown broker'}</span>
            {load.miles != null && <span>{load.miles} mi</span>}
            {load.vehicle_size && <span>{load.vehicle_size}</span>}
            {load.weight && <span>{load.weight} lbs</span>}
            {load.pickup_date && <span>PU {load.pickup_date}</span>}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            Order {load.order_no}{load.suggested_rate != null && <> · suggested {fmtRate(load.suggested_rate)}</>} · {ago(load.detected_at)}
          </div>
        </div>
      </div>

      {!decided && !bidding && (
        <div className="mt-3 flex gap-2">
          <button disabled={busy || sample} onClick={() => act(INTENT.pass, load)}
            className="px-3 py-1.5 rounded-lg text-sm font-medium border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            Pass
          </button>
          <button disabled={busy || sample} onClick={() => setBidding(true)}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: BLUE }}>
            Bid
          </button>
        </div>
      )}

      {!decided && bidding && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-500">Bid $</span>
          <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
            className="w-32 rounded-lg border border-slate-300 px-3 py-1.5 text-sm
                       focus:outline-none focus:ring-2 focus:ring-[#0C447C]/30 focus:border-[#0C447C]" />
          <button disabled={busy || sample} onClick={() => act(INTENT.draftBid, load, Number(amount))}
            className="px-3 py-1.5 rounded-lg text-sm font-medium border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Save draft
          </button>
          <button disabled={busy || sample} onClick={() => act(INTENT.sendBid, load, Number(amount))}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: BLUE }}>
            Send bid
          </button>
          <button disabled={busy} onClick={() => setBidding(false)}
            className="px-2 py-1.5 text-sm text-slate-400 hover:text-slate-600">Cancel</button>
        </div>
      )}

      {decided && (
        <div className="mt-2 text-xs text-slate-400">
          {load.status === 'passed' ? 'Passed' : load.status === 'bid_sent' ? 'Bid sent — awaiting broker' : 'Bid drafted'}
        </div>
      )}
    </div>
  )
}

/* ── presentational helpers ── */
function Metric({ label, value, accent }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
      <div className={`text-2xl font-bold ${accent || 'text-slate-800'}`}>{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  )
}
function Badge({ status }) {
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${STATUS_STYLE[status] || 'bg-slate-100 text-slate-500'}`}>
      {String(status).replace('_', ' ')}
    </span>
  )
}
function Empty({ title, body }) {
  return (
    <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center">
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      <p className="mt-1 text-sm text-slate-400">{body}</p>
    </div>
  )
}
function Table({ cols, rows }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-500">
          <tr>{cols.map(c => <th key={c} className="text-left font-medium px-4 py-2.5">{c}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={i} className="text-slate-700">
              {r.map((cell, j) => <td key={j} className="px-4 py-3">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ── client-only sample data (decision D preview; never written to Supabase) ── */
const SAMPLE = {
  loads: [
    { id: 's1', source: 'syl', order_no: 'SYL-48213', status: 'qualified',
      pickup_city: 'Dallas', pickup_state: 'TX', delivery_city: 'Tulsa', delivery_state: 'OK',
      miles: 257, vehicle_size: 'Large Straight', weight: '6,400', pickup_date: '06/12',
      broker_name: 'Reliance Partners', suggested_rate: 640, detected_at: new Date(Date.now() - 6 * 60000).toISOString() },
    { id: 's2', source: 'syl', order_no: 'SYL-48199', status: 'active',
      pickup_city: 'Fort Worth', pickup_state: 'TX', delivery_city: 'Oklahoma City', delivery_state: 'OK',
      miles: 205, vehicle_size: 'Small Straight', weight: '3,100', pickup_date: '06/12',
      broker_name: 'Coyote Logistics', suggested_rate: 510, detected_at: new Date(Date.now() - 22 * 60000).toISOString() },
    { id: 's3', source: 'syl', order_no: 'SYL-48140', status: 'bid_sent',
      pickup_city: 'Denton', pickup_state: 'TX', delivery_city: 'Shreveport', delivery_state: 'LA',
      miles: 232, vehicle_size: 'Large Straight', weight: '7,800', pickup_date: '06/13',
      broker_name: 'TQL', suggested_rate: 700, detected_at: new Date(Date.now() - 90 * 60000).toISOString() },
  ],
  bids: [
    { id: 'b1', pickup_city: 'Denton', pickup_state: 'TX', delivery_city: 'Shreveport', delivery_state: 'LA',
      broker_name: 'TQL', bid_amount: 725, status: 'sent', sent_at: new Date(Date.now() - 40 * 60000).toISOString() },
    { id: 'b2', pickup_city: 'Plano', pickup_state: 'TX', delivery_city: 'Little Rock', delivery_state: 'AR',
      broker_name: 'Echo Global', bid_amount: 880, status: 'responded', sent_at: new Date(Date.now() - 5 * 3600000).toISOString() },
  ],
  wins: [
    { id: 'w1', load_origin: 'Plano, TX', load_destination: 'Little Rock, AR', broker_company: 'Echo Global',
      rate_confirmed: 880, load_reference: 'ECH-99421', created_at: new Date(Date.now() - 3 * 3600000).toISOString() },
  ],
}
