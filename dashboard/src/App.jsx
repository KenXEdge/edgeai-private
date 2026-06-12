import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import Subscribe from './pages/Subscribe'
import CarrierHome from './pages/carrier/Home'
import Layout from './components/Layout'
// ── ACE (added) ──────────────────────────────────────────────────────────────
import AceSettings from './pages/ace/AceSettings'
import AceLoadDashboard from './pages/ace/AceLoadDashboard'


function MarketingPage() {
  useEffect(() => { window.location.replace('/home.html') }, [])
  return null
}

function RequireAuth({ children }) {
  const [session, setSession] = useState(undefined)
  const [subscribed, setSubscribed] = useState(undefined)

  useEffect(() => {
    async function check() {
      const { data: { session } } = await supabase.auth.getSession()
      setSession(session)

      if (session) {
        const { data } = await supabase
          .from('carriers')
          .select('subscription_status')
          .eq('id', session.user.id)
          .limit(1)
        setSubscribed(data?.[0]?.subscription_status === 'active')
      } else {
        setSubscribed(null)
      }
    }
    check()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined || subscribed === undefined) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="text-slate-400 text-sm animate-pulse">Loading...</div>
    </div>
  )

  if (!session) return <Navigate to="/auth" replace />
  if (!subscribed) return <Navigate to="/subscribe" replace />
  return children
}

// ── ACE access gate (added) ───────────────────────────────────────────────────
// Requires a logged-in session + an active ACE Sylectus subscription
// (ace_vm_access.active === true). Does NOT depend on the EDGE subscription —
// ACE is a separate paid entitlement (Decision A).
function RequireAceAccess({ children }) {
  const [state, setState] = useState(undefined) // undefined=loading | 'noauth' | 'noaccess' | 'ok'

  useEffect(() => {
    async function check() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setState('noauth'); return }
      const { data } = await supabase
        .from('ace_vm_access')
        .select('active')
        .eq('carrier_id', session.user.id)
        .limit(1)
      setState(data?.[0]?.active === true ? 'ok' : 'noaccess')
    }
    check()
  }, [])

  if (state === undefined) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="text-slate-400 text-sm animate-pulse">Checking ACE access…</div>
    </div>
  )
  if (state === 'noauth') return <Navigate to="/auth" replace />
  if (state === 'noaccess') return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-6">
      <div className="max-w-md bg-white rounded-xl border border-slate-200 p-6 text-center">
        <h2 className="text-lg font-bold text-slate-800">ACE Sylectus Edition isn’t active</h2>
        <p className="mt-2 text-sm text-slate-600">
          This account doesn’t have an active ACE Sylectus subscription. Activate it to
          configure load search, bid filters, and Sylectus access.
        </p>
        <a href="/subscribe" className="inline-block mt-4 px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ background: '#0C447C' }}>
          View plans
        </a>
      </div>
    </div>
  )
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth" element={<Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/subscribe" element={<Subscribe />} />

        {/* ── ACE (added) — gated; everything above and below is unchanged ── */}
        <Route path="/ace/settings" element={<RequireAceAccess><AceSettings /></RequireAceAccess>} />
        <Route path="/ace/loads" element={<RequireAceAccess><AceLoadDashboard /></RequireAceAccess>} />

        <Route path="/" element={<MarketingPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
