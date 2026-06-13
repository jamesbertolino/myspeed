'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import {
  Monitor, ScanLine, Shield, ShieldAlert, ShieldX, ShieldCheck,
  Sparkles, RefreshCw, Terminal, Wifi, ChevronDown, ChevronUp,
  Server, Cpu, AlertTriangle, CheckCircle, Clock, Network, Router,
} from 'lucide-react'
import clsx from 'clsx'

// ── Types ──────────────────────────────────────────────────────────────────────

interface OpenPort {
  port: number
  service: string
  risk: 'low' | 'medium' | 'high' | 'critical'
}

interface Device {
  ip: string
  mac: string | null
  vendor: string | null
  hostname: string | null
  openPorts: OpenPort[]
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical'
}

interface AIRisk {
  deviceIp: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  title: string
  detail: string
  fix: string
}

interface AIAnalysis {
  score: number
  scoreLabel: string
  summary: string
  risks: AIRisk[]
  generalRecommendations: Array<{
    priority: 'low' | 'medium' | 'high'
    title: string
    detail: string
  }>
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface NetworkIface {
  name: string
  address: string
  subnet: string
  netmask: string
  mac: string
}

// ── Constants ──────────────────────────────────────────────────────────────────

const AGENT_PORT = 7474

const RISK_COLORS = {
  critical: 'text-red-400 bg-red-500/10 border-red-500/30',
  high:     'text-orange-400 bg-orange-500/10 border-orange-500/30',
  medium:   'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
  low:      'text-green-400 bg-green-500/10 border-green-500/30',
  none:     'text-gray-400 bg-gray-500/10 border-gray-500/30',
}

const RISK_LABELS = {
  critical: 'Crítico',
  high:     'Alto',
  medium:   'Médio',
  low:      'Baixo',
  none:     'Seguro',
}

const RISK_ICONS = {
  critical: ShieldX,
  high:     ShieldAlert,
  medium:   ShieldAlert,
  low:      ShieldCheck,
  none:     ShieldCheck,
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function RiskBadge({ level }: { level: string }) {
  const l = (level || 'none') as keyof typeof RISK_LABELS
  const Icon = RISK_ICONS[l] ?? Shield
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wide',
      RISK_COLORS[l] ?? RISK_COLORS.none
    )}>
      <Icon className="w-3 h-3" />
      {RISK_LABELS[l] ?? level}
    </span>
  )
}

function PortBadge({ p }: { p: OpenPort }) {
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-mono',
      RISK_COLORS[p.risk]
    )}>
      {p.port}
      <span className="font-sans font-normal opacity-80">{p.service}</span>
    </span>
  )
}

