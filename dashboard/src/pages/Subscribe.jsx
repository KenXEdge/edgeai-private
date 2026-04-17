import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

const CLOUD_RUN_URL = 'https://edgeai-gmail-webhook-417422203146.us-central1.run.app'

const TIERS = [
  {
    id: 'base',
    name: 'ACE Base',
    price: '$47',
    period: '/month',
    description: 'Perfect for owner-operators getting started with automated broker outreach.',
    features: [
      'Broker outreach automation — daily 7am',
      'Broker reply detection',
      'Load board email parsing',
      'SMS load alerts',
      'New broker contact inbox',
      'Noise filtering',
      'ACE One machine learning',
    ],
    cta: 'Get Started',
    highlight: false,
  },
  {
    id: 'custom',
    name: 'ACE Custom',
    price: '$97',
    period: '/month',
    description: 'For carriers ready to unlock real-time load boards and auto-bidding.',
    features: [
      'Everything in ACE Base',
      'Real-time load board API — DAT, Truckstop, Highway',
      'Auto-bid engine',
      'Lane intelligence',
      'Rate optimization',
      'ACE Two machine learning',
      'Up to 5 trucks',
      '1 dispatcher access',
    ],
    cta: 'Upgrade to Custom',
    highlight: true,
  },
  {
    id: 'premium',
    name: 'ACE Premium Setup',
    price: '$349',
    period: 'one-time',
    description: 'Edge Tech Team personally onboards your account. 90-min setup + 30-min training.',
    features: [
      'Live setup call — screen share',
      'Custom broker list build',
      'Load board configuration',
      'Equipment and lane profile setup',
      'Rate floor strategy consultation',
      '7-day check-in call',
      'Then choose Base or Custom tier',
    ],
    cta: 'Book Setup',
    highlight: false,
  },
]

export default function Subscribe() {
  const [loading, setLoading] = useState(null)
  const [error, setError] = useState(null)
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const cancelled = searchParams.get('cancelled')

  useEffect(() => {
    // Check if already subscribed
    async function checkSubscription() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/login'); return }

      const { data } = await supabase
        .from('carriers')
        .select('subscription_status')
        .eq('id', session.user.id)
        .limit(1)

      if (data?.[0]?.subscription_status === 'active') {
        navigate('/carrier')
      }
    }
    checkSubscription()
  }, [])

  async function handleSelect(tierId) {
    setError(null)
    setLoading(tierId)

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { navigate('/login'); return }

    try {
      const res = await fetch(`${CLOUD_RUN_URL}/create-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tier: tierId,
          carrier_id: session.user.id,
          email: session.user.email,
        }),
      })

      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        setError(data.error || 'Something went wrong. Please try again.')
        setLoading(null)
      }
    } catch (err) {
      setError('Connection error. Please try again.')
      setLoading(null)
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-12">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#0C447C] mb-4">
            <span className="text-white text-2xl font-bold">E</span>
          </div>
          <h1 className="text-3xl font-bold text-[#0C447C] mb-2">Choose your ACE plan</h1>
          <p className="text-slate-500">Start automating your broker outreach today. Cancel anytime.</p>
        </div>

        {cancelled && (
          <div className="mb-6 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm text-center max-w-lg mx-auto">
            Payment was cancelled — no charge was made. Select a plan to continue.
          </div>
        )}

        {error && (
          <div className="mb-6 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm text-center max-w-lg mx-auto">
            {error}
          </div>
        )}

        {/* Pricing cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {TIERS.map(tier => (
            <div
              key={tier.id}
              className={`bg-white rounded-2xl border p-6 flex flex-col ${
                tier.highlight
                  ? 'border-[#185FA5] ring-2 ring-[#185FA5]/20'
                  : 'border-slate-200'
              }`}
            >
              {tier.highlight && (
                <div className="mb-4">
                  <span className="text-xs font-semibold bg-[#185FA5] text-white px-3 py-1 rounded-full">
                    Most Popular
                  </span>
                </div>
              )}

              <h2 className="text-lg font-bold text-slate-900 mb-1">{tier.name}</h2>
              <div className="flex items-baseline gap-1 mb-3">
                <span className="text-3xl font-bold text-[#0C447C]">{tier.price}</span>
                <span className="text-slate-400 text-sm">{tier.period}</span>
              </div>
              <p className="text-sm text-slate-500 mb-6">{tier.description}</p>

              <ul className="space-y-2 mb-8 flex-1">
                {tier.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                    <span className="text-emerald-500 mt-0.5 flex-shrink-0">✓</span>
                    {f}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => handleSelect(tier.id)}
                disabled={loading !== null}
                className={`w-full py-2.5 px-4 rounded-lg text-sm font-semibold transition-colors duration-150 disabled:opacity-50 ${
                  tier.highlight
                    ? 'bg-[#185FA5] hover:bg-[#0C447C] text-white'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
                }`}
              >
                {loading === tier.id ? 'Loading...' : tier.cta}
              </button>
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-slate-400 mt-8">
          Secure payments powered by Stripe. Cancel anytime. No hidden fees.
        </p>
      </div>
    </div>
  )
}
