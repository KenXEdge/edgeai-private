import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

export default function Login() {
  const [mode, setMode] = useState('signin')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [forgotSent, setForgotSent] = useState(false)
  const navigate = useNavigate()

  function switchMode(newMode) {
    setError(null)
    setForgotSent(false)
    setPassword('')
    setConfirm('')
    setMode(newMode)
  }

  async function handleSignIn(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) setError(error.message)
    else navigate('/carrier')
  }

  async function handleSignUp(e) {
    e.preventDefault()
    setError(null)
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true)

    const fullName = `${firstName} ${lastName}`.trim()

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } }
    })

    if (error) { setError(error.message); setLoading(false); return }

    if (data.user) {
      await supabase.from('carriers').insert({
        id: data.user.id,
        name: fullName,
        email,
        subscription_status: 'trial',
        subscription_tier: 'base',
        ace_status: 'inactive',
        onboarding_complete: false,
      })
    }

    setLoading(false)
    navigate('/subscribe')
  }

  async function handleForgot(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://edgeai-dashboard.vercel.app/reset-password'
    })
    setLoading(false)
    if (error) setError(error.message)
    else setForgotSent(true)
  }

  async function handleGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: 'https://edgeai-dashboard.vercel.app/carrier' }
    })
    if (error) setError(error.message)
  }

  const titles = {
    signin: 'Sign in to your account',
    signup: 'Create your account',
    forgot: 'Reset your password',
  }

  const inputClass = "w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#185FA5] focus:border-transparent"
  const labelClass = "block text-sm font-medium text-slate-700 mb-1"

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">

        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#0C447C] mb-4">
            <span className="text-white text-2xl font-bold">E</span>
          </div>
          <h1 className="text-2xl font-bold text-[#0C447C]">EDGEai</h1>
          <p className="text-slate-500 text-sm mt-1">Carrier Engagement Platform</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
          <h2 className="text-lg font-semibold text-slate-800 mb-6">{titles[mode]}</h2>

          {error && (
            <div className="mb-4 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
          )}

          {/* ── Sign In ── */}
          {mode === 'signin' && (
            <>
              <form onSubmit={handleSignIn} className="space-y-4">
                <div>
                  <label className={labelClass}>Email</label>
                  <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Password</label>
                  <input type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" className={inputClass} />
                </div>
                <button type="submit" disabled={loading}
                  className="w-full py-2.5 px-4 bg-[#185FA5] hover:bg-[#0C447C] text-white text-sm font-semibold rounded-lg transition-colors duration-150 disabled:opacity-50">
                  {loading ? 'Signing in...' : 'Sign In'}
                </button>
              </form>

              <div className="flex justify-between mt-4">
                <button onClick={() => switchMode('forgot')} className="text-sm text-slate-400 hover:text-slate-600">
                  Forgot password?
                </button>
                <button onClick={() => switchMode('signup')} className="text-sm text-[#185FA5] hover:text-[#0C447C] font-medium">
                  New? Register <span className="font-bold underline">HERE</span>
                </button>
              </div>

              <div className="relative my-5">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div>
                <div className="relative flex justify-center text-xs text-slate-400 bg-white px-2">or continue with</div>
              </div>

              <button onClick={handleGoogle}
                className="w-full flex items-center justify-center gap-3 py-2.5 px-4 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors duration-150">
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue with Google
              </button>
            </>
          )}

          {/* ── Create Account ── */}
          {mode === 'signup' && (
            <>
              <form onSubmit={handleSignUp} className="space-y-4">
                <div>
                  <label className={labelClass}>First name</label>
                  <input type="text" required value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Ken" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Last name</label>
                  <input type="text" required value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Korbel" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Email</label>
                  <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Password</label>
                  <input type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Min 8 characters" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Confirm password</label>
                  <input type="password" required value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Repeat password" className={inputClass} />
                </div>
                <button type="submit" disabled={loading}
                  className="w-full py-2.5 px-4 bg-[#185FA5] hover:bg-[#0C447C] text-white text-sm font-semibold rounded-lg transition-colors duration-150 disabled:opacity-50">
                  {loading ? 'Creating account...' : 'Create Account'}
                </button>
              </form>
              <div className="mt-4 text-center">
                <button onClick={() => switchMode('signin')} className="text-sm text-slate-400 hover:text-slate-600">
                  Already have an account? Sign in
                </button>
              </div>
            </>
          )}

          {/* ── Forgot Password ── */}
          {mode === 'forgot' && (
            <>
              {forgotSent ? (
                <div className="text-center text-emerald-600 text-sm font-medium py-4">
                  Reset link sent — check your email.
                </div>
              ) : (
                <>
                  <p className="text-sm text-slate-500 mb-4">Enter your email and we'll send a reset link.</p>
                  <form onSubmit={handleForgot} className="space-y-4">
                    <div>
                      <label className={labelClass}>Email</label>
                      <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" className={inputClass} />
                    </div>
                    <button type="submit" disabled={loading}
                      className="w-full py-2.5 px-4 bg-[#185FA5] hover:bg-[#0C447C] text-white text-sm font-semibold rounded-lg transition-colors duration-150 disabled:opacity-50">
                      {loading ? 'Sending...' : 'Send Reset Link'}
                    </button>
                  </form>
                </>
              )}
              <div className="mt-4 text-center">
                <button onClick={() => switchMode('signin')} className="text-sm text-slate-400 hover:text-slate-600">
                  Back to sign in
                </button>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          &copy; {new Date().getFullYear()} EDGEai — All rights reserved
        </p>
      </div>
    </div>
  )
}
