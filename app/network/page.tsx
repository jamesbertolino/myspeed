'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Activity, Search, Network, Play, Square, AlertTriangle,
  CheckCircle, Clock, Globe, ChevronRight, Loader2
} from 'lucide-react'
import LatencyChart from '@/components/LatencyChart'
import { latencyColor, calcJitter, jitterColor, jitterLabel, latencyLabel, formatLatency } from '@/lib/utils'
import clsx from 'clsx'

interface PingPoint { t: number; latency: number }
interface TraceHop {
  hop: number
  host: string
  ip: string
  latency: number | null
  timeout: boolean
}

interface DnsResult {
  domain: string
  type: string
  records?: unknown[]
  A?: string[]
  MX?: unknown[]
  NS?: string[]
  TXT?: string[]
  elapsed: number
  error?: string
}

const PING_PRESETS = [
  { label: 'Este Servidor', url: '/api/ping', tag: 'LOCAL' },
  { label: '1.1.1.1 (Cloudflare)', url: 'https://one.one.one.one/dns-query?name=a&type=A', tag: 'CF' },
  { label: '8.8.8.8 (Google)', url: 'https://dns.google/dns-query?name=a&type=A', tag: 'G' },
]

const DNS_TYPES = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'ALL']

export default function NetworkPage() {
  const [tab, setTab] = useState<'ping' | 'traceroute' | 'dns'>('ping')

  // Ping state
  const [pingData, setPingData] = useState<PingPoint[]>([])
  const [pingRunning, setPingRunning] = useState(false)
  const [pingTarget, setPingTarget] = useState(PING_PRESETS[0].url)
  const [pingCustom, setPingCustom] = useState('')
  const [pingStats, setPingStats] = useState({ min: 0, max: 0, avg: 0, sent: 0, lost: 0 })
  const [jitter, setJitter] = useState(0)
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pingHistory = useRef<number[]>([])
  const pingAllStats = useRef({ min: Infinity, max: 0, sum: 0, sent: 0, lost: 0 })

  // Traceroute state
  const [traceTarget, setTraceTarget] = useState('8.8.8.8')
  const [traceHops, setTraceHops] = useState<TraceHop[]>([])
  const [traceLoading, setTraceLoading] = useState(false)
  const [traceSimulated, setTraceSimulated] = useState(false)

  // DNS state
  const [dnsDomain, setDnsDomain] = useState('google.com')
  const [dnsType, setDnsType] = useState('A')
  const [dnsResult, setDnsResult] = useState<DnsResult | null>(null)
  const [dnsLoading, setDnsLoading] = useState(false)

  const doPing = useCallback(async () => {
    const s = pingAllStats.current
    s.sent++
    const t0 = performance.now()
    const url = pingCustom ? `https://${pingCustom}` : pingTarget
    try {
      await fetch(url + `?_t=${Date.now()}`, { cache: 'no-store' })
      const lat = performance.now() - t0
      pingHistory.current = [...pingHistory.current.slice(-99), lat]
      setPingData(prev => [...prev.slice(-99), { t: Date.now(), latency: lat }])
      s.min = Math.min(s.min, lat)
      s.max = Math.max(s.max, lat)
      s.sum += lat
      const avg = s.sum / (s.sent - s.lost)
      setPingStats({ min: s.min, max: s.max, avg, sent: s.sent, lost: s.lost })
      setJitter(calcJitter(pingHistory.current))
    } catch {
      s.lost++
      setPingStats(prev => ({ ...prev, sent: s.sent, lost: s.lost }))
    }
  }, [pingTarget, pingCustom])

  const startPing = useCallback(() => {
    pingAllStats.current = { min: Infinity, max: 0, sum: 0, sent: 0, lost: 0 }
    pingHistory.current = []
    setPingData([])
    setPingRunning(true)
    doPing()
    pingRef.current = setInterval(doPing, 1000)
  }, [doPing])

  const stopPing = () => {
    if (pingRef.current) clearInterval(pingRef.current)
    setPingRunning(false)
  }

  useEffect(() => () => { if (pingRef.current) clearInterval(pingRef.current) }, [])

  const runTraceroute = async () => {
    setTraceLoading(true)
    setTraceHops([])
    try {
      const res = await fetch(`/api/traceroute?target=${encodeURIComponent(traceTarget)}`)
      const data = await res.json()
      setTraceHops(data.hops || [])
      setTraceSimulated(data.simulated || false)
    } catch {
      setTraceHops([])
    } finally {
      setTraceLoading(false)
    }
  }

  const runDns = async () => {
    setDnsLoading(true)
    setDnsResult(null)
    try {
      const res = await fetch(`/api/dns?domain=${encodeURIComponent(dnsDomain)}&type=${dnsType}`)
      setDnsResult(await res.json())
    } finally {
      setDnsLoading(false)
    }
  }

  const packetLoss = pingStats.sent > 0 ? (pingStats.lost / pingStats.sent) * 100 : 0
  const lastLatency = pingData[pingData.length - 1]?.latency ?? null

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Análise de Rede</h1>
        <p className="text-sm text-gray-500 mt-1">Ping, Jitter, Traceroute e DNS</p>
      </div>

      {/* Tab Nav */}
      <div className="flex gap-1 mb-6 bg-[#0a1128] rounded-xl p-1 border border-[#1a2744] w-fit">
        {([
          { id: 'ping', icon: Activity, label: 'Ping / Jitter' },
          { id: 'traceroute', icon: Network, label: 'Traceroute' },
          { id: 'dns', icon: Globe, label: 'DNS Lookup' },
        ] as const).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all',
              tab === t.id ? 'bg-[#1a2744] text-white' : 'text-gray-500 hover:text-gray-300'
            )}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* PING TAB */}
      {tab === 'ping' && (
        <div className="space-y-4">
          {/* Controls */}
          <div className="card p-4 flex flex-wrap items-end gap-4">
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Destino</label>
              <select
                value={pingCustom ? 'custom' : pingTarget}
                onChange={e => {
                  if (e.target.value === 'custom') { setPingCustom(''); }
                  else { setPingCustom(''); setPingTarget(e.target.value) }
                }}
                className="bg-[#050a1a] border border-[#1a2744] text-gray-300 text-sm rounded-lg px-3 py-2 outline-none min-w-48"
              >
                {PING_PRESETS.map(p => <option key={p.url} value={p.url}>{p.label}</option>)}
                <option value="custom">Personalizado...</option>
              </select>
            </div>
            {(pingTarget === 'custom' || pingCustom) && (
              <div>
                <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Host</label>
                <input
                  className="dark-input w-48"
                  placeholder="ex: example.com"
                  value={pingCustom}
                  onChange={e => setPingCustom(e.target.value)}
                />
              </div>
            )}
            <button
              onClick={pingRunning ? stopPing : startPing}
              className={clsx('px-5 py-2 rounded-lg font-semibold text-sm flex items-center gap-2', pingRunning ? 'btn-purple' : 'btn-cyan')}
            >
              {pingRunning ? <><Square className="w-4 h-4" />Parar</> : <><Play className="w-4 h-4" />Iniciar</>}
            </button>
          </div>

          {/* Stats Bar */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              { label: 'Atual', value: lastLatency ? `${lastLatency.toFixed(1)}ms` : '—', color: lastLatency ? latencyColor(lastLatency) : '#4a5568' },
              { label: 'Mínimo', value: pingStats.min !== Infinity ? `${pingStats.min.toFixed(1)}ms` : '—', color: '#00ff88' },
              { label: 'Máximo', value: pingStats.max > 0 ? `${pingStats.max.toFixed(1)}ms` : '—', color: '#ff4d4d' },
              { label: 'Média', value: pingStats.avg > 0 ? `${pingStats.avg.toFixed(1)}ms` : '—', color: '#00d4ff' },
              { label: 'Jitter', value: jitter > 0 ? `${jitter.toFixed(1)}ms` : '—', color: jitterColor(jitter) },
            ].map(s => (
              <div key={s.label} className="card p-3">
                <p className="text-xs text-gray-600 mb-1">{s.label}</p>
                <p className="text-lg font-bold mono" style={{ color: s.color }}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Chart */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-white">Latência em Tempo Real</h3>
                <div className="flex items-center gap-3 mt-1">
                  {lastLatency && (
                    <span className={clsx('tag', lastLatency <= 50 ? 'tag-cyan' : lastLatency <= 100 ? 'tag-yellow' : 'tag-red')}>
                      {latencyLabel(lastLatency)}
                    </span>
                  )}
                  {jitter > 0 && (
                    <span className={clsx('tag', jitter <= 5 ? 'tag-green' : jitter <= 15 ? 'tag-cyan' : 'tag-yellow')}>
                      Jitter: {jitterLabel(jitter)}
                    </span>
                  )}
                  {packetLoss > 0 && (
                    <span className="tag tag-red">Perda: {packetLoss.toFixed(1)}%</span>
                  )}
                </div>
              </div>
              <div className="text-right text-xs text-gray-600">
                <p>Enviados: {pingStats.sent}</p>
                <p>Perdidos: {pingStats.lost}</p>
              </div>
            </div>
            {pingData.length > 0 ? (
              <LatencyChart data={pingData} height={200} showGrid />
            ) : (
              <div className="h-48 flex items-center justify-center text-gray-600 text-sm">
                <div className="text-center">
                  <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  Clique em &quot;Iniciar&quot; para começar o monitoramento
                </div>
              </div>
            )}
          </div>

          {/* Jitter Interpretation */}
          <div className="card p-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Qualidade para Aplicações</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { app: 'VoIP / Chamadas', ok: jitter <= 30 && lastLatency !== null && lastLatency <= 150, label: jitter <= 30 ? 'Ótimo' : 'Ruim' },
                { app: 'Videoconferência', ok: jitter <= 50 && lastLatency !== null && lastLatency <= 200, label: jitter <= 50 ? 'Ótimo' : 'Ruim' },
                { app: 'Gaming Online', ok: lastLatency !== null && lastLatency <= 50, label: lastLatency !== null && lastLatency <= 50 ? 'Ótimo' : lastLatency !== null && lastLatency <= 100 ? 'Ok' : 'Ruim' },
                { app: 'Streaming', ok: lastLatency !== null && lastLatency <= 200, label: lastLatency !== null && lastLatency <= 100 ? 'Excelente' : 'Ok' },
              ].map(a => (
                <div key={a.app} className={clsx('p-3 rounded-lg border', a.ok ? 'border-green-500/20 bg-green-500/5' : 'border-red-500/20 bg-red-500/5')}>
                  <div className="flex items-center gap-2 mb-1">
                    {a.ok
                      ? <CheckCircle className="w-4 h-4 text-[#00ff88]" />
                      : <AlertTriangle className="w-4 h-4 text-[#ff4d4d]" />
                    }
                    <span className="text-xs font-semibold text-white">{a.app}</span>
                  </div>
                  <span className={clsx('text-xs', a.ok ? 'text-[#00ff88]' : 'text-[#ff4d4d]')}>{a.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TRACEROUTE TAB */}
      {tab === 'traceroute' && (
        <div className="space-y-4">
          <div className="card p-4 flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-48">
              <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Destino</label>
              <input
                className="dark-input"
                value={traceTarget}
                onChange={e => setTraceTarget(e.target.value)}
                placeholder="IP ou domínio (ex: 8.8.8.8)"
                onKeyDown={e => e.key === 'Enter' && runTraceroute()}
              />
            </div>
            <button
              onClick={runTraceroute}
              disabled={traceLoading}
              className="btn-cyan px-5 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 disabled:opacity-50"
            >
              {traceLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {traceLoading ? 'Rastreando...' : 'Rastrear'}
            </button>
          </div>

          {traceSimulated && (
            <div className="flex items-center gap-2 text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-4 py-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Traceroute simulado — o servidor não tem permissão para executar traceroute real.
            </div>
          )}

          <div className="card overflow-hidden">
            {traceHops.length === 0 && !traceLoading ? (
              <div className="p-8 text-center text-gray-600 text-sm">
                <Network className="w-8 h-8 mx-auto mb-2 opacity-30" />
                Execute o traceroute para ver os saltos
              </div>
            ) : (
              <div>
                <div className="px-4 py-3 border-b border-[#1a2744] grid grid-cols-12 text-xs text-gray-500 uppercase tracking-wider font-semibold">
                  <span className="col-span-1">#</span>
                  <span className="col-span-4">Host</span>
                  <span className="col-span-3">IP</span>
                  <span className="col-span-2 text-right">Latência</span>
                  <span className="col-span-2 text-right">Status</span>
                </div>
                {traceHops.map((hop, i) => (
                  <div
                    key={i}
                    className="px-4 py-3 border-b border-[#1a2744]/50 grid grid-cols-12 text-sm items-center hover:bg-white/2"
                  >
                    <span className="col-span-1 text-gray-600 mono">{hop.hop}</span>
                    <span className="col-span-4 text-gray-300 truncate font-medium">{hop.host}</span>
                    <span className="col-span-3 text-gray-500 mono text-xs">{hop.ip !== hop.host ? hop.ip : ''}</span>
                    <span className="col-span-2 text-right mono" style={{ color: hop.latency ? latencyColor(hop.latency) : '#4a5568' }}>
                      {hop.latency ? `${hop.latency.toFixed(1)}ms` : '—'}
                    </span>
                    <div className="col-span-2 flex justify-end">
                      {hop.timeout ? (
                        <span className="tag tag-red">Timeout</span>
                      ) : (
                        <span className="tag" style={{
                          background: `${hop.latency ? latencyColor(hop.latency) : '#4a5568'}15`,
                          color: hop.latency ? latencyColor(hop.latency) : '#4a5568',
                          border: `1px solid ${hop.latency ? latencyColor(hop.latency) : '#4a5568'}30`,
                        }}>
                          {hop.latency ? latencyLabel(hop.latency) : 'OK'}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {traceLoading && (
                  <div className="px-4 py-3 flex items-center gap-2 text-gray-500 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Descobrindo próximo salto...
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* DNS TAB */}
      {tab === 'dns' && (
        <div className="space-y-4">
          <div className="card p-4 flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-48">
              <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Domínio</label>
              <input
                className="dark-input"
                value={dnsDomain}
                onChange={e => setDnsDomain(e.target.value)}
                placeholder="ex: google.com"
                onKeyDown={e => e.key === 'Enter' && runDns()}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Tipo</label>
              <select
                value={dnsType}
                onChange={e => setDnsType(e.target.value)}
                className="bg-[#050a1a] border border-[#1a2744] text-gray-300 text-sm rounded-lg px-3 py-2 outline-none"
              >
                {DNS_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <button
              onClick={runDns}
              disabled={dnsLoading}
              className="btn-cyan px-5 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 disabled:opacity-50"
            >
              {dnsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Resolver
            </button>
          </div>

          {dnsResult && (
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-white">{dnsResult.domain}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="tag tag-cyan">{dnsResult.type}</span>
                    {dnsResult.elapsed && (
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <Clock className="w-3 h-3" />{dnsResult.elapsed}ms
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {dnsResult.error ? (
                <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 rounded-lg px-4 py-3">
                  <AlertTriangle className="w-4 h-4" />
                  {dnsResult.error}
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Handle ALL type */}
                  {dnsType === 'ALL' ? (
                    ['A', 'MX', 'NS', 'TXT'].map(t => {
                      const records = (dnsResult as unknown as Record<string, unknown>)[t] as unknown[] | undefined
                      if (!records?.length) return null
                      return (
                        <div key={t}>
                          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1.5">{t} Records</p>
                          {records.map((r, i) => (
                            <div key={i} className="bg-[#050a1a] rounded-lg px-4 py-2 mono text-xs text-gray-300 mb-1">
                              {typeof r === 'object' ? JSON.stringify(r) : String(r)}
                            </div>
                          ))}
                        </div>
                      )
                    })
                  ) : (
                    (dnsResult.records || []).map((r, i) => (
                      <div key={i} className="bg-[#050a1a] rounded-lg px-4 py-2.5 mono text-sm text-[#00d4ff] border border-[#1a2744]">
                        {typeof r === 'object' ? JSON.stringify(r, null, 2) : String(r)}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
