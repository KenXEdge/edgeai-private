import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { createClient } from '@supabase/supabase-js'
import Login from './pages/Login'
import CarrierHome from './pages/carrier/Home'
import Layout from './components/Layout'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

function RequireAuth({ children }) {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setSession(session))
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="text-slate-400 text-sm animate-pulse">Loading...</div>
    </div>
  )

  if (!session) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route
          path="/carrier"
          element={
            <RequireAuth>
              <Layout role="carrier" />
            </RequireAuth>
          }
        >
          <Route index element={<CarrierHome />} />
        </Route>

        <Route path="/" element={<Navigate to="/carrier" replace />} />
        <Route path="*" element={<Navigate to="/carrier" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
