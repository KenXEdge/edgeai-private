import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import Subscribe from './pages/Subscribe'
import CarrierHome from './pages/carrier/Home'
import Layout from './components/Layout'


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

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth" element={<Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/subscribe" element={<Subscribe />} />

<Route path="/" element={<MarketingPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
