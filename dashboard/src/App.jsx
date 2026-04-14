import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import CarrierHome from './pages/carrier/Home'
import Layout from './components/Layout'

// Mock auth state — replace with real Supabase session check
const mockUser = {
  role: 'carrier', // 'carrier' | 'dispatcher' | null
}

function RequireAuth({ children, role }) {
  if (!mockUser.role) return <Navigate to="/login" replace />
  if (role && mockUser.role !== role) return <Navigate to={`/${mockUser.role}`} replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* Carrier routes */}
        <Route
          path="/carrier"
          element={
            <RequireAuth role="carrier">
              <Layout role="carrier" />
            </RequireAuth>
          }
        >
          <Route index element={<CarrierHome />} />
        </Route>

        {/* Default redirect */}
        <Route
          path="/"
          element={
            mockUser.role
              ? <Navigate to={`/${mockUser.role}`} replace />
              : <Navigate to="/login" replace />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
