// Mock data — replace with Supabase queries
const mockCarrier = {
  companyName: 'XTX Transport LLC',
  mc: '1234567',
  dot: '9876543',
  ownerName: 'Ken Korbel',
  subscription: 'Pro',
  aceStatus: 'active', // 'active' | 'pending' | 'inactive'
}

const mockMetrics = {
  sentToday: 47,
  responses: 12,
  loadOffers: 5,
  wins: 2,
}

const mockFeed = [
  {
    id: 1,
    broker: 'Echo Global Logistics',
    email: 'dispatch@echo.com',
    subject: 'Load offer: Chicago → Dallas, 42k lbs dry van',
    classification: 'load_offer',
    time: '2 min ago',
  },
  {
    id: 2,
    broker: 'Coyote Logistics',
    email: 'loads@coyote.com',
    subject: 'Re: Rate confirmation — Laredo run',
    classification: 'positive',
    time: '18 min ago',
  },
  {
    id: 3,
    broker: 'TQL',
    email: 'tql-ops@tql.com',
    subject: 'Not interested at this time',
    classification: 'negative',
    time: '41 min ago',
  },
  {
    id: 4,
    broker: 'CH Robinson',
    email: 'ops@chrobinson.com',
    subject: 'Following up on your capacity',
    classification: 'neutral',
    time: '1 hr ago',
  },
  {
    id: 5,
    broker: 'Arrive Logistics',
    email: 'capacity@arrivelogistics.com',
    subject: 'Hot load — Houston TX, need truck now',
    classification: 'load_offer',
    time: '2 hr ago',
  },
]

const classificationStyles = {
  load_offer: {
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-100 text-emerald-700',
    label: 'Load Offer',
  },
  positive: {
    dot: 'bg-blue-400',
    badge: 'bg-blue-100 text-blue-700',
    label: 'Positive',
  },
  negative: {
    dot: 'bg-red-400',
    badge: 'bg-red-100 text-red-600',
    label: 'Negative',
  },
  neutral: {
    dot: 'bg-slate-400',
    badge: 'bg-slate-100 text-slate-600',
    label: 'Neutral',
  },
}

function AceBadge({ status }) {
  const styles = {
    active: 'bg-emerald-100 text-emerald-700',
    pending: 'bg-yellow-100 text-yellow-700',
    inactive: 'bg-slate-100 text-slate-500',
  }
  const labels = { active: 'ACE Active', pending: 'ACE Pending', inactive: 'ACE Inactive' }
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${styles[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === 'active' ? 'bg-emerald-500' : status === 'pending' ? 'bg-yellow-500' : 'bg-slate-400'}`} />
      {labels[status]}
    </span>
  )
}

function MetricCard({ label, value, color }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-4 flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</span>
      <span className={`text-3xl font-bold ${color}`}>{value}</span>
    </div>
  )
}

export default function CarrierHome() {
  return (
    <div className="space-y-6 max-w-4xl">
      {/* Identity block */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex flex-wrap items-start gap-4">
          {/* Avatar */}
          <div className="w-12 h-12 rounded-xl bg-[#0C447C] flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-lg">
              {mockCarrier.companyName.charAt(0)}
            </span>
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-lg font-bold text-slate-900">{mockCarrier.companyName}</h1>
              <span className="text-xs font-semibold bg-[#0C447C]/10 text-[#0C447C] px-2 py-0.5 rounded-full">
                {mockCarrier.subscription}
              </span>
            </div>
            <p className="text-sm text-slate-500 mb-2">{mockCarrier.ownerName}</p>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-slate-500">MC# <span className="font-semibold text-slate-700">{mockCarrier.mc}</span></span>
              <span className="text-slate-300">|</span>
              <span className="text-xs text-slate-500">DOT# <span className="font-semibold text-slate-700">{mockCarrier.dot}</span></span>
              <span className="text-slate-300">|</span>
              <AceBadge status={mockCarrier.aceStatus} />
            </div>
          </div>
        </div>
      </div>

      {/* Metrics row */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Today's Activity</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label="Emails Sent" value={mockMetrics.sentToday} color="text-[#0C447C]" />
          <MetricCard label="Responses" value={mockMetrics.responses} color="text-[#185FA5]" />
          <MetricCard label="Load Offers" value={mockMetrics.loadOffers} color="text-emerald-600" />
          <MetricCard label="Wins" value={mockMetrics.wins} color="text-emerald-700" />
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
          {mockFeed.map(item => {
            const style = classificationStyles[item.classification]
            return (
              <div key={item.id} className="flex items-start gap-3 px-4 py-3.5 hover:bg-slate-50 transition-colors">
                <div className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${style.dot}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-slate-800 truncate">{item.broker}</span>
                    <span className={`flex-shrink-0 text-xs font-semibold px-1.5 py-0.5 rounded-full ${style.badge}`}>
                      {style.label}
                    </span>
                  </div>
                  <p className="text-sm text-slate-500 truncate">{item.subject}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{item.email}</p>
                </div>
                <span className="text-xs text-slate-400 flex-shrink-0 pt-0.5">{item.time}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
