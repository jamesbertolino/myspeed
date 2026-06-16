'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { loadSettings } from '@/lib/settings'

const BASE_BPM  = 20   // 1 batimento a cada 3s — beep a cada ~3s
const SCROLL_PX = 1    // varredura lenta

function ecgValue(t: number): number {
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

// Pitch baseado em latência + desvio configurável
// 0ms → base+devHz (agudo), 100ms → base, 200ms → base-devHz (grave)
function playBeep(latencyMs: number | null) {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    const ctx    = new AudioCtx()
    const now    = ctx.currentTime
    const devPct = loadSettings().ecgPitchDev
    const devHz  = 1000 * devPct / 100
    const ms     = latencyMs ?? 100
    const freq   = Math.max(1000 - devHz, Math.min(1000 + devHz, (1000 + devHz) - ms * devHz / 100))

    const osc1  = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    osc1.type = 'sine'
    osc1.frequency.setValueAtTime(freq, now)
    osc1.frequency.linearRampToValueAtTime(freq + 30, now + 0.10)
    gain1.gain.setValueAtTime(0, now)
    gain1.gain.linearRampToValueAtTime(0.28, now + 0.004)
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.11)
    osc1.start(now)
    osc1.stop(now + 0.12)

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
  const cycleStartRef = useRef(0)
  const cycleMsRef    = useRef(60_000 / BASE_BPM)
  const latencyRef    = useRef<number | null>(null)
  const smoothMidRef  = useRef<number | null>(null)

  const [paused,  setPaused]  = useState(false)
  const [bpm,     setBpm]     = useState(BASE_BPM)
  const [latency, setLatency] = useState<number | null>(null)
  const [ttl,     setTtl]     = useState<number | null>(null)

  const toggle = useCallback(() => {
    audioRef.current  = true
    pausedRef.current = !pausedRef.current
    setPaused(p => !p)
  }, [])

  useEffect(() => {
    const probe = async () => {
      try {
        const res  = await fetch('/api/ping?_=' + Date.now(), { cache: 'no-store' })
        const data = await res.json()
        if (data.ms >= 0) {
          setLatency(data.ms)
          latencyRef.current = data.ms
          // persiste no histórico (fire-and-forget)
          fetch('/api/history/ping', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ms: data.ms, ttl: data.ttl }),
          }).catch(() => {})
        }
        if (data.ttl !== null) setTtl(data.ttl)
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

    cycleStartRef.current = performance.now()
    cycleMsRef.current    = 60_000 / BASE_BPM

    const draw = (now: number) => {
      animRef.current = requestAnimationFrame(draw)
      if (pausedRef.current) return

      const W   = canvas.width
      const H   = canvas.height
      const AMP = H * 0.38

      // Baseline sobe (y menor) quando ping sobe, desce quando ping cai
      const MAX_MS    = 300
      const ms        = latencyRef.current ?? 100
      const norm      = Math.min(ms / MAX_MS, 1)                    // 0 = rápido, 1 = lento
      const targetMid = H * 0.78 - norm * (H * 0.56)               // 0ms→78%, 300ms→22%
      if (smoothMidRef.current === null) smoothMidRef.current = targetMid
      smoothMidRef.current += (targetMid - smoothMidRef.current) * 0.04
      const MID = smoothMidRef.current

      const elapsed = now - cycleStartRef.current
      const cycleMs = cycleMsRef.current
      const t       = Math.min(elapsed / cycleMs, 1)
      const cycle   = Math.floor(now / cycleMs)

      if (elapsed >= cycleMs) {
        cycleStartRef.current = now
        const raw  = BASE_BPM + ((Math.random() * 2 - 1) | 0)
        const next = Math.max(18, Math.min(22, raw))
        cycleMsRef.current = 60_000 / next
        setBpm(next)
      }

      const img = ctx.getImageData(SCROLL_PX, 0, W - SCROLL_PX, H)
      ctx.putImageData(img, 0, 0)
      ctx.fillStyle = BG
      ctx.fillRect(W - SCROLL_PX - 1, 0, SCROLL_PX + 2, H)
      ctx.strokeStyle = 'rgba(0,255,65,0.06)'
      ctx.lineWidth   = 1
      ctx.beginPath()
      ctx.moveTo(W - SCROLL_PX, MID)
      ctx.lineTo(W, MID)
      ctx.stroke()

      const y  = MID - ecgValue(t) * AMP
      const py = prevYRef.current ?? y

      ctx.beginPath()
      ctx.moveTo(W - SCROLL_PX, py)
      ctx.lineTo(W - 1, y)
      ctx.strokeStyle = '#00ff41'
      ctx.lineWidth   = 1.8
      ctx.shadowBlur  = 8
      ctx.shadowColor = '#00ff41'
      ctx.stroke()
      ctx.shadowBlur  = 0
      prevYRef.current = y

      ctx.fillStyle   = '#00ff41'
      ctx.shadowBlur  = 12
      ctx.shadowColor = '#00ff41'
      ctx.beginPath()
      ctx.arc(W - 1, y, 2.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowBlur = 0

      if (cycle !== lastCycleRef.current && t > 0.30 && t < 0.40 && audioRef.current) {
        lastCycleRef.current = cycle
        playBeep(latencyRef.current)
      }
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
      className="hidden md:flex items-center gap-3 px-3 shrink-0 cursor-pointer select-none"
      style={{
        height: 60,
        background: 'rgba(2,10,2,0.98)',
        borderBottom: '1px solid rgba(0,255,65,0.2)',
        boxShadow: '0 4px 24px rgba(0,255,65,0.06)',
      }}
      onClick={toggle}
      title={paused ? 'Clique para retomar' : 'Clique para pausar'}
    >
      <div className="flex flex-col items-center gap-0.5 shrink-0 w-8">
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: paused ? '#1a2d1a' : '#00ff41',
          boxShadow:  paused ? 'none'    : '0 0 8px #00ff41, 0 0 16px #00ff4166',
          animation:  paused ? 'none'    : 'pulse 1s ease-in-out infinite',
        }} />
        <span style={{ fontSize: 7, fontWeight: 700, letterSpacing: '0.12em', color: paused ? '#1a2d1a' : '#00ff4188' }}>
          {paused ? 'PAUSE' : 'LIVE'}
        </span>
      </div>

      <canvas ref={canvasRef} className="flex-1" style={{ height: 44, display: 'block' }} />

      {/* Latência + TTL */}
      <div className="flex items-center gap-2 shrink-0 mr-2">
        <div className="text-center" style={{ minWidth: 48 }}>
          <p style={{ fontSize: 8, letterSpacing: '0.12em', marginBottom: 1, color: paused ? '#1a2d1a' : latColor + '88' }}>PING</p>
          <p style={{
            fontSize: 18, fontWeight: 900, fontFamily: 'monospace', lineHeight: 1,
            color: paused ? '#1a2d1a' : (latency !== null ? latColor : '#00ff4144'),
            textShadow: paused ? 'none' : `0 0 12px ${latColor}`,
          }}>
            {paused ? '--' : latency !== null ? latency : '—'}
            {!paused && latency !== null && <span style={{ fontSize: 9, fontWeight: 400, marginLeft: 1 }}>ms</span>}
          </p>
        </div>
        <div className="text-center" style={{ borderLeft: '1px solid rgba(0,255,65,0.15)', paddingLeft: 8, minWidth: 40 }}>
          <p style={{ fontSize: 8, letterSpacing: '0.12em', marginBottom: 1, color: paused ? '#1a2d1a' : '#00ff4166' }}>TTL</p>
          <p style={{
            fontSize: 18, fontWeight: 900, fontFamily: 'monospace', lineHeight: 1,
            color: paused ? '#1a2d1a' : (ttl !== null ? '#00d4ff' : '#00ff4144'),
            textShadow: paused ? 'none' : ttl !== null ? '0 0 12px #00d4ff' : 'none',
          }}>
            {paused ? '--' : ttl !== null ? ttl : '—'}
          </p>
        </div>
      </div>
    </div>
  )
}
