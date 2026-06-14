'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

// Base 72 BPM (mais realista que 60), com jitter ±8 BPM por ciclo
const BASE_BPM  = 72
const SCROLL_PX = 2

// Forma de onda ECG realista: P → QRS → T
function ecgValue(t: number): number {
  if (t < 0.08) return 0
  // Onda P
  if (t < 0.22) { const d = (t - 0.15) / 0.07; return 0.18 * Math.exp(-d * d * 3) }
  if (t < 0.28) return 0
  // Onda Q
  if (t < 0.32) return -0.12 * Math.sin((t - 0.28) / 0.04 * Math.PI)
  // Onda R (pico — BEEP aqui)
  if (t < 0.36) return Math.sin((t - 0.32) / 0.04 * Math.PI)
  // Onda S
  if (t < 0.40) return -0.22 * Math.sin((t - 0.36) / 0.04 * Math.PI)
  if (t < 0.44) return 0
  // Onda T
  if (t < 0.66) { const d = (t - 0.55) / 0.11; return 0.28 * Math.exp(-d * d * 2.5) }
  return 0
}

// Beep realista de monitor de UTI
// - pitch sobe com o BPM (como monitores Philips/GE reais)
// - ataque linear ~4ms + decay exponencial ~100ms
// - 2º harmônico a 20% para dar corpo/brilho
// - leve chirp de +40 Hz ao longo do beep
function playBeep(bpm: number) {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    const ctx  = new AudioCtx()
    const now  = ctx.currentTime
    // BPM 55→85 mapeia para 880→1200 Hz
    const freq = 880 + ((bpm - 55) / 30) * 320

    // Tom fundamental
    const osc1  = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    osc1.type = 'sine'
    osc1.frequency.setValueAtTime(freq, now)
    osc1.frequency.linearRampToValueAtTime(freq + 40, now + 0.10)
    gain1.gain.setValueAtTime(0, now)
    gain1.gain.linearRampToValueAtTime(0.28, now + 0.004)   // ataque rápido
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.11)
    osc1.start(now)
    osc1.stop(now + 0.12)

    // 2º harmônico (freq×2) — 20% do volume, decai mais rápido
    const osc2  = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.type = 'sine'
    osc2.frequency.value = freq * 2
    gain2.gain.setValueAtTime(0, now)
    gain2.gain.linearRampToValueAtTime(0.07, now + 0.003)
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.06)
    osc2.start(now)
    osc2.stop(now + 0.07)

    setTimeout(() => ctx.close(), 500)
  } catch (_) {}
}

