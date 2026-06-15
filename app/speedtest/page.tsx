'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Download, Upload, Activity, Play, RotateCcw, CheckCircle, Clock } from 'lucide-react'
import SpeedGauge from '@/components/SpeedGauge'
import ServerSelector from '@/components/ServerSelector'
import { TestServer } from '@/lib/servers'
import { formatSpeed, latencyColor, latencyLabel, calcJitter, jitterLabel } from '@/lib/utils'
import clsx from 'clsx'

type Phase = 'idle' | 'pretest' | 'ping' | 'download' | 'upload' | 'done'

const PING_SAMPLES = 15
const PING_INTERVAL_MS = 200
const PHASE_DURATION_MS = 8000   // 8 s per download/upload phase
const DOWNLOAD_CHUNK_BYTES = 25 * 1024 * 1024   // 25 MB per request
const UPLOAD_CHUNK_BYTES   = 5  * 1024 * 1024   // 5 MB per request
const PRE_TEST_DURATION_MS = 1500                // 1.5 s quick pre-test
const PRE_TEST_CHUNK_BYTES = 2 * 1024 * 1024    // 2 MB pre-test chunk
const BG_CALIBRATE_MS      = 2000               // 2 s background calibration on page load
const CF_DOWNLOAD_URL      = 'https://speed.cloudflare.com/__down'

interface Result {
  ping: number
  jitter: number
  download: number
  upload: number
  timestamp: number
}

const MAX_GAUGE = 1000 // Mbps

function pickGaugeMax(estimatedMbps: number): number {
  if (estimatedMbps < 5)    return 20
  if (estimatedMbps < 20)   return 50
  if (estimatedMbps < 50)   return 100
  if (estimatedMbps < 100)  return 250
  if (estimatedMbps < 250)  return 500
  if (estimatedMbps < 500)  return 1000
  if (estimatedMbps < 1000) return 2000
  return 10000
}

