'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { loadSettings } from '@/lib/settings'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart3, Gauge, Activity, Wifi, Server, Zap, Radio, Settings, Menu, X, Monitor, Shield, LogOut, History } from 'lucide-react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'

const nav = [
  { href: '/dashboard', icon: BarChart3, label: 'Dashboard' },
  { href: '/speedtest', icon: Gauge, label: 'Teste de Velocidade' },
  { href: '/network', icon: Activity, label: 'Análise de Rede' },
  { href: '/wifi', icon: Wifi, label: 'Analisador WiFi' },
  { href: '/devices', icon: Monitor, label: 'Dispositivos' },
  { href: '/controllers', icon: Server, label: 'Controladores' },
  { href: '/security', icon: Shield, label: 'Centro de Segurança' },
  { href: '/history', icon: History, label: 'Histórico' },
]

const navBottom = [
  { href: '/settings', icon: Settings, label: 'Configurações' },
]

function NavLinks({ onLinkClick }: { onLinkClick?: () => void }) {
  const pathname = usePathname()

  return (
    <>
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {nav.map(({ href, icon: Icon, label }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              onClick={onLinkClick}
              className={clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                active
                  ? 'bg-cyan-500/10 text-[#00d4ff] border border-cyan-500/20'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
              )}
            >
              <Icon className={clsx('w-4 h-4 shrink-0', active && 'text-[#00d4ff]')} />
              <span className="truncate">{label}</span>
              {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#00d4ff] shrink-0" />}
            </Link>
          )
        })}
      </nav>

      <div className="px-3 pb-1">
        {navBottom.map(({ href, icon: Icon, label }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              onClick={onLinkClick}
              className={clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                active
                  ? 'bg-cyan-500/10 text-[#00d4ff] border border-cyan-500/20'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
              )}
            >
              <Icon className={clsx('w-4 h-4 shrink-0', active && 'text-[#00d4ff]')} />
              <span className="truncate">{label}</span>
              {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#00d4ff] shrink-0" />}
            </Link>
          )
        })}
      </div>
    </>
  )
}

function LogoutButton() {
  const router = useRouter()
  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }
  return (
    <div className="px-3 pb-1">
      <button onClick={logout}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-red-400 hover:bg-red-500/5 transition-all">
        <LogOut className="w-4 h-4 shrink-0" />
        <span className="truncate">Sair</span>
      </button>
    </div>
  )
}

// ECG path: flat → spike → flat (viewBox 0 0 80 36)
const ECG_PATH = 'M0,18 L28,18 L31,18 L34,4 L37,32 L40,10 L43,18 L80,18'

function latencyColor(ms: number | null) {
  if (ms === null) return '#00d4ff'
  if (ms < 60)  return '#00ff88'
  if (ms < 150) return '#ffd700'
  return '#ff4d4d'
}

// Mini ECG waveform (P-QRS-T)
function miniEcgValue(t: number): number {
  if (t < 0.08) return 0
  if (t < 0.22) { const d = (t - 0.15) / 0.07; return 0.18 * Math.exp(-d * d * 3) }
  if (t < 0.28) return 0
  if (t < 0.32) return -0.12 * Math.sin((t - 0.28) / 0.04 * Math.PI)
  if (t < 0.36) return Math.sin((t - 0.32) / 0.04 * Math.PI)
  if (t < 0.40) return -0.22 * Math.sin((t - 0.36) / 0.04 * Math.PI)
  if (t < 0.44) return 0
  if (t < 0.66) { const d = (t - 0.55) / 0.11; return 0.28 * Math.exp(-d * d * 2.5) }
  return 0
}

function mobileBeep(latencyMs: number | null) {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    const ctx    = new AudioCtx()
    const now    = ctx.currentTime
    const devPct = loadSettings().ecgPitchDev
    const devHz  = 1000 * devPct / 100
    const ms     = latencyMs ?? 100
    const freq   = Math.max(1000 - devHz, Math.min(1000 + devHz, (1000 + devHz) - ms * devHz / 100))
    const osc1 = ctx.createOscillator(); const g1 = ctx.createGain()
    osc1.connect(g1); g1.connect(ctx.destination)
    osc1.type = 'sine'
    osc1.frequency.setValueAtTime(freq, now)
    osc1.frequency.linearRampToValueAtTime(freq + 30, now + 0.10)
    g1.gain.setValueAtTime(0, now)
    g1.gain.linearRampToValueAtTime(0.28, now + 0.004)
    g1.gain.exponentialRampToValueAtTime(0.0001, now + 0.11)
    osc1.start(now); osc1.stop(now + 0.12)
    const osc2 = ctx.createOscillator(); const g2 = ctx.createGain()
    osc2.connect(g2); g2.connect(ctx.destination)
    osc2.type = 'sine'; osc2.frequency.value = freq * 2
    g2.gain.setValueAtTime(0, now)
    g2.gain.linearRampToValueAtTime(0.07, now + 0.003)
    g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.06)
    osc2.start(now); osc2.stop(now + 0.07)
    setTimeout(() => ctx.close(), 500)
  } catch (_) {}
}

