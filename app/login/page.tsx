'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Zap, Eye, EyeOff, Loader2, Shield, Lock, User } from 'lucide-react'

export default function LoginPage() {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('myspeed2024')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const passRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const login = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username || !password) return
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (res.ok) {
        router.push('/dashboard')
      } else {
        const d = await res.json()
        setError(d.error || 'Erro ao fazer login')
      }
    } catch {
      setError('Falha na conexão')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#050a1a] flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background grid */}
      <div className="absolute inset-0 grid-bg opacity-40 pointer-events-none" />

      {/* Glow orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(0,212,255,0.06) 0%, transparent 70%)' }} />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(123,47,255,0.06) 0%, transparent 70%)' }} />

      <div className="w-full max-w-sm relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-400 to-purple-600 shadow-2xl mb-4"
            style={{ boxShadow: '0 0 40px rgba(0,212,255,0.3)' }}>
            <Zap className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">MySpeed</h1>
          <p className="text-sm text-gray-500 mt-1">Network Analyzer</p>
        </div>

        {/* Card */}
        <div className="card p-8" style={{ boxShadow: '0 0 60px rgba(0,0,0,0.5)' }}>
          <div className="flex items-center gap-2 mb-6">
            <Shield className="w-4 h-4 text-cyan-400" />
            <span className="text-sm text-gray-400">Acesso Seguro</span>
          </div>

          <form onSubmit={login} className="space-y-4">
            {/* Username */}
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wider mb-1.5 block">Usuário</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && passRef.current?.focus()}
                  placeholder="admin"
                  autoComplete="username"
                  className="w-full bg-[#0a1128] border border-[#1a2744] text-gray-200 rounded-xl pl-10 pr-4 py-3 text-sm outline-none transition-all focus:border-cyan-500/50 focus:shadow-[0_0_0_3px_rgba(0,212,255,0.08)] placeholder-gray-700"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wider mb-1.5 block">Senha</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
                <input
                  ref={passRef}
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full bg-[#0a1128] border border-[#1a2744] text-gray-200 rounded-xl pl-10 pr-12 py-3 text-sm outline-none transition-all focus:border-cyan-500/50 focus:shadow-[0_0_0_3px_rgba(0,212,255,0.08)] placeholder-gray-700"
                />
                <button type="button" onClick={() => setShowPass(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400 transition-colors">
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2.5 text-sm text-red-400">
                {error}
              </div>
            )}

            {/* Submit */}
            <button type="submit" disabled={loading || !username || !password}
              className="w-full py-3 rounded-xl font-bold text-sm transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              style={{
                background: 'linear-gradient(135deg, #00d4ff, #7b2fff)',
                boxShadow: loading ? 'none' : '0 0 30px rgba(0,212,255,0.3)',
                color: '#fff',
              }}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-700 mt-6">MySpeed v2.0.0 · Network Analyzer</p>
      </div>
    </div>
  )
}
