'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Zap, Download, Upload, Activity, Shield, Wifi, Monitor, ChevronRight, Volume2, VolumeX } from 'lucide-react'
import Link from 'next/link'

// ── Speedometer SVG ────────────────────────────────────────────────────────────
const CX = 200; const CY = 200; const R_OUTER = 170; const R_INNER = 125
const START_ANGLE = -220; const END_ANGLE = 40; const SWEEP = END_ANGLE - START_ANGLE

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg - 90) * Math.PI / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function arc(cx: number, cy: number, r: number, a1: number, a2: number) {
  const s = polar(cx, cy, r, a1); const e = polar(cx, cy, r, a2)
  const large = a2 - a1 > 180 ? 1 : 0
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`
}

function valueToAngle(v: number, max: number) {
  return START_ANGLE + (Math.min(v, max) / max) * SWEEP
}

function Speedometer({ value, max, unit, phase }: { value: number; max: number; unit: string; phase: string }) {
  const angle = valueToAngle(value, max)
  const fillAngle = Math.min(angle, END_ANGLE)

  const ticks = Array.from({ length: 13 }, (_, i) => {
    const a = START_ANGLE + (i / 12) * SWEEP
    const outer = polar(CX, CY, R_OUTER - 2, a)
    const inner = polar(CX, CY, R_OUTER - (i % 3 === 0 ? 18 : 10), a)
    const label = polar(CX, CY, R_OUTER - 32, a)
    return { outer, inner, label, major: i % 3 === 0, value: Math.round((i / 12) * max) }
  })

  const needleTip = polar(CX, CY, R_INNER - 5, angle)
  const needleBase1 = polar(CX, CY, 12, angle + 90)
  const needleBase2 = polar(CX, CY, 12, angle - 90)

  const pct = Math.min(value / max, 1)
  const color = pct < 0.4 ? '#00d4ff' : pct < 0.7 ? '#00ff88' : pct < 0.9 ? '#ffd700' : '#ff4d4d'

  return (
    <svg viewBox="0 0 400 320" className="w-full max-w-sm mx-auto select-none">
      <defs>
        <radialGradient id="bgGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0d1a35" />
          <stop offset="100%" stopColor="#050a1a" />
        </radialGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="strongGlow">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Background disc */}
      <circle cx={CX} cy={CY} r={R_OUTER + 15} fill="url(#bgGrad)" stroke="#1a2744" strokeWidth="1" />

      {/* Track */}
      <path d={arc(CX, CY, R_INNER + 22, START_ANGLE, END_ANGLE)} fill="none" stroke="#1a2744" strokeWidth="18" strokeLinecap="round" />

      {/* Fill arc */}
      {value > 0 && (
        <path d={arc(CX, CY, R_INNER + 22, START_ANGLE, fillAngle)} fill="none"
          stroke={color} strokeWidth="18" strokeLinecap="round" filter="url(#glow)"
          style={{ transition: 'stroke 0.3s' }} />
      )}

      {/* Ticks */}
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={t.outer.x} y1={t.outer.y} x2={t.inner.x} y2={t.inner.y}
            stroke={t.major ? '#4a5568' : '#2a3760'} strokeWidth={t.major ? 2 : 1} />
          {t.major && (
            <text x={t.label.x} y={t.label.y} textAnchor="middle" dominantBaseline="middle"
              fill="#4a5568" fontSize="10" fontFamily="monospace">
              {t.value}
            </text>
          )}
        </g>
      ))}

      {/* Needle */}
      <polygon
        points={`${needleTip.x},${needleTip.y} ${needleBase1.x},${needleBase1.y} ${needleBase2.x},${needleBase2.y}`}
        fill={color} filter="url(#strongGlow)" style={{ transition: 'fill 0.3s' }}
      />
      <circle cx={CX} cy={CY} r={10} fill="#0d1a35" stroke={color} strokeWidth="2" filter="url(#glow)" />

      {/* Value display */}
      <text x={CX} y={CY + 50} textAnchor="middle" fill="white" fontSize="42" fontWeight="900"
        fontFamily="'JetBrains Mono', monospace" filter="url(#glow)" style={{ fill: color }}>
        {value < 1000 ? Math.round(value) : (value / 1000).toFixed(1) + 'G'}
      </text>
      <text x={CX} y={CY + 72} textAnchor="middle" fill="#4a5568" fontSize="13" fontFamily="monospace">
        {unit}
      </text>

      {/* Phase label */}
      <text x={CX} y={CY - 30} textAnchor="middle" fill="#4a5568" fontSize="11" fontFamily="monospace" letterSpacing="3">
        {phase.toUpperCase()}
      </text>
    </svg>
  )
}

// ── Nitro sound ────────────────────────────────────────────────────────────────
function playNitro() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()

    // Engine rumble - sawtooth rev-up
    const engine = ctx.createOscillator()
    engine.type = 'sawtooth'
    engine.frequency.setValueAtTime(55, ctx.currentTime)
    engine.frequency.exponentialRampToValueAtTime(280, ctx.currentTime + 1.4)
    const engineGain = ctx.createGain()
    engineGain.gain.setValueAtTime(0.18, ctx.currentTime)
    engineGain.gain.setValueAtTime(0.18, ctx.currentTime + 1.2)
    engineGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.2)

    // Turbo whistle
    const turbo = ctx.createOscillator()
    turbo.type = 'sine'
    turbo.frequency.setValueAtTime(500, ctx.currentTime + 0.3)
    turbo.frequency.exponentialRampToValueAtTime(4500, ctx.currentTime + 1.6)
    const turboGain = ctx.createGain()
    turboGain.gain.setValueAtTime(0.001, ctx.currentTime)
    turboGain.gain.linearRampToValueAtTime(0.14, ctx.currentTime + 0.9)
    turboGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.2)

    // White noise whoosh
    const bufSize = Math.floor(ctx.sampleRate * 2.5)
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate)
    const dat = buf.getChannelData(0)
    for (let i = 0; i < bufSize; i++) dat[i] = Math.random() * 2 - 1
    const noise = ctx.createBufferSource()
    noise.buffer = buf
    const noiseFilter = ctx.createBiquadFilter()
    noiseFilter.type = 'bandpass'
    noiseFilter.frequency.setValueAtTime(600, ctx.currentTime)
    noiseFilter.frequency.exponentialRampToValueAtTime(7000, ctx.currentTime + 1.6)
    noiseFilter.Q.value = 1.2
    const noiseGain = ctx.createGain()
    noiseGain.gain.setValueAtTime(0.001, ctx.currentTime)
    noiseGain.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 0.5)
    noiseGain.gain.setValueAtTime(0.22, ctx.currentTime + 1.0)
    noiseGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.2)

    // Bass thump on start
    const bass = ctx.createOscillator()
    bass.type = 'sine'
    bass.frequency.setValueAtTime(80, ctx.currentTime)
    bass.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.3)
    const bassGain = ctx.createGain()
    bassGain.gain.setValueAtTime(0.4, ctx.currentTime)
    bassGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)

    engine.connect(engineGain).connect(ctx.destination)
    turbo.connect(turboGain).connect(ctx.destination)
    noise.connect(noiseFilter).connect(noiseGain).connect(ctx.destination)
    bass.connect(bassGain).connect(ctx.destination)

    bass.start(); bass.stop(ctx.currentTime + 0.4)
    engine.start(); engine.stop(ctx.currentTime + 2.2)
    turbo.start(ctx.currentTime + 0.2); turbo.stop(ctx.currentTime + 2.2)
    noise.start(); noise.stop(ctx.currentTime + 2.5)
  } catch (e) { console.warn('Audio unavailable:', e) }
}

// ── Particles ──────────────────────────────────────────────────────────────────
interface Particle { id: number; x: number; y: number; vx: number; vy: number; life: number; color: string; size: number }

// ── Main Landing Page ──────────────────────────────────────────────────────────
type AnimPhase = 'idle' | 'download' | 'hold-dl' | 'upload' | 'hold-ul' | 'ping' | 'done' | 'reset'

const DL_MAX = 1000; const UL_MAX = 500

export default function LandingPage() {
  const [phase, setPhase] = useState<AnimPhase>('idle')
  const [dlValue, setDlValue] = useState(0)
  const [ulValue, setUlValue] = useState(0)
  const [pingValue, setPingValue] = useState(0)
  const [activeMetric, setActiveMetric] = useState<'dl' | 'ul' | 'ping'>('dl')
  const [soundOn, setSoundOn] = useState(true)
  const [particles, setParticles] = useState<Particle[]>([])
  const [started, setStarted] = useState(false)
  const rafRef = useRef<number>(0)
  const phaseRef = useRef<AnimPhase>('idle')
  const particleId = useRef(0)

  const spawnParticles = useCallback((color: string) => {
    const newParticles: Particle[] = Array.from({ length: 12 }, () => ({
      id: particleId.current++,
      x: 50 + Math.random() * 0,
      y: 40 + Math.random() * 20,
      vx: (Math.random() - 0.5) * 4,
      vy: -Math.random() * 3 - 1,
      life: 1,
      color,
      size: Math.random() * 3 + 1,
    }))
    setParticles(p => [...p.slice(-30), ...newParticles])
  }, [])

  const runAnimation = useCallback(() => {
    if (phaseRef.current !== 'idle') return
    setStarted(true)

    const animate = (
      setter: (v: number) => void,
      target: number,
      duration: number,
      easing: (t: number) => number,
      onDone: () => void,
      color: string
    ) => {
      const start = performance.now()
      let prev = 0
      const step = (now: number) => {
        const t = Math.min((now - start) / duration, 1)
        const v = target * easing(t)
        setter(v)
        if (Math.floor(v / (target / 8)) > Math.floor(prev / (target / 8))) spawnParticles(color)
        prev = v
        if (t < 1) { rafRef.current = requestAnimationFrame(step) }
        else { setter(target); onDone() }
      }
      rafRef.current = requestAnimationFrame(step)
    }

    // DOWNLOAD
    phaseRef.current = 'download'
    setPhase('download')
    setActiveMetric('dl')
    if (soundOn) playNitro()

    animate(setDlValue, DL_MAX * (0.7 + Math.random() * 0.28), 3000,
      t => t < 0.8 ? Math.pow(t / 0.8, 0.5) : 1 - 0.05 * Math.sin((t - 0.8) * Math.PI * 5),
      () => {
        phaseRef.current = 'hold-dl'
        setPhase('hold-dl')
        setTimeout(() => {
          // UPLOAD
          phaseRef.current = 'upload'
          setPhase('upload')
          setActiveMetric('ul')
          animate(setUlValue, UL_MAX * (0.6 + Math.random() * 0.35), 2500,
            t => t < 0.8 ? Math.pow(t / 0.8, 0.55) : 1 - 0.04 * Math.sin((t - 0.8) * Math.PI * 4),
            () => {
              phaseRef.current = 'hold-ul'
              setPhase('hold-ul')
              setTimeout(() => {
                // PING
                phaseRef.current = 'ping'
                setPhase('ping')
                setActiveMetric('ping')
                animate(setPingValue, 8 + Math.floor(Math.random() * 20), 1200,
                  t => t,
                  () => {
                    phaseRef.current = 'done'
                    setPhase('done')
                    spawnParticles('#00ff88')
                    setTimeout(() => {
                      phaseRef.current = 'reset'
                      setPhase('reset')
                      setTimeout(() => {
                        setDlValue(0); setUlValue(0); setPingValue(0)
                        phaseRef.current = 'idle'; setPhase('idle')
                        setStarted(false)
                      }, 1500)
                    }, 3000)
                  }, '#ffd700')
              }, 600)
            }, '#00ff88')
        }, 800)
      }, '#00d4ff')
  }, [soundOn, spawnParticles])

  // Auto-start after mount
  useEffect(() => {
    const t = setTimeout(runAnimation, 1200)
    return () => { clearTimeout(t); cancelAnimationFrame(rafRef.current) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-run loop
  useEffect(() => {
    if (phase === 'idle' && !started) {
      const t = setTimeout(runAnimation, 2000)
      return () => clearTimeout(t)
    }
  }, [phase, started, runAnimation])

  // Particle animation
  useEffect(() => {
    let raf: number
    const step = () => {
      setParticles(prev => prev.map(p => ({ ...p, x: p.x + p.vx, y: p.y + p.vy, vy: p.vy + 0.08, life: p.life - 0.025 })).filter(p => p.life > 0))
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [])

  const gaugeValue = activeMetric === 'dl' ? dlValue : activeMetric === 'ul' ? ulValue : pingValue * 20
  const gaugeMax = activeMetric === 'ping' ? 500 : activeMetric === 'dl' ? DL_MAX : UL_MAX
  const gaugeUnit = activeMetric === 'ping' ? 'ms ping' : 'Mbps'
  const gaugePhase = activeMetric === 'dl' ? 'Download' : activeMetric === 'ul' ? 'Upload' : 'Ping'
  const displayValue = activeMetric === 'ping' ? pingValue : gaugeValue

  const features = [
    { icon: Download, color: '#00d4ff', label: 'Velocimetro', desc: 'Download, upload e ping com servidores próximos ao seu ISP' },
    { icon: Shield, color: '#7b2fff', label: 'Centro de Segurança', desc: 'SSL/TLS Inspector, DMARC/SPF/DKIM, Reputação de IP, NetGuard AI' },
    { icon: Monitor, color: '#00ff88', label: 'Scan de Rede', desc: 'Dispositivos online, portas abertas, CVEs e análise de vulnerabilidades' },
    { icon: Wifi, color: '#ffd700', label: 'Análise WiFi', desc: 'Canais 2.4/5 GHz, interferência, segurança e recomendações de IA' },
    { icon: Activity, color: '#ff8c00', label: 'Análise de Rede', desc: 'Ping contínuo, Traceroute, DNS lookup e jitter em tempo real' },
    { icon: Zap, color: '#ff4d4d', label: 'Controladores', desc: 'Integração com UniFi e MikroTik com suporte a 2FA' },
  ]

  return (
    <div className="min-h-screen bg-[#050a1a] text-white overflow-x-hidden">
      {/* Background */}
      <div className="fixed inset-0 grid-bg opacity-30 pointer-events-none" />
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full"
          style={{ background: 'radial-gradient(ellipse, rgba(0,212,255,0.06) 0%, transparent 70%)' }} />
        <div className="absolute bottom-0 right-0 w-[600px] h-[400px] rounded-full"
          style={{ background: 'radial-gradient(ellipse, rgba(123,47,255,0.05) 0%, transparent 70%)' }} />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 py-5 max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-400 to-purple-600 flex items-center justify-center shadow-lg"
            style={{ boxShadow: '0 0 20px rgba(0,212,255,0.3)' }}>
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="font-black text-lg text-white">MySpeed</span>
            <span className="text-xs text-gray-500 ml-2">Network Analyzer</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setSoundOn(s => !s)} className="p-2 text-gray-500 hover:text-gray-300 transition-colors" title={soundOn ? 'Mudo' : 'Ativar som'}>
            {soundOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          <Link href="/login" className="btn-cyan px-5 py-2 rounded-xl text-sm font-bold flex items-center gap-2">
            Entrar <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 flex flex-col items-center pt-6 pb-16 px-4">
        {/* Tagline */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-cyan-500/10 border border-cyan-500/20 rounded-full px-4 py-1.5 text-xs text-cyan-400 font-semibold mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" /> Análise de Rede Profissional
          </div>
          <h1 className="text-4xl md:text-6xl font-black tracking-tight leading-none mb-4">
            <span className="text-white">Medir.</span>{' '}
            <span style={{ background: 'linear-gradient(135deg, #00d4ff, #7b2fff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Proteger.
            </span>{' '}
            <span className="text-white">Otimizar.</span>
          </h1>
          <p className="text-gray-400 text-lg max-w-xl mx-auto">
            Velocímetro profissional, scanner de segurança e inteligência de rede — tudo em um só lugar.
          </p>
        </div>

        {/* Speedometer + particles */}
        <div className="relative w-80 md:w-96">
          {/* Particles */}
          <div className="absolute inset-0 pointer-events-none overflow-visible">
            {particles.map(p => (
              <div key={p.id} className="absolute rounded-full pointer-events-none"
                style={{
                  left: `${p.x}%`, top: `${p.y}%`,
                  width: p.size, height: p.size,
                  background: p.color,
                  opacity: p.life,
                  boxShadow: `0 0 ${p.size * 2}px ${p.color}`,
                  transform: 'translate(-50%, -50%)',
                }} />
            ))}
          </div>

          {/* Outer glow ring */}
          <div className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background: 'radial-gradient(circle, rgba(0,212,255,0.05) 0%, transparent 70%)',
              animation: phase === 'download' || phase === 'upload' ? 'pulse 0.8s ease-in-out infinite' : 'none',
            }} />

          <Speedometer
            value={displayValue}
            max={gaugeMax}
            unit={gaugeUnit}
            phase={gaugePhase}
          />
        </div>

        {/* Live stats row */}
        <div className="flex items-center gap-6 mt-2 mb-8">
          {[
            { label: 'Download', value: dlValue, icon: Download, unit: 'Mbps', color: '#00d4ff', active: activeMetric === 'dl' },
            { label: 'Upload', value: ulValue, icon: Upload, unit: 'Mbps', color: '#00ff88', active: activeMetric === 'ul' },
            { label: 'Ping', value: pingValue, icon: Activity, unit: 'ms', color: '#ffd700', active: activeMetric === 'ping' },
          ].map(m => (
            <div key={m.label} className={`text-center transition-all duration-300 ${m.active ? 'scale-110' : 'opacity-50 scale-95'}`}>
              <m.icon className="w-4 h-4 mx-auto mb-1" style={{ color: m.color }} />
              <div className="text-xl font-black mono" style={{ color: m.active ? m.color : '#4a5568' }}>
                {m.value < 1 ? '—' : m.value < 1000 ? Math.round(m.value) : (m.value / 1000).toFixed(1) + 'G'}
              </div>
              <div className="text-xs text-gray-600">{m.unit}</div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="flex flex-col sm:flex-row gap-3 items-center">
          <Link href="/login"
            onClick={() => { if (soundOn) playNitro() }}
            className="group relative px-8 py-4 rounded-2xl font-black text-lg text-white overflow-hidden transition-all hover:scale-105"
            style={{ background: 'linear-gradient(135deg, #00d4ff, #7b2fff)', boxShadow: '0 0 40px rgba(0,212,255,0.4)' }}>
            <span className="relative z-10 flex items-center gap-2">
              <Zap className="w-5 h-5" /> Medir Minha Velocidade
            </span>
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: 'linear-gradient(135deg, #7b2fff, #00d4ff)' }} />
          </Link>
          <p className="text-xs text-gray-600">Gratuito · Sem cadastro · Resultados em segundos</p>
        </div>
      </section>

      {/* Features */}
      <section className="relative z-10 max-w-6xl mx-auto px-4 pb-20">
        <div className="text-center mb-10">
          <h2 className="text-2xl md:text-3xl font-black text-white mb-2">Muito além da velocidade</h2>
          <p className="text-gray-500">Ferramentas profissionais para analistas de rede e equipes de TI</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map(f => (
            <div key={f.label} className="card p-5 group hover:scale-[1.02] transition-all cursor-pointer"
              style={{ borderColor: 'transparent' }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = `${f.color}30`)}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'transparent')}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                style={{ background: `${f.color}15`, border: `1px solid ${f.color}30` }}>
                <f.icon className="w-5 h-5" style={{ color: f.color }} />
              </div>
              <h3 className="text-sm font-bold text-white mb-1 group-hover:text-[#00d4ff] transition-colors">{f.label}</h3>
              <p className="text-xs text-gray-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-[#1a2744] py-6 px-4 text-center">
        <div className="flex items-center justify-center gap-2 mb-1">
          <Zap className="w-4 h-4 text-cyan-400" />
          <span className="font-bold text-white text-sm">MySpeed</span>
          <span className="text-gray-600 text-xs">v2.0.0</span>
        </div>
        <p className="text-xs text-gray-700">Network Analyzer · Análise de Rede Profissional</p>
      </footer>
    </div>
  )
}
