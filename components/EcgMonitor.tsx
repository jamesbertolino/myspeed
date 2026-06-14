'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

const BASE_BPM  = 72
const SCROLL_PX = 2

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

// Pitch base 1000 Hz, variação máxima ±10% (900–1100 Hz)
function playBeep(bpm: number) {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const now = ctx.currentTime
    // BPM 55–85 → 900–1100 Hz (±10% de 1000 Hz)
    const freq = 900 + ((Math.max(55, Math.min(85, bpm)) - 55) / 30) * 200

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

function drawFrame(
  ctx2d: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  prevY: number | null,
  t: number,
  BG: string,
): number {
  const W   = canvas.width
  const H   = canvas.height
  const MID = H * 0.5
  const AMP = H * 0.42

  const img = ctx2d.getImageData(SCROLL_PX, 0, W - SCROLL_PX, H)
  ctx2d.putImageData(img, 0, 0)

  ctx2d.fillStyle = BG
  ctx2d.fillRect(W - SCROLL_PX - 1, 0, SCROLL_PX + 2, H)
  ctx2d.strokeStyle = 'rgba(0,255,65,0.06)'
  ctx2d.lineWidth   = 1
  ctx2d.beginPath()
  ctx2d.moveTo(W - SCROLL_PX, MID)
  ctx2d.lineTo(W, MID)
  ctx2d.stroke()

  const y  = MID - ecgValue(t) * AMP
  const py = prevY ?? y

  ctx2d.beginPath()
  ctx2d.moveTo(W - SCROLL_PX, py)
  ctx2d.lineTo(W - 1, y)
  ctx2d.strokeStyle = '#00ff41'
  ctx2d.lineWidth   = 1.8
  ctx2d.shadowBlur  = 8
  ctx2d.shadowColor = '#00ff41'
  ctx2d.stroke()
  ctx2d.shadowBlur  = 0

  ctx2d.fillStyle   = '#00ff41'
  ctx2d.shadowBlur  = 10
  ctx2d.shadowColor = '#00ff41'
  ctx2d.beginPath()
  ctx2d.arc(W - 1, y, 2, 0, Math.PI * 2)
  ctx2d.fill()
  ctx2d.shadowBlur = 0

  return y
}

export default function EcgMonitor() {
  const canvasRef       = useRef<HTMLCanvasElement>(null)
  const mobileCanvasRef = useRef<HTMLCanvasElement>(null)
  const pausedRef       = useRef(false)
  const audioRef        = useRef(false)
  const animRef         = useRef(0)
  const prevYRef        = useRef<number | null>(null)
  const prevYMobRef     = useRef<number | null>(null)
  const lastCycleRef    = useRef(-1)
  const cycleStartRef   = useRef(0)
  const cycleMsRef      = useRef(60_000 / BASE_BPM)

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
    const canvas  = canvasRef.current
    const mCanvas = mobileCanvasRef.current
    if (!canvas || !mCanvas) return

    const ctx  = canvas.getContext('2d')!
    const mCtx = mCanvas.getContext('2d')!
    const BG   = '#020a02'

    const resize = () => {
      canvas.width  = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
      ctx.fillStyle = BG
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      prevYRef.current = null

      mCanvas.width  = mCanvas.offsetWidth
      mCanvas.height = mCanvas.offsetHeight
      mCtx.fillStyle = BG
      mCtx.fillRect(0, 0, mCanvas.width, mCanvas.height)
      prevYMobRef.current = null
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    ro.observe(mCanvas)

    cycleStartRef.current = performance.now()
    cycleMsRef.current    = 60_000 / BASE_BPM

    const draw = (now: number) => {
      animRef.current = requestAnimationFrame(draw)
      if (pausedRef.current) return

      const elapsed = now - cycleStartRef.current
      const cycleMs = cycleMsRef.current
      const t       = Math.min(elapsed / cycleMs, 1)
      const cycle   = Math.floor(now / cycleMs)

      if (elapsed >= cycleMs) {
        cycleStartRef.current = now
        const raw = BASE_BPM + ((Math.random() * 16 - 8) | 0)
        const next = Math.max(55, Math.min(85, raw))
        cycleMsRef.current = 60_000 / next
        setBpm(next)
      }

      if (canvas.width > 0 && canvas.height > 0)
        prevYRef.current = drawFrame(ctx, canvas, prevYRef.current, t, BG)
      if (mCanvas.width > 0 && mCanvas.height > 0)
        prevYMobRef.current = drawFrame(mCtx, mCanvas, prevYMobRef.current, t, BG)

      if (cycle !== lastCycleRef.current && t > 0.30 && t < 0.40 && audioRef.current) {
        lastCycleRef.current = cycle
        playBeep(Math.round(60_000 / cycleMs))
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
    <>
      {/* ── Desktop bar ── */}
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

        {latency !== null && (
          <div className="text-center shrink-0 border-l pl-4" style={{ borderColor: '#00ff4122' }}>
            <p style={{ fontSize: 9, letterSpacing: '0.15em', marginBottom: 1, color: latColor + '55' }}>PING</p>
            <p style={{
              fontSize: 20, fontWeight: 900, fontFamily: 'monospace', lineHeight: 1,
              color: latColor, textShadow: `0 0 10px ${latColor}88`,
            }}>
              {latency}<span style={{ fontSize: 10, fontWeight: 400, marginLeft: 2 }}>ms</span>
            </p>
          </div>
        )}
      </div>

      {/* ── Mobile mini strip — fixed abaixo do header (top-14 = 56px) ── */}
      <div
        className="md:hidden fixed left-0 right-0 z-30 flex items-center gap-2 px-3 cursor-pointer select-none"
        style={{
          top: 56,
          height: 32,
          background: 'rgba(2,10,2,0.97)',
          borderBottom: '1px solid rgba(0,255,65,0.18)',
        }}
        onClick={toggle}
      >
        {/* Live dot */}
        <div style={{
          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
          background: paused ? '#1a2d1a' : '#00ff41',
          boxShadow:  paused ? 'none'    : '0 0 6px #00ff41',
        }} />

        {/* Mini ECG canvas */}
        <canvas ref={mobileCanvasRef} className="flex-1" style={{ height: 22, display: 'block' }} />

        {/* BPM + Ping */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'monospace', color: paused ? '#1a2d1a' : '#00ff41' }}>
            {paused ? '--' : bpm}<span style={{ fontSize: 9, fontWeight: 400, marginLeft: 2 }}>BPM</span>
          </span>
          {latency !== null && (
            <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'monospace', color: latColor }}>
              {latency}<span style={{ fontSize: 9, fontWeight: 400 }}>ms</span>
            </span>
          )}
        </div>
      </div>
    </>
  )
}