export default function EcgMonitor() {
  const canvasRef     = useRef<HTMLCanvasElement>(null)
  const pausedRef     = useRef(false)
  const audioRef      = useRef(false)
  const animRef       = useRef(0)
  const prevYRef      = useRef<number | null>(null)
  const lastCycleRef  = useRef(-1)
  // Ciclo dinâmico com jitter
  const cycleStartRef = useRef(0)   // performance.now() do início do ciclo atual
  const cycleMsRef    = useRef(60_000 / BASE_BPM) // ms do ciclo atual

  const [paused,  setPaused]  = useState(false)
  const [bpm,     setBpm]     = useState(BASE_BPM)
  const [latency, setLatency] = useState<number | null>(null)

  const toggle = useCallback(() => {
    audioRef.current  = true
    pausedRef.current = !pausedRef.current
    setPaused(p => !p)
  }, [])

  useEffect(() => {
    const probe = async () => {
      try {
        const t0 = performance.now()
        await fetch('https://speed.cloudflare.com/__down?bytes=0&_=' + Date.now(), {
          cache: 'no-store', mode: 'no-cors',
        })
        setLatency(Math.round(performance.now() - t0))
      } catch (_) {}
    }
    probe()
    const id = setInterval(probe, 10_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const BG  = '#020a02'

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

    // Inicializa o primeiro ciclo
    cycleStartRef.current = performance.now()
    cycleMsRef.current    = 60_000 / BASE_BPM

    const draw = (now: number) => {
      animRef.current = requestAnimationFrame(draw)
      if (pausedRef.current) return

      const W   = canvas.width
      const H   = canvas.height
      const MID = H * 0.5
      const AMP = H * 0.4

      // Posição dentro do ciclo atual
      const elapsed = now - cycleStartRef.current
      const cycleMs = cycleMsRef.current
      const t       = Math.min(elapsed / cycleMs, 1)
      const cycle   = Math.floor(now / cycleMs)   // só para detect de mudança

      // Avança para próximo ciclo com jitter
      if (elapsed >= cycleMs) {
        cycleStartRef.current = now
        // Jitter: ±8 BPM → ms entre 60_000/80 e 60_000/64
        const newBpm = BASE_BPM + (Math.random() * 16 - 8) | 0
        const clampedBpm = Math.max(55, Math.min(85, newBpm))
        cycleMsRef.current = 60_000 / clampedBpm
        setBpm(clampedBpm)
      }

      // Rola canvas para a esquerda
      const img = ctx.getImageData(SCROLL_PX, 0, W - SCROLL_PX, H)
      ctx.putImageData(img, 0, 0)

      // Limpa faixa direita + baseline faint
      ctx.fillStyle = BG
      ctx.fillRect(W - SCROLL_PX - 1, 0, SCROLL_PX + 2, H)
      ctx.strokeStyle = 'rgba(0,255,65,0.06)'
      ctx.lineWidth   = 1
      ctx.beginPath()
      ctx.moveTo(W - SCROLL_PX, MID)
      ctx.lineTo(W, MID)
      ctx.stroke()

      const val = ecgValue(t)
      const y   = MID - val * AMP

      // Beep no pico R (t 0.30–0.40), uma vez por ciclo
      if (cycle !== lastCycleRef.current && t > 0.30 && t < 0.40 && audioRef.current) {
        lastCycleRef.current = cycle
        playBeep(Math.round(60_000 / cycleMs))
      }

      // Traço ECG com glow
      const prevY = prevYRef.current ?? y
      ctx.beginPath()
      ctx.moveTo(W - SCROLL_PX, prevY)
      ctx.lineTo(W - 1, y)
      ctx.strokeStyle = '#00ff41'
      ctx.lineWidth   = 1.8
      ctx.shadowBlur  = 8
      ctx.shadowColor = '#00ff41'
      ctx.stroke()
      ctx.shadowBlur  = 0
      prevYRef.current = y

      // Cursor na ponta
      ctx.fillStyle   = '#00ff41'
      ctx.shadowBlur  = 12
      ctx.shadowColor = '#00ff41'
      ctx.beginPath()
      ctx.arc(W - 1, y, 2.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowBlur = 0
    }

    animRef.current = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(animRef.current)
      ro.disconnect()
    }
  }, [])

  const latColor = latency === null
    ? '#00d4ff'
    : latency < 60   ? '#00ff88'
    : latency < 150  ? '#ffd700'
    : '#ff4d4d'

  return (
    <div
      className="hidden md:flex items-center gap-4 px-5 shrink-0 cursor-pointer select-none"
      style={{
        height: 60,
        background: 'rgba(2,10,2,0.98)',
        borderBottom: '1px solid rgba(0,255,65,0.2)',
        boxShadow: '0 4px 24px rgba(0,255,65,0.06)',
      }}
      onClick={toggle}
      title={paused ? 'Clique para retomar' : 'Clique para pausar'}
    >
      {/* Status dot */}
      <div className="flex flex-col items-center gap-0.5 shrink-0 w-8">
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: paused ? '#1a2d1a' : '#00ff41',
          boxShadow:  paused ? 'none'    : '0 0 8px #00ff41, 0 0 16px #00ff4166',
          animation:  paused ? 'none'    : 'pulse 1s ease-in-out infinite',
        }} />
        <span style={{
          fontSize: 7, fontWeight: 700, letterSpacing: '0.12em',
          color: paused ? '#1a2d1a' : '#00ff4188',
        }}>
          {paused ? 'PAUSE' : 'LIVE'}
        </span>
      </div>

      {/* Canvas ECG */}
      <canvas
        ref={canvasRef}
        className="flex-1"
        style={{ height: 44, display: 'block' }}
      />

      {/* BPM */}
      <div className="text-center shrink-0">
        <p style={{ fontSize: 9, letterSpacing: '0.15em', color: '#00ff4133', marginBottom: 1 }}>BPM</p>
        <p style={{
          fontSize: 22, fontWeight: 900, fontFamily: 'monospace', lineHeight: 1,
          color: paused ? '#1a2d1a' : '#00ff41',
          textShadow: paused ? 'none' : '0 0 12px #00ff41',
        }}>
          {paused ? '--' : bpm}
        </p>
      </div>

      {/* Latência */}
      {latency !== null && (
        <div className="text-center shrink-0 border-l pl-4" style={{ borderColor: '#00ff4122' }}>
          <p style={{ fontSize: 9, letterSpacing: '0.15em', marginBottom: 1, color: latColor + '55' }}>PING</p>
          <p style={{
            fontSize: 20, fontWeight: 900, fontFamily: 'monospace', lineHeight: 1,
            color: latColor,
            textShadow: `0 0 10px ${latColor}88`,
          }}>
            {latency}<span style={{ fontSize: 10, fontWeight: 400, marginLeft: 2 }}>ms</span>
          </p>
        </div>
      )}
    </div>
  )
}