function DeviceCard({ device }: { device: Device }) {
  const [expanded, setExpanded] = useState(false)
  const hasPorts = device.openPorts.length > 0
  const visiblePorts = expanded ? device.openPorts : device.openPorts.slice(0, 4)
  const extra = device.openPorts.length - 4

  return (
    <div className={clsx(
      'card border transition-all',
      device.riskLevel === 'critical' ? 'border-red-500/30 bg-red-500/5' :
      device.riskLevel === 'high'     ? 'border-orange-500/20' :
      device.riskLevel === 'medium'   ? 'border-yellow-500/20' :
      'border-[#1a2744]'
    )}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[#0f1a35] border border-[#1a2744] flex items-center justify-center shrink-0">
            <Monitor className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="min-w-0">
            <p className="font-mono text-sm text-white font-medium">{device.ip}</p>
            {device.vendor && (
              <p className="text-[11px] text-gray-400 truncate">{device.vendor}</p>
            )}
          </div>
        </div>
        <RiskBadge level={device.riskLevel} />
      </div>

      {device.mac && (
        <p className="text-[10px] text-gray-600 font-mono mb-2">{device.mac}</p>
      )}

      {hasPorts ? (
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1.5 font-medium">
            {device.openPorts.length} porta{device.openPorts.length !== 1 ? 's' : ''} aberta{device.openPorts.length !== 1 ? 's' : ''}
          </p>
          <div className="flex flex-wrap gap-1">
            {visiblePorts.map(p => <PortBadge key={p.port} p={p} />)}
            {!expanded && extra > 0 && (
              <button
                onClick={() => setExpanded(true)}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-[#1a2744] text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
              >
                +{extra} <ChevronDown className="w-3 h-3" />
              </button>
            )}
            {expanded && extra > 0 && (
              <button
                onClick={() => setExpanded(false)}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-[#1a2744] text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
              >
                <ChevronUp className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-gray-600">Nenhuma porta vulnerável detectada</p>
      )}
    </div>
  )
}

function ScoreRing({ score }: { score: number }) {
  const r = 36
  const circ = 2 * Math.PI * r
  const dash = circ * (score / 100)
  const color = score >= 80 ? '#00ff88' : score >= 60 ? '#00d4ff' : score >= 40 ? '#f59e0b' : '#ef4444'

  return (
    <div className="relative w-24 h-24 flex items-center justify-center">
      <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r={r} fill="none" stroke="#1a2744" strokeWidth="8" />
        <circle
          cx="48" cy="48" r={r} fill="none"
          stroke={color} strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          style={{ transition: 'stroke-dasharray 1s ease' }}
        />
      </svg>
      <div className="text-center">
        <p className="text-2xl font-bold text-white leading-none">{score}</p>
        <p className="text-[10px] text-gray-500">/ 100</p>
      </div>
    </div>
  )
}

function AIPanel({ analysis, onClose }: { analysis: AIAnalysis; onClose: () => void }) {
  const scoreColor = analysis.score >= 80 ? 'text-[#00ff88]' : analysis.score >= 60 ? 'text-[#00d4ff]' : analysis.score >= 40 ? 'text-yellow-400' : 'text-red-400'

  return (
    <div className="space-y-4">
      {/* Score overview */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-400" />
            <h3 className="text-sm font-semibold text-white">Análise de Segurança — IA</h3>
          </div>
          <button onClick={onClose} className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors">
            Fechar
          </button>
        </div>

        <div className="flex items-center gap-6">
          <ScoreRing score={analysis.score} />
          <div>
            <p className={clsx('text-3xl font-bold leading-none', scoreColor)}>{analysis.scoreLabel}</p>
            <p className="text-xs text-gray-400 mt-1">Pontuação de segurança</p>
            <p className="text-sm text-gray-300 mt-3 leading-relaxed">{analysis.summary}</p>
          </div>
        </div>
      </div>

      {/* Risks */}
      {analysis.risks.length > 0 && (
        <div className="card">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Riscos Identificados ({analysis.risks.length})
          </h4>
          <div className="space-y-3">
            {analysis.risks.map((risk, i) => (
              <div key={i} className={clsx(
                'rounded-lg border p-3',
                risk.severity === 'critical' ? 'border-red-500/30 bg-red-500/5' :
                risk.severity === 'high'     ? 'border-orange-500/30 bg-orange-500/5' :
                risk.severity === 'medium'   ? 'border-yellow-500/30 bg-yellow-500/5' :
                'border-green-500/20 bg-green-500/5'
              )}>
                <div className="flex items-center gap-2 mb-2">
                  <RiskBadge level={risk.severity} />
                  <span className="font-mono text-[11px] text-gray-400">{risk.deviceIp}</span>
                  <span className="text-sm font-medium text-white ml-1">{risk.title}</span>
                </div>
                <p className="text-xs text-gray-400 mb-2">{risk.detail}</p>
                <div className="flex items-start gap-1.5">
                  <CheckCircle className="w-3 h-3 text-green-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-green-300">{risk.fix}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* General recommendations */}
      {analysis.generalRecommendations.length > 0 && (
        <div className="card">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Recomendações Gerais
          </h4>
          <div className="space-y-2.5">
            {analysis.generalRecommendations.map((rec, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className={clsx(
                  'shrink-0 w-1.5 h-1.5 rounded-full mt-1.5',
                  rec.priority === 'high' ? 'bg-orange-400' :
                  rec.priority === 'medium' ? 'bg-yellow-400' : 'bg-green-400'
                )} />
                <div>
                  <p className="text-sm font-medium text-white">{rec.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{rec.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function DevicesPage() {
  const [scanning, setScanning] = useState(false)
  const [devices, setDevices] = useState<Device[]>([])
  const [progressMsg, setProgressMsg] = useState<string | null>(null)
  const [totalHosts, setTotalHosts] = useState<number | null>(null)
  const [scannedCount, setScannedCount] = useState(0)
  const [scanError, setScanError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState<number | null>(null)
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [agentReady, setAgentReady] = useState(false)
  const [agentChecked, setAgentChecked] = useState(false)
  const [interfaces, setInterfaces] = useState<NetworkIface[]>([])
  const [selectedSubnet, setSelectedSubnet] = useState<string>('')
  const abortRef = useRef<AbortController | null>(null)

  // Load available network interfaces — prefer agent (local machine) over server API
  useEffect(() => {
    const load = (url: string) =>
      fetch(url)
        .then(r => r.json())
        .then(({ interfaces: ifaces }: { interfaces: NetworkIface[] }) => {
          if (!ifaces?.length) throw new Error('empty')
          setInterfaces(ifaces)
          if (!selectedSubnet) setSelectedSubnet(ifaces[0].subnet)
        })

    load(`http://localhost:${AGENT_PORT}/interfaces`)
      .catch(() => load('/api/devices/interfaces'))
      .catch(() => {})
  }, [])

  // Check for local agent
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const res = await fetch(`http://localhost:${AGENT_PORT}/ping`, {
          signal: AbortSignal.timeout(1500),
        })
        if (!cancelled && res.ok) {
          setAgentReady(true)
          // Reload interfaces from agent (local machine) now that it's available
          fetch(`http://localhost:${AGENT_PORT}/interfaces`)
            .then(r => r.json())
            .then(({ interfaces: ifaces }: { interfaces: NetworkIface[] }) => {
              if (!cancelled && ifaces?.length) {
                setInterfaces(ifaces)
                setSelectedSubnet(prev => prev || ifaces[0].subnet)
              }
            })
            .catch(() => {})
        }
      } catch (_) {}
      if (!cancelled) setAgentChecked(true)
    }
    check()
    const interval = setInterval(check, 8000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  const handleEvent = useCallback((event: Record<string, unknown>) => {
    switch (event.type) {
      case 'progress':
        setProgressMsg(event.message as string)
        break
      case 'hosts':
        setTotalHosts(event.count as number)
        setProgressMsg(null)
        break
      case 'device':
        setDevices(prev => [...prev, event.device as Device])
        setScannedCount(prev => prev + 1)
        break
      case 'done':
        setElapsed(event.elapsed as number)
        break
    }
  }, [])

  const startScan = useCallback(async (subnet?: string) => {
    subnet = subnet ?? selectedSubnet
    abortRef.current?.abort()
    const abort = new AbortController()
    abortRef.current = abort

    setScanning(true)
    setDevices([])
    setProgressMsg(null)
    setTotalHosts(null)
    setScannedCount(0)
    setScanError(null)
    setElapsed(null)
    setAiAnalysis(null)
    setAnalyzeError(null)

    let url: string
    let res: Response

    try {
      // Prefer local agent
      if (agentReady) {
        const agentUrl = subnet
          ? `http://localhost:${AGENT_PORT}/devices?subnet=${subnet}`
          : `http://localhost:${AGENT_PORT}/devices`
        res = await fetch(agentUrl, { signal: abort.signal })
      } else {
        const scanUrl = subnet
          ? `/api/devices/scan?subnet=${subnet}`
          : '/api/devices/scan'
        res = await fetch(scanUrl, { signal: abort.signal })
      }

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try { handleEvent(JSON.parse(line)) } catch (_) {}
        }
      }
    } catch (e) {
      if (!abort.signal.aborted) {
        setScanError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      setScanning(false)
    }
  }, [agentReady, handleEvent, selectedSubnet])

  const runAIAnalysis = useCallback(async () => {
    if (!devices.length) return
    setAnalyzing(true)
    setAnalyzeError(null)
    try {
      const res = await fetch('/api/devices/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ devices }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setAiAnalysis(data.analysis)
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : String(e))
    } finally {
      setAnalyzing(false)
    }
  }, [devices])

  const riskCounts = devices.reduce((acc, d) => {
    acc[d.riskLevel] = (acc[d.riskLevel] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  const scanDone = !scanning && elapsed !== null
  const hasDevices = devices.length > 0
  const progress = totalHosts ? Math.round((scannedCount / totalHosts) * 100) : 0

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Network className="w-5 h-5 text-cyan-400" />
            Dispositivos na Rede
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Escaneie e analise dispositivos conectados à sua rede local
          </p>
        </div>

        <button
          onClick={() => startScan()}
          disabled={scanning}
          className={clsx(
            'flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all shrink-0',
            scanning
              ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 cursor-wait'
              : 'bg-cyan-500 text-black hover:bg-cyan-400 active:scale-95'
          )}
        >
          {scanning
            ? <><RefreshCw className="w-4 h-4 animate-spin" /> Escaneando...</>
            : <><ScanLine className="w-4 h-4" /> {hasDevices ? 'Novo Scan' : 'Iniciar Scan'}</>
          }
        </button>
      </div>

      {/* Interface selector */}
      {interfaces.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-lg bg-[#0b1527] border border-[#1a2744]">
          <div className="flex items-center gap-2 shrink-0">
            <Router className="w-4 h-4 text-cyan-400" />
            <span className="text-sm font-medium text-gray-300">Interface de rede:</span>
          </div>
          <div className="flex flex-wrap gap-2 flex-1">
            {interfaces.map(iface => (
              <button
                key={iface.subnet}
                disabled={scanning}
                onClick={() => setSelectedSubnet(iface.subnet)}
                className={clsx(
                  'flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all',
                  selectedSubnet === iface.subnet
                    ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                    : 'bg-white/3 border-[#1a2744] text-gray-400 hover:border-cyan-500/30 hover:text-gray-200'
                )}
              >
                <span className={clsx(
                  'w-1.5 h-1.5 rounded-full shrink-0',
                  selectedSubnet === iface.subnet ? 'bg-cyan-400' : 'bg-gray-600'
                )} />
                <span className="font-mono">{iface.name}</span>
                <span className="text-gray-500">·</span>
                <span className="font-mono">{iface.address}</span>
                <span className="text-gray-500 hidden sm:inline">·</span>
                <span className="text-gray-500 hidden sm:inline">{iface.subnet}.0/24</span>
              </button>
            ))}
          </div>
          {interfaces.length === 1 && (
            <span className="text-[11px] text-gray-600">Apenas uma interface disponível</span>
          )}
        </div>
      )}

      {/* Agent status banner */}
      {agentChecked && (
        agentReady ? (
          <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-green-500/10 border border-green-500/20">
            <div className="w-2 h-2 rounded-full bg-green-400 shrink-0 animate-pulse" />
            <p className="text-sm text-green-300">
              Agente local conectado — scan completo da rede disponível
            </p>
          </div>
        ) : (
          <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
            <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
            <div className="text-sm text-yellow-300">
              <p className="font-medium">Agente local não detectado</p>
              <p className="text-yellow-400/70 text-xs mt-0.5">
                Para scan completo, execute <code className="bg-black/30 px-1 rounded">node wifi-agent.js</code> no terminal do seu computador. Sem o agente, o scan usa a API do servidor (funciona apenas em desenvolvimento local).
              </p>
            </div>
          </div>
        )
      )}

      {/* Progress */}
      {scanning && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">
              {progressMsg || (totalHosts !== null
                ? `Escaneando portas: ${scannedCount} / ${totalHosts} dispositivos`
                : 'Descobrindo dispositivos...')}
            </span>
            {totalHosts !== null && (
              <span className="text-cyan-400 font-mono">{progress}%</span>
            )}
          </div>
          <div className="w-full h-1.5 bg-[#1a2744] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 to-purple-500 rounded-full transition-all duration-500"
              style={{ width: totalHosts ? `${progress}%` : '0%' }}
            />
          </div>
          {devices.length > 0 && (
            <p className="text-xs text-gray-500">
              {devices.length} dispositivo{devices.length !== 1 ? 's' : ''} encontrado{devices.length !== 1 ? 's' : ''} até agora...
            </p>
          )}
        </div>
      )}

      {/* Scan error */}
      {scanError && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <div>
            <p className="text-sm text-red-300 font-medium">Falha no scan</p>
            <p className="text-xs text-red-400/70">{scanError}</p>
          </div>
        </div>
      )}

      {/* Summary stats (after scan) */}
      {scanDone && hasDevices && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Dispositivos', value: devices.length, color: 'text-cyan-400', icon: Monitor },
            { label: 'Crítico / Alto', value: (riskCounts.critical || 0) + (riskCounts.high || 0), color: 'text-red-400', icon: ShieldX },
            { label: 'Médio', value: riskCounts.medium || 0, color: 'text-yellow-400', icon: ShieldAlert },
            { label: 'Seguro', value: (riskCounts.low || 0) + (riskCounts.none || 0), color: 'text-green-400', icon: ShieldCheck },
          ].map(stat => (
            <div key={stat.label} className="card text-center py-3">
              <stat.icon className={clsx('w-4 h-4 mx-auto mb-1', stat.color)} />
              <p className={clsx('text-2xl font-bold', stat.color)}>{stat.value}</p>
              <p className="text-[10px] text-gray-500 uppercase tracking-wide">{stat.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Devices grid — shown in real-time during scan and after */}
      {hasDevices && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-cyan-400" />
              Dispositivos Encontrados
              {scanning && (
                <span className="text-xs text-gray-500 font-normal">
                  (atualizando em tempo real...)
                </span>
              )}
            </h2>
            {scanDone && elapsed !== null && (
              <span className="text-[11px] text-gray-500 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {(elapsed / 1000).toFixed(1)}s
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {devices
              .slice()
              .sort((a, b) => {
                const order = { critical: 0, high: 1, medium: 2, low: 3, none: 4 }
                return (order[a.riskLevel] ?? 5) - (order[b.riskLevel] ?? 5)
              })
              .map(device => (
                <DeviceCard key={device.ip} device={device} />
              ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!scanning && !hasDevices && !scanError && (
        <div className="card text-center py-16">
          <Network className="w-12 h-12 text-gray-700 mx-auto mb-4" />
          <h3 className="text-gray-400 font-medium mb-2">Nenhum scan realizado</h3>
          <p className="text-sm text-gray-600 mb-6 max-w-sm mx-auto">
            Clique em <strong className="text-gray-400">Iniciar Scan</strong> para descobrir dispositivos
            conectados à sua rede local e analisar possíveis vulnerabilidades de segurança.
          </p>
          <button
            onClick={() => startScan()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-cyan-500 text-black text-sm font-medium hover:bg-cyan-400 active:scale-95 transition-all"
          >
            <ScanLine className="w-4 h-4" />
            Iniciar Scan
          </button>
        </div>
      )}

      {/* AI Analysis section */}
      {scanDone && hasDevices && !aiAnalysis && (
        <div className="card">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-4 h-4 text-purple-400" />
                <h3 className="text-sm font-semibold text-white">Análise de Segurança com IA</h3>
              </div>
              <p className="text-xs text-gray-500">
                Identifique vulnerabilidades e receba recomendações específicas para cada dispositivo
              </p>
            </div>
            <button
              onClick={runAIAnalysis}
              disabled={analyzing}
              className={clsx(
                'flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium shrink-0 transition-all',
                analyzing
                  ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20 cursor-wait'
                  : 'bg-purple-600 text-white hover:bg-purple-500 active:scale-95'
              )}
            >
              {analyzing
                ? <><RefreshCw className="w-4 h-4 animate-spin" /> Analisando...</>
                : <><Sparkles className="w-4 h-4" /> Analisar com IA</>
              }
            </button>
          </div>

          {analyzeError && (
            <div className="mt-3 flex items-center gap-2 text-xs text-red-400">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {analyzeError}
            </div>
          )}
        </div>
      )}

      {/* AI Analysis result */}
      {aiAnalysis && (
        <AIPanel analysis={aiAnalysis} onClose={() => setAiAnalysis(null)} />
      )}

      {/* How it works info */}
      {!hasDevices && !scanning && (
        <div className="card bg-[#0a1628]">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-2">
            <Terminal className="w-3.5 h-3.5" />
            Como funciona
          </h3>
          <div className="grid sm:grid-cols-3 gap-4 text-xs text-gray-500">
            <div>
              <p className="text-gray-300 font-medium mb-1">1. Descoberta</p>
              <p>Lê a tabela ARP e varre a subnet local ({'/'}24) para encontrar dispositivos ativos via TCP.</p>
            </div>
            <div>
              <p className="text-gray-300 font-medium mb-1">2. Port Scan</p>
              <p>Testa 25 portas comuns em cada dispositivo encontrado (FTP, SSH, Telnet, HTTP, RDP, bancos de dados, etc.).</p>
            </div>
            <div>
              <p className="text-gray-300 font-medium mb-1">3. Análise IA</p>
              <p>Envia os resultados para a IA que identifica riscos e sugere correções específicas para cada vulnerabilidade.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