export default function SpeedTestPage() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [currentSpeed, setCurrentSpeed] = useState(0)
  const [currentPing, setCurrentPing] = useState<number | null>(null)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<Result | null>(null)
  const [history, setHistory] = useState<Result[]>([])
  const [speedHistory, setSpeedHistory] = useState<number[]>([])
  const [server, setServer] = useState<TestServer | null>(null)
  const [gaugeMax, setGaugeMax] = useState(MAX_GAUGE)
  const [gaugeSize, setGaugeSize] = useState(240)
  const [bgCalibrating, setBgCalibrating] = useState(true)
  const abortRef = useRef<AbortController | null>(null)
  const bgAbortRef = useRef<AbortController | null>(null)
  const cancelledRef = useRef(false)

  useEffect(() => {
    const update = () => setGaugeSize(window.innerWidth < 480 ? 200 : 240)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // Background speed calibration on page load — runs while server selector pings
  useEffect(() => {
    const abort = new AbortController()
    bgAbortRef.current = abort

    const run = async () => {
      try {
        const startTime = performance.now()
        let totalBytes = 0

        while (performance.now() - startTime < BG_CALIBRATE_MS) {
          if (abort.signal.aborted) break
          const res = await fetch(
            `${CF_DOWNLOAD_URL}?bytes=${PRE_TEST_CHUNK_BYTES}&_=${Date.now()}`,
            { signal: abort.signal, cache: 'no-store' }
          )
          const reader = res.body!.getReader()
          while (true) {
            if (abort.signal.aborted) { reader.cancel(); break }
            const { done, value } = await reader.read()
            if (done) break
            totalBytes += value?.byteLength ?? 0
            if (performance.now() - startTime >= BG_CALIBRATE_MS) { reader.cancel(); break }
          }
          if (performance.now() - startTime >= BG_CALIBRATE_MS) break
        }

        if (!abort.signal.aborted && totalBytes > 0) {
          const elapsed = (performance.now() - startTime) / 1000
          const mbps = (totalBytes * 8) / (elapsed * 1e6)
          setGaugeMax(pickGaugeMax(mbps))
        }
      } catch (_) {
        // Silently ignore — network errors or intentional abort when test starts
      } finally {
        setBgCalibrating(false)
      }
    }

    run()
    return () => abort.abort()
  }, [])

  const measurePing = async (srv: TestServer): Promise<{ avg: number; jitter: number }> => {
    const samples: number[] = []
    for (let i = 0; i < PING_SAMPLES; i++) {
      if (cancelledRef.current) throw new Error('cancelled')
      const t0 = performance.now()
      const pingIsExternal = srv.pingUrl.startsWith('http')
      let pingUrl = pingIsExternal ? `${srv.pingUrl}?_=${Date.now()}` : `${srv.pingUrl}&_=${Date.now()}`
      // Upgrade to HTTPS on secure pages to avoid mixed-content blocking
      if (pingIsExternal && window.location.protocol === 'https:') {
        pingUrl = pingUrl.replace(/^http:\/\//, 'https://')
      }
      await fetch(pingUrl, { cache: 'no-store', ...(pingIsExternal ? { mode: 'no-cors' } : {}) })
      samples.push(performance.now() - t0)
      setCurrentPing(samples[samples.length - 1])
      setProgress(Math.round(((i + 1) / PING_SAMPLES) * 100))
      await new Promise(r => setTimeout(r, PING_INTERVAL_MS))
    }
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length
    return { avg, jitter: calcJitter(samples) }
  }

  const measurePreTest = async (srv: TestServer): Promise<number> => {
    abortRef.current = new AbortController()
    const startTime = performance.now()
    let totalBytes = 0

    const chunkUrl = srv.cors
      ? `${srv.downloadUrl}?bytes=${PRE_TEST_CHUNK_BYTES}`
      : `${srv.downloadUrl}`

    try {
      while (performance.now() - startTime < PRE_TEST_DURATION_MS) {
        if (cancelledRef.current) break
        const res = await fetch(`${chunkUrl}&_=${Date.now()}`, {
          signal: abortRef.current.signal,
          cache: 'no-store',
        })
        const reader = res.body!.getReader()
        while (true) {
          if (cancelledRef.current) { reader.cancel(); break }
          const { done, value } = await reader.read()
          if (done) break
          totalBytes += value?.byteLength ?? 0
          if (performance.now() - startTime >= PRE_TEST_DURATION_MS) { reader.cancel(); break }
        }
        if (performance.now() - startTime >= PRE_TEST_DURATION_MS) break
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') throw e
    }

    const elapsed = (performance.now() - startTime) / 1000
    return totalBytes > 0 ? (totalBytes * 8) / (elapsed * 1e6) : 10
  }

  const measureDownload = async (srv: TestServer): Promise<number> => {
    abortRef.current = new AbortController()
    const startTime = performance.now()
    let totalBytes = 0
    const snap: number[] = []

    // Build per-chunk download URL for the selected server
    const chunkUrl = srv.cors
      ? `${srv.downloadUrl}?bytes=${DOWNLOAD_CHUNK_BYTES}`
      : `${srv.downloadUrl}`  // proxy URL already encodes the remote target

    const tick = setInterval(() => {
      const elapsed = (performance.now() - startTime) / 1000
      setProgress(Math.min((elapsed / (PHASE_DURATION_MS / 1000)) * 100, 99))
    }, 100)

    try {
      while (performance.now() - startTime < PHASE_DURATION_MS) {
        if (cancelledRef.current) break
        const res = await fetch(`${chunkUrl}&_=${Date.now()}`, {
          signal: abortRef.current.signal,
          cache: 'no-store',
        })
        const reader = res.body!.getReader()
        while (true) {
          if (cancelledRef.current) { reader.cancel(); break }
          const { done, value } = await reader.read()
          if (done) break
          totalBytes += value?.byteLength ?? 0
          const elapsed = (performance.now() - startTime) / 1000
          const speed = (totalBytes * 8) / (elapsed * 1e6)
          setCurrentSpeed(speed)
          snap.push(speed)
          setSpeedHistory([...snap.slice(-40)])
        }
        if (performance.now() - startTime >= PHASE_DURATION_MS) break
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') throw e
    } finally {
      clearInterval(tick)
    }

    setProgress(100)
    const elapsed = (performance.now() - startTime) / 1000
    return (totalBytes * 8) / (elapsed * 1e6)
  }

  const measureUpload = async (_srv: TestServer): Promise<number> => {
    // Always upload to Cloudflare __up directly from the browser.
    // multipart/form-data is a CORS "simple request" — no preflight, no CORS block.
    // Using the local /api proxy would measure browser→Vercel CDN edge (artificially fast).
    const chunk = new Uint8Array(UPLOAD_CHUNK_BYTES)
    for (let i = 0; i < chunk.length; i += 65536) {
      crypto.getRandomValues(chunk.subarray(i, Math.min(i + 65536, chunk.length)))
    }
    const blob = new Blob([chunk])

    const startTime = performance.now()
    let totalBytes = 0
    const snap: number[] = []

    const tick = setInterval(() => {
      const elapsed = (performance.now() - startTime) / 1000
      setProgress(Math.min((elapsed / (PHASE_DURATION_MS / 1000)) * 100, 99))
    }, 100)

    try {
      while (performance.now() - startTime < PHASE_DURATION_MS) {
        if (cancelledRef.current) break
        const form = new FormData()
        form.append('file', blob)
        await fetch(`https://speed.cloudflare.com/__up?_=${Date.now()}`, {
          method: 'POST',
          body: form,
        })
        totalBytes += UPLOAD_CHUNK_BYTES
        const elapsed = (performance.now() - startTime) / 1000
        const speed = (totalBytes * 8) / (elapsed * 1e6)
        setCurrentSpeed(speed)
        snap.push(speed)
        setSpeedHistory([...snap.slice(-40)])
      }
    } finally {
      clearInterval(tick)
    }

    setProgress(100)
    const elapsed = (performance.now() - startTime) / 1000
    return (totalBytes * 8) / (elapsed * 1e6)
  }

  const runTest = useCallback(async () => {
    const srv = server
    if (!srv) return
    // Cancel any background calibration still running
    bgAbortRef.current?.abort()
    setBgCalibrating(false)
    cancelledRef.current = false
    setPhase('pretest')
    setProgress(0)
    setCurrentSpeed(0)
    setCurrentPing(null)
    setSpeedHistory([])
    setGaugeMax(MAX_GAUGE)

    try {
      // Pre-test: quick speed estimate to calibrate gauge scale
      const estimatedMbps = await measurePreTest(srv)
      if (cancelledRef.current) return
      setGaugeMax(pickGaugeMax(estimatedMbps))

      // Phase 1: Ping
      setPhase('ping')
      setProgress(0)
      const { avg: pingAvg, jitter } = await measurePing(srv)

      // Phase 2: Download
      setPhase('download')
      setProgress(0)
      setCurrentSpeed(0)
      setSpeedHistory([])
      const downloadMbps = await measureDownload(srv)

      // Phase 3: Upload
      setPhase('upload')
      setProgress(0)
      setCurrentSpeed(0)
      setSpeedHistory([])
      const uploadMbps = await measureUpload(srv)

      const res: Result = {
        ping: pingAvg,
        jitter,
        download: downloadMbps,
        upload: uploadMbps,
        timestamp: Date.now(),
      }
      setResult(res)
      setHistory(prev => [res, ...prev.slice(0, 9)])
      setPhase('done')
    } catch {
      setPhase('idle')
    }
  }, [server])

  const reset = () => {
    cancelledRef.current = true
    abortRef.current?.abort()
    setPhase('idle')
    setCurrentSpeed(0)
    setProgress(0)
    setCurrentPing(null)
    setResult(null)
    setSpeedHistory([])
    setGaugeMax(MAX_GAUGE)
  }

  const isRunning = phase !== 'idle' && phase !== 'done'
  const gaugeColor = phase === 'download' ? '#00d4ff' : phase === 'upload' ? '#7b2fff' : '#00ff88'
  const secondsLeft = (phase === 'download' || phase === 'upload')
    ? Math.max(0, Math.ceil((PHASE_DURATION_MS / 1000) * (1 - progress / 100)))
    : null

  const phaseLabel = {
    idle: 'Pronto para testar',
    pretest: 'Detectando velocidade...',
    ping: 'Medindo latência...',
    download: 'Testando download...',
    upload: 'Testando upload...',
    done: 'Concluído!',
  }[phase]

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-white">Teste de Velocidade</h1>
          <p className="text-sm text-gray-500 mt-1">Meça download, upload, ping e jitter da sua conexão</p>
        </div>
        {bgCalibrating && phase === 'idle' && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 shrink-0 mt-1">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            <span className="text-[11px] text-cyan-400 whitespace-nowrap">Calibrando...</span>
          </div>
        )}
      </div>

      {/* Server Selector */}
      <ServerSelector selected={server} onChange={setServer} disabled={isRunning} />

      {/* Main Test Card */}
      <div className="card p-5 md:p-8 mb-6">
        <div className="flex flex-col items-center">
          {/* Gauge */}
          <div className="relative mb-6">
            <SpeedGauge
              value={isRunning ? currentSpeed : (result ? (phase === 'done' && result ? result.download : currentSpeed) : 0)}
              maxValue={gaugeMax}
              label={phase === 'upload' ? 'UPLOAD' : 'DOWNLOAD'}
              color={gaugeColor}
              size={gaugeSize}
            />
            {phase !== 'idle' && phase !== 'done' && (
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 text-xs text-gray-600 mono whitespace-nowrap">
                max {gaugeMax >= 1000 ? `${gaugeMax / 1000} Gbps` : `${gaugeMax} Mbps`}
              </div>
            )}
            {phase === 'ping' && currentPing && (
              <div className="absolute inset-0 flex items-center justify-center" style={{ paddingTop: 60 }}>
                <div className="text-center">
                  <div className="text-4xl font-black mono" style={{ color: latencyColor(currentPing) }}>
                    {currentPing.toFixed(0)}
                  </div>
                  <div className="text-xs text-gray-400">ms ping</div>
                </div>
              </div>
            )}
          </div>

          {/* Status */}
          <div className="flex items-center gap-3 mb-4">
            <span className="text-sm font-medium text-gray-400">{phaseLabel}</span>
            {secondsLeft !== null && secondsLeft > 0 && (
              <span className="flex items-center gap-1 text-xs text-gray-600 mono">
                <Clock className="w-3 h-3" />{secondsLeft}s
              </span>
            )}
          </div>

          {/* Progress Bar + Sparkline */}
          {isRunning && (
            <div className="w-full max-w-sm mb-6">
              <div className="progress-bar">
                <div className="progress-fill transition-none" style={{ width: `${progress}%` }} />
              </div>
              <div className="flex justify-between text-xs text-gray-600 mt-1">
                <span>{phaseLabel}</span>
                <span>{progress.toFixed(0)}%</span>
              </div>
              {speedHistory.length > 1 && (phase === 'download' || phase === 'upload') && (
                <svg className="w-full mt-3" height="36" viewBox={`0 0 ${speedHistory.length - 1} 36`} preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="sg" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor={gaugeColor} stopOpacity="0.4" />
                      <stop offset="100%" stopColor={gaugeColor} stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {(() => {
                    const max = Math.max(...speedHistory, 1)
                    const pts = speedHistory.map((v, i) => `${i},${36 - (v / max) * 34}`).join(' ')
                    const area = `0,36 ${pts} ${speedHistory.length - 1},36`
                    return (
                      <>
                        <polygon points={area} fill="url(#sg)" />
                        <polyline points={pts} fill="none" stroke={gaugeColor} strokeWidth="1.5" strokeLinejoin="round" />
                      </>
                    )
                  })()}
                </svg>
              )}
            </div>
          )}

          {/* Phase Indicators */}
          {phase === 'pretest' ? (
            <div className="flex items-center gap-2 mb-6">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-yellow-500/10 text-[#ffd700] border border-yellow-500/20">
                <Activity className="w-3 h-3 animate-pulse" />
                Calibrando medidor...
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 mb-6 flex-wrap">
              {(['ping', 'download', 'upload'] as const).map((p, i) => {
                const done = phase === 'done' || (phase === 'upload' && p !== 'upload') || (phase === 'download' && p === 'ping')
                const active = phase === p
                return (
                  <div key={p} className="flex items-center gap-2">
                    <div className={clsx(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all',
                      active ? 'bg-cyan-500/20 text-[#00d4ff] border border-cyan-500/30' :
                      done ? 'bg-green-500/10 text-[#00ff88] border border-green-500/20' :
                      'bg-white/5 text-gray-600 border border-white/5'
                    )}>
                      {done ? <CheckCircle className="w-3 h-3" /> : active ? <Activity className="w-3 h-3 animate-pulse" /> :
                        p === 'ping' ? <Activity className="w-3 h-3" /> :
                        p === 'download' ? <Download className="w-3 h-3" /> :
                        <Upload className="w-3 h-3" />
                      }
                      {p === 'ping' ? 'Ping' : p === 'download' ? 'Download' : 'Upload'}
                    </div>
                    {i < 2 && <span className="text-gray-700 text-xs">›</span>}
                  </div>
                )
              })}
            </div>
          )}

          {/* Action Buttons */}
          {!isRunning ? (
            <div className="flex gap-3 flex-wrap justify-center">
              <button
                onClick={runTest}
                disabled={!server}
                className="btn-cyan px-8 py-3 rounded-xl font-bold text-base flex items-center gap-2 disabled:opacity-40"
              >
                <Play className="w-5 h-5" />
                {phase === 'done' ? 'Testar Novamente' : 'Iniciar Teste'}
              </button>
              {phase === 'done' && (
                <button onClick={reset} className="btn-purple px-4 py-3 rounded-xl font-semibold text-sm flex items-center gap-2">
                  <RotateCcw className="w-4 h-4" />
                  Resetar
                </button>
              )}
            </div>
          ) : (
            <button onClick={reset} className="text-gray-500 hover:text-gray-300 text-sm flex items-center gap-1.5 transition-colors">
              <RotateCcw className="w-4 h-4" />
              Cancelar
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      {result && phase === 'done' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Download', value: formatSpeed(result.download), icon: Download, color: '#00d4ff' },
            { label: 'Upload', value: formatSpeed(result.upload), icon: Upload, color: '#7b2fff' },
            { label: 'Ping', value: { value: result.ping.toFixed(1), unit: 'ms' }, icon: Activity, color: latencyColor(result.ping) },
            { label: 'Jitter', value: { value: result.jitter.toFixed(1), unit: 'ms' }, icon: Clock, color: '#ffd700' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="card p-5 flex flex-col" style={{ borderColor: `${color}20` }}>
              <div className="flex items-center gap-2 mb-3">
                <Icon className="w-4 h-4" style={{ color }} />
                <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold">{label}</span>
              </div>
              <div className="flex items-end gap-1">
                <span className="text-2xl md:text-3xl font-black mono" style={{ color }}>{value.value}</span>
                <span className="text-sm text-gray-400 mb-1">{value.unit}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Histórico de Testes</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-[#1a2744]">
                  <th className="text-left pb-2">Horário</th>
                  <th className="text-right pb-2">Download</th>
                  <th className="text-right pb-2">Upload</th>
                  <th className="text-right pb-2">Ping</th>
                  <th className="text-right pb-2">Jitter</th>
                </tr>
              </thead>
              <tbody>
                {history.map((r, i) => {
                  const dl = formatSpeed(r.download)
                  const ul = formatSpeed(r.upload)
                  return (
                    <tr key={i} className="border-b border-[#1a2744]/50 hover:bg-white/2">
                      <td className="py-2 text-gray-400 mono text-xs">
                        {new Date(r.timestamp).toLocaleTimeString('pt-BR')}
                      </td>
                      <td className="py-2 text-right mono text-[#00d4ff]">{dl.value} <span className="text-gray-500 text-xs">{dl.unit}</span></td>
                      <td className="py-2 text-right mono text-[#7b2fff]">{ul.value} <span className="text-gray-500 text-xs">{ul.unit}</span></td>
                      <td className="py-2 text-right mono" style={{ color: latencyColor(r.ping) }}>{r.ping.toFixed(1)} <span className="text-gray-500 text-xs">ms</span></td>
                      <td className="py-2 text-right mono text-[#ffd700]">{r.jitter.toFixed(1)} <span className="text-gray-500 text-xs">ms</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