// Mini monitor no header mobile — max 30% da largura da tela
function MobileEcgBar() {
  const canvasRef     = useRef<HTMLCanvasElement>(null)
  const animRef       = useRef(0)
  const prevYRef      = useRef<number | null>(null)
  const cycleStartRef = useRef(0)
  const cycleMsRef    = useRef(60_000 / 20)
  const audioRef      = useRef(false)
  const lastCycleRef  = useRef(-1)
  const latencyRef    = useRef<number | null>(null)
  const [latency, setLatency] = useState<number | null>(null)

  // Destrava áudio no primeiro toque (qualquer lugar da tela)
  useEffect(() => {
    const unlock = () => { audioRef.current = true }
    window.addEventListener('pointerdown', unlock, { once: true })
    return () => window.removeEventListener('pointerdown', unlock)
  }, [])

  useEffect(() => {
    const probe = async () => {
      try {
        const t0 = performance.now()
        await fetch('https://speed.cloudflare.com/__down?bytes=0&_=' + Date.now(), {
          cache: 'no-store', mode: 'no-cors',
        })
        const ms = Math.round(performance.now() - t0)
        setLatency(ms)
        latencyRef.current = ms
      } catch (_) {}
    }
    let id: ReturnType<typeof setInterval>
    const setup = () => {
      clearInterval(id)
      probe()
      id = setInterval(probe, loadSettings().ecgPingInterval * 1000)
    }
    setup()
    window.addEventListener('myspeed-settings-changed', setup)
    return () => {
      clearInterval(id)
      window.removeEventListener('myspeed-settings-changed', setup)
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const BG  = '#080e20'

    const resize = () => {
      canvas.width  = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
      ctx.fillStyle = BG
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      prevYRef.current = null
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    cycleStartRef.current = performance.now()

    const draw = (now: number) => {
      animRef.current = requestAnimationFrame(draw)

      const elapsed = now - cycleStartRef.current
      const cycleMs = cycleMsRef.current
      const t       = Math.min(elapsed / cycleMs, 1)
      const cycle   = Math.floor(now / cycleMs)

      if (elapsed >= cycleMs) {
        cycleStartRef.current = now
        const next = Math.max(18, Math.min(22, 20 + ((Math.random() * 2 - 1) | 0)))
        cycleMsRef.current = 60_000 / next
      }

      if (canvas.width < 1 || canvas.height < 1) return

      // Beep no pico R — só dispara quando canvas visível (mobile)
      if (cycle !== lastCycleRef.current && t > 0.30 && t < 0.40 && audioRef.current) {
        lastCycleRef.current = cycle
        mobileBeep(latencyRef.current)
      }

      const W   = canvas.width
      const H   = canvas.height
      const MID = H * 0.5
      const AMP = H * 0.42

      const img = ctx.getImageData(1, 0, W - 1, H)
      ctx.putImageData(img, 0, 0)
      ctx.fillStyle = BG
      ctx.fillRect(W - 2, 0, 2, H)

      const y  = MID - miniEcgValue(t) * AMP
      const py = prevYRef.current ?? y

      ctx.beginPath()
      ctx.moveTo(W - 2, py)
      ctx.lineTo(W - 1, y)
      ctx.strokeStyle = '#00ff41'
      ctx.lineWidth   = 1.5
      ctx.shadowBlur  = 5
      ctx.shadowColor = '#00ff41'
      ctx.stroke()
      ctx.shadowBlur  = 0
      prevYRef.current = y
    }

    animRef.current = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(animRef.current); ro.disconnect() }
  }, [])

  const color = latencyColor(latency)

  return (
    <div
      className="ml-auto flex items-center gap-2"
      style={{ maxWidth: '30vw', width: '30vw' }}
    >
      <canvas
        ref={canvasRef}
        style={{ flex: 1, minWidth: 0, height: 28, display: 'block' }}
      />
      <span style={{
        fontFamily: 'monospace', fontSize: 12, fontWeight: 700,
        color, flexShrink: 0, whiteSpace: 'nowrap',
        textShadow: `0 0 8px ${color}88`,
      }}>
        {latency !== null ? `${latency}ms` : '—'}
      </span>
    </div>
  )
}

function SidebarStatus() {
  const [latency, setLatency] = useState<number | null>(null)
  const [beat, setBeat] = useState(0)

  const ping = useCallback(async () => {
    try {
      const t0 = performance.now()
      await fetch('https://speed.cloudflare.com/__down?bytes=0&_=' + Date.now(), {
        cache: 'no-store', mode: 'no-cors',
      })
      const ms = Math.round(performance.now() - t0)
      setLatency(ms)
      setBeat(b => b + 1)
    } catch (_) {}
  }, [])

  useEffect(() => {
    ping()
    const id = setInterval(ping, 10_000)
    return () => { clearInterval(id) }
  }, [ping])

  const color = latencyColor(latency)

  return (
    <div className="px-5 py-4 border-t border-[#1a2744]">
      <div className="flex items-center gap-2 mb-3">
        <Radio className="w-3.5 h-3.5 text-[#00ff88]" />
        <span className="text-[11px] text-gray-500 font-medium">STATUS DO SISTEMA</span>
      </div>

      {/* ECG cardiogram strip */}
      <div className="mb-3 h-9 overflow-hidden">
        <svg
          key={beat}
          viewBox="0 0 80 36"
          preserveAspectRatio="none"
          className="w-full h-full"
        >
          <path
            d={ECG_PATH}
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              filter: `drop-shadow(0 0 3px ${color})`,
              strokeDasharray: 160,
              strokeDashoffset: 160,
              animation: 'ecg-draw 0.9s ease-out forwards',
            }}
          />
        </svg>
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between text-[11px]">
          <span className="text-gray-500">Latência</span>
          <span className="mono font-semibold" style={{ color }}>
            {latency !== null ? `${latency} ms` : '—'}
          </span>
        </div>
        <div className="flex justify-between text-[11px]">
          <span className="text-gray-500">Versão</span>
          <span className="text-gray-400">v2.6.2</span>
        </div>
      </div>
    </div>
  )
}

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-400 to-purple-600 flex items-center justify-center shadow-lg">
        <Zap className="w-5 h-5 text-white" />
      </div>
      <div>
        <h1 className="text-white font-bold text-base leading-none">MySpeed</h1>
        <p className="text-[11px] text-gray-500 mt-0.5">Network Analyzer</p>
      </div>
    </div>
  )
}

