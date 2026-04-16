import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

const CARRIER_UUID = 'e84dfb58-d265-4a75-a7da-161b667a0208'

const classificationStyles = {
  load_offer: { dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700', label: 'Load Offer' },
  positive:   { dot: 'bg-blue-400',    badge: 'bg-blue-100 text-blue-700',       label: 'Positive'   },
  negative:   { dot: 'bg-red-400',     badge: 'bg-red-100 text-red-600',         label: 'Negative'   },
  neutral:    { dot: 'bg-slate-400',   badge: 'bg-slate-100 text-slate-600',     label: 'Neutral'    },
}

function AceBadge({ status }) {
  const styles = {
    active:   'bg-emerald-100 text-emerald-700',
    pending:  'bg-yellow-100 text-yellow-700',
    inactive: 'bg-slate-100 text-slate-500',
  }
  const labels = { active: 'ACE Active', pending: 'ACE Pending', inactive: 'ACE Inactive' }
  const dotColors = { active: 'bg-emerald-500', pending: 'bg-yellow-500', inactive: 'bg-slate-400' }
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${styles[status] || styles.inactive}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotColors[status] || dotColors.inactive}`} />
      {labels[status] || 'ACE Inactive'}
    </span>
  )
}

function MetricCard({ label, value, color }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-4 flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</span>
      <span className={`text-3xl font-bold ${color}`}>
        {value ?? <span className="text-slate-300 text-2xl">—</span>}
      </span>
    </div>
  )
}

function timeAgo(ts) {
  if (!ts) return ''
  const diff = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function CarrierHome() {
  const [carrier, setCarrier] = useState(null)
  const [metrics, setMetrics] = useState({ sentToday: null, responses: null, loadOffers: null, wins: null })
  const [feed, setFeed] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function loadAll() {
      try {
        // 1 — Carrier profile
        const { data: carrierRows, error: carrierErr } = await supabase
          .from('carriers')
          .select('company_name, mc_number, dot_number, owner_name, subscription_tier, ace_status')
          .eq('id', CARRIER_UUID)
          .limit(1)

        if (carrierErr) throw carrierErr
        setCarrier(carrierRows?.[0] || null)

        // 2 — Today's date range
        const todayStart = new Date()
        todayStart.setHours(0, 0, 0, 0)
        const todayISO = todayStart.toISOString()

        // Outreach sent today
        const { count: sentCount } = await supabase
          .from('outreach_log')
          .select('*', { count: 'exact', head: true })
          .eq('carrier_id', CARRIER_UUID)
          .gte('created_at', todayISO)

        // All responses today
        const { count: responseCount } = await supabase
          .from('responses')
          .select('*', { count: 'exact', head: true })
          .eq('carrier_id', CARRIER_UUID)
          .gte('created_at', todayISO)

        // Load offers today
        const { count: loadOfferCount } = await supabase
          .from('responses')
          .select('*', { count: 'exact', head: true })
          .eq('carrier_id', CARRIER_UUID)
          .eq('classification', 'load_offer')
          .gte('created_at', todayISO)

        // Wins this month
        const monthStart = new Date()
        monthStart.setDate(1)
        monthStart.setHours(0, 0, 0, 0)

        const { count: winCount } = await supabase
          .from('load_wins')
          .select('*', { count: 'exact', head: true })
          .eq('carrier_id', CARRIER_UUID)
          .gte('created_at', monthStart.toISOString())

        setMetrics({
          sentToday:  sentCount  ?? 0,
          responses:  responseCount ?? 0,
          loadOffers: loadOfferCount ?? 0,
          wins:       winCount   ?? 0,
        })

        // 3 — Live broker feed from responses table
        const { data: feedData, error: feedErr } = await supabase
          .from('responses')
          .select('id, broker_name, broker_email, broker_company, subject, classification, created_at, load_origin, load_destination, load_distance')
          .eq('carrier_id', CARRIER_UUID)
          .order('created_at', { ascending: false })
          .limit(20)

        if (feedErr) throw feedErr
        setFeed(feedData || [])

      } catch (err) {
        console.error('EDGEai load error:', err)
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    loadAll()

    // Realtime — new responses push to top of feed
    const channel = supabase
      .channel('responses_live')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'responses',
        filter: `carrier_id=eq.${CARRIER_UUID}`,
      }, (payload) => {
        setFeed(prev => [payload.new, ...prev].slice(0, 20))
        setMetrics(prev => ({
          ...prev,
          responses: (prev.responses || 0) + 1,
          loadOffers: payload.new.classification === 'load_offer'
            ? (prev.loadOffers || 0) + 1
            : prev.loadOffers,
        }))
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400 text-sm animate-pulse">Loading ACE data...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 text-sm max-w-lg">
        <strong>Connection error:</strong> {error}
      </div>
    )
  }

  const aceStatus = carrier?.ace_status || 'inactive'

  return (
    <div className="space-y-6 max-w-4xl">

      {/* Identity block */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-[#0C447C] flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-lg">
              {(carrier?.company_name || 'X').charAt(0)}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-lg font-bold text-slate-900">{carrier?.company_name || 'XTX Transport LLC'}</h1>
              <span className="text-xs font-semibold bg-[#0C447C]/10 text-[#0C447C] px-2 py-0.5 rounded-full capitalize">
                {carrier?.subscription_tier || 'Base'}
              </span>
            </div>
            <p className="text-sm text-slate-500 mb-2">{carrier?.owner_name || 'Ken Korbel'}</p>
            <div className="flex flex-wrap items-center gap-3">
              {carrier?.mc_number && (
                <>
                  <span className="text-xs text-slate-500">MC# <span className="font-semibold text-slate-700">{carrier.mc_number}</span></span>
                  <span className="text-slate-300">|</span>
                </>
              )}
              {carrier?.dot_number && (
                <>
                  <span className="text-xs text-slate-500">DOT# <span className="font-semibold text-slate-700">{carrier.dot_number}</span></span>
                  <span className="text-slate-300">|</span>
                </>
              )}
              <AceBadge status={aceStatus} />
            </div>
          </div>
        </div>
      </div>

      {/* Metrics */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Today's Activity</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label="Emails Sent"  value={metrics.sentToday}  color="text-[#0C447C]" />
          <MetricCard label="Responses"    value={metrics.responses}  color="text-[#185FA5]" />
          <MetricCard label="Load Offers"  value={metrics.loadOffers} color="text-emerald-600" />
          <MetricCard label="Wins"         value={metrics.wins}       color="text-emerald-700" />
        </div>
      </div>

      {/* Live broker feed */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400">Live Broker Feed</h2>
          <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
          {feed.length === 0 ? (
            <div className="px-4 py-8 text-center text-slate-400 text-sm">
              No broker activity yet today
            </div>
          ) : (
            feed.map(item => {
              const style = classificationStyles[item.classification] || classificationStyles.neutral
              const brokerLabel = item.broker_name || item.broker_company || item.broker_email || 'Unknown Broker'
              const detail = item.load_origin && item.load_destination
                ? `${item.load_origin} → ${item.load_destination}${item.load_distance ? ` — ${item.load_distance} mi` : ''}`
                : item.subject || ''
              return (
                <div key={item.id} className="flex items-start gap-3 px-4 py-3.5 hover:bg-slate-50 transition-colors">
                  <div className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${style.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-semibold text-slate-800 truncate">{brokerLabel}</span>
                      <span className={`flex-shrink-0 text-xs font-semibold px-1.5 py-0.5 rounded-full ${style.badge}`}>
                        {style.label}
                      </span>
                    </div>
                    <p className="text-sm text-slate-500 truncate">{detail}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{item.broker_email}</p>
                  </div>
                  <span className="text-xs text-slate-400 flex-shrink-0 pt-0.5">{timeAgo(item.created_at)}</span>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
