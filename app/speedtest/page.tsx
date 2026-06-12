'use client'

import { useState, useCallback, useRef } from 'react'
import { Download, Upload, Activity, Play, RotateCcw, CheckCircle, Clock } from 'lucide-react'
import SpeedGauge from '@/components/SpeedGauge'
import { formatSpeed, latencyColor, latencyLabel, calcJitter, jitterLabel } from '@/lib/utils'
import clsx from 'clsx'

type Phase = 'idle' | 'ping' | 'download' | 'upload' | 'done'

interface Result {
  ping: number
  jitter: number
  download: number
  upload: number
  timestamp: number
}

const MAX_GAUGE = 1000 // Mbps

export default function SpeedTestPage() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [currentSpeed, setCurrentSpeed] = useState(0)
  const [currentPing, setCurrentPing] = useState<number | null>(null)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<Result | null>(null)
  const [history, setHistory] = useState<Result[]>([])
  const abortRef = useRef<AbortController | null>(null)

  const measurePing = async (): Promise<{ avg: number; jitter: number }> => {
    const samples: number[] = []
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now()
      await fetch(`/api/ping?_=${Date.now()}`, { cache: 'no-store' })
      samples.push(performance.now() - t0)
      setCurrentPing(samples[samples.length - 1])
      setProgress((i + 1) * 10)
      await new Promise(r => setTimeout(r, 100))
    }
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length
    const jitter = calcJitter(samples)
    return { avg, jitter }
  }

  const measureDownload = async (): Promise<number> => {
    abortRef.current = new AbortController()
    const t0 = performance.now()
    let bytes = 0

    const res = await fetch('/api/speedtest/download?size=25', {
      signal: abortRef.current.signal,
      cache: 'no-store',
    })

    const reader = res.body!.getReader()
    const total = parseInt(res.headers.get('content-length') || '0')

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value?.byteLength ?? 0
      const elapsed = (performance.now() - t0) / 1000
      const speed = (bytes * 8) / (elapsed * 1e6)
      setCurrentSpeed(speed)
      setProgress(total > 0 ? (bytes / total) * 100 : 50)
    }

    const elapsed = (performance.now() - t0) / 1000
    return (bytes * 8) / (elapsed * 1e6)
  }

  const measureUpload = async (): Promise<number> => {
    const size = 10 * 1024 * 1024 // 10 MB
    const chunk = new Uint8Array(size)
    for (let i = 0; i < size; i++) chunk[i] = i & 0xFF

    // Simulate speed reporting during upload
    let reported = false
    const t0 = performance.now()
    const speedTimer = setInterval(() => {
      const elapsed = (performance.now() - t0) / 1000
      if (!reported) {
        const rough = (size * 8) / (elapsed * 1e6) * 0.5 // rough estimate
        setCurrentSpeed(Math.min(rough, 500))
        setProgress(Math.min(elapsed * 15, 90))
      }
    }, 200)

    try {
      const res = await fetch('/api/speedtest/upload', {
        method: 'POST',
        body: chunk,
        cache: 'no-store',
        headers: { 'Content-Type': 'application/octet-stream' },
      })
      reported = true
      clearInterval(speedTimer)
      const data = await res.json()
      setCurrentSpeed(data.mbps)
      setProgress(100)
      return data.mbps
    } catch {
      clearInterval(speedTimer)
      throw new Error('Upload failed')
    }
  }

  const runTest = useCallback(async () => {
    setPhase('ping')
    setProgress(0)
    setCurrentSpeed(0)
    setCurrentPing(null)

    try {
      // Phase 1: Ping
      const { avg: pingAvg, jitter } = await measurePing()

      // Phase 2: Download
      setPhase('download')
      setProgress(0)
      setCurrentSpeed(0)
      const downloadMbps = await measureDownload()

      // Phase 3: Upload
      setPhase('upload')
      setProgress(0)
      setCurrentSpeed(0)
      const uploadMbps = await measureUpload()

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
  }, [])

  const reset = () => {
    abortRef.current?.abort()
    setPhase('idle')
    setCurrentSpeed(0)
    setProgress(0)
    setCurrentPing(null)
    setResult(null)
  }

  const isRunning = phase !== 'idle' && phase !== 'done'
  const gaugeColor = phase === 'download' ? '#00d4ff' : phase === 'upload' ? '#7b2fff' : '#00ff88'

  const phaseLabel = {
    idle: 'Pronto para testar',
    ping: 'Medindo latência...',
    download: 'Testando download...',
    upload: 'Testando upload...',
    done: 'Concluído!',
  }[phase]

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Teste de Velocidade</h1>
        <p className="text-sm text-gray-500 mt-1">Meça download, upload, ping e jitter da sua conexão</p>
      </div>

      {/* Main Test Card */}
      <div className="card p-8 mb-6">
        <div className="flex flex-col items-center">
          {/* Gauge */}
          <div className="relative mb-6">
            <SpeedGauge
              value={isRunning ? currentSpeed : (result ? (phase === 'done' && result ? result.download : currentSpeed) : 0)}
              maxValue={MAX_GAUGE}
              label={phase === 'upload' ? 'UPLOAD' : 'DOWNLOAD'}
              color={gaugeColor}
              size={240}
            />
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
          <div className="text-sm font-medium text-gray-400 mb-4">{phaseLabel}</div>

          {/* Progress Bar */}
          {isRunning && (
            <div className="w-full max-w-sm mb-6">
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <div className="flex justify-between text-xs text-gray-600 mt-1">
                <span>{phaseLabel}</span>
                <span>{progress.toFixed(0)}%</span>
              </div>
            </div>
          )}

          {/* Phase Indicators */}
          <div className="flex items-center gap-2 mb-6">
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

          {/* Action Buttons */}
          {!isRunning ? (
            <div className="flex gap-3">
              <button
                onClick={runTest}
                className="btn-cyan px-8 py-3 rounded-xl font-bold text-base flex items-center gap-2"
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
                <span className="text-3xl font-black mono" style={{ color }}>{value.value}</span>
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