export default function Sidebar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  return (
    <>
      {/* ── Desktop Sidebar ── */}
      <aside className="hidden md:flex w-60 shrink-0 bg-[#080e20] border-r border-[#1a2744] flex-col h-screen">
        <div className="px-5 py-5 border-b border-[#1a2744]">
          <Logo />
        </div>
        <NavLinks />
        <LogoutButton />
        <SidebarStatus />
      </aside>

      {/* ── Mobile Top Header ── */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-40 h-14 bg-[#080e20]/95 backdrop-blur-md border-b border-[#1a2744] flex items-center px-4 gap-3">
        <button
          onClick={() => setMobileOpen(true)}
          className="p-2 -ml-1 text-gray-400 hover:text-gray-200 rounded-lg hover:bg-white/5 active:bg-white/10 transition-colors"
          aria-label="Abrir menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-400 to-purple-600 flex items-center justify-center">
            <Zap className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-white font-bold text-sm">MySpeed</span>
        </div>

        {/* Mini ECG monitor — substitui o texto de latência, max 30% da tela */}
        <MobileEcgBar />
      </header>

      {/* ── Mobile Drawer Backdrop ── */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Mobile Slide-in Drawer ── */}
      <aside
        className={clsx(
          'md:hidden fixed top-0 left-0 z-50 w-72 h-screen bg-[#080e20] border-r border-[#1a2744] flex flex-col shadow-2xl transition-transform duration-300',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="px-5 py-5 border-b border-[#1a2744]">
          <div className="flex items-center justify-between">
            <Logo />
            <button
              onClick={() => setMobileOpen(false)}
              className="p-1.5 text-gray-500 hover:text-gray-300 rounded-lg hover:bg-white/5 active:bg-white/10 transition-colors"
              aria-label="Fechar menu"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <NavLinks onLinkClick={() => setMobileOpen(false)} />
        <LogoutButton />
        <SidebarStatus />
      </aside>
    </>
  )
}
