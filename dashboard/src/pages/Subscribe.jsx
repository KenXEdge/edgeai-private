import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)


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
    // Check if already subscribed — create carriers row if new user
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
        return
      }

      if (!data || data.length === 0) {
        const fullName = session.user.user_metadata?.full_name || ''
        await supabase.from('carriers').upsert({
          id: session.user.id,
          name: fullName,
          email: session.user.email,
          subscription_status: 'trial',
          subscription_tier: 'base',
          ace_status: 'inactive',
          onboarding_complete: false,
        }, { onConflict: 'id' })
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
      const res = await fetch('/api/create-checkout-session', {
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
    <div className="min-h-screen px-4 py-12" style={{background:'#2a2a2a'}}>
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="text-center mb-12">
          <img src="/assets/logo-edge-black.png" alt="EDGE" className="h-14 w-auto mx-auto mb-4" />
          <h1 className="text-3xl font-bold mb-2" style={{color:'#ffffff'}}>Choose Your Plan</h1>
          <p style={{color:'rgba(255,255,255,0.65)', fontFamily:"'Orbitron', sans-serif", fontWeight:700}}>Designed By Carriers For Carriers</p>
          <p style={{color:'rgba(255,255,255,0.65)', fontSize:'0.85rem', marginTop:'0.4rem'}}>You're About to Hire Your Most Productive Employee — EVER!</p>
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
              className={`rounded-2xl border p-6 flex flex-col ${
                tier.highlight
                  ? 'border-[#185FA5] ring-2 ring-[#185FA5]/20'
                  : 'border-slate-200'
              }`}
              style={{background:'#f0eeeb'}}
            >
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-lg font-bold text-slate-900">{tier.name}</h2>
                {tier.highlight && (
                  <span className="text-xs font-semibold bg-[#185FA5] text-white px-3 py-1 rounded-full">
                    Most Popular
                  </span>
                )}
              </div>
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
                    : 'bg-[#185FA5] hover:bg-[#0C447C] text-white'
                }`}
              >
                {loading === tier.id ? 'Loading...' : tier.cta}
              </button>
            </div>
          ))}
        </div>

        <p className="text-center text-xs mt-8" style={{color:'rgba(255,255,255,0.4)'}}>
          Secure payments powered by Stripe. Cancel anytime. No hidden fees.
        </p>
      </div>
    </div>
  )
}
