'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Activity, Search, Network, Play, Square, AlertTriangle,
  CheckCircle, Clock, Globe, ChevronRight, Loader2, Zap, Copy, Check,
  FileSearch, Calendar, Shield, Server, ExternalLink, ChevronDown, ChevronUp
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


interface WhoisResult {
  domain: string
  elapsed: number
  server: string
  domainName: string
  registrar: string
  registrarUrl: string
  createdDate: string
  updatedDate: string
  expiresDate: string
  status: string[]
  nameServers: string[]
  dnssec: string
  country: string
  organization: string
  abuse: string
  raw: string
  error?: string
}

interface BenchResult {
  name: string
  ip: string
  flag: string
  avg: number
  samples: number[]
  timeout: boolean
  isp: boolean
}

export default function NetworkPage() {
  const [tab, setTab] = useState<'ping' | 'traceroute' | 'dns' | 'benchmark' | 'whois'>('ping')

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
  const [traceError, setTraceError] = useState('')

  // DNS Benchmark state
  const [benchResults,  setBenchResults]  = useState<BenchResult[]>([])
  const [benchLoading,  setBenchLoading]  = useState(false)
  const [benchCustomIp, setBenchCustomIp] = useState('')
  const [benchDone,     setBenchDone]     = useState(false)
  const [benchIspFound, setBenchIspFound] = useState(false)
  const [copied,        setCopied]        = useState('')

  // DNS state
  const [dnsDomain, setDnsDomain] = useState('google.com')
  const [dnsType, setDnsType] = useState('A')
  const [dnsResult, setDnsResult] = useState<DnsResult | null>(null)
  const [dnsLoading, setDnsLoading] = useState(false)

  // WHOIS state
  const [whoisDomain, setWhoisDomain] = useState('google.com')
  const [whoisResult, setWhoisResult] = useState<WhoisResult | null>(null)
  const [whoisLoading, setWhoisLoading] = useState(false)
  const [whoisError, setWhoisError] = useState('')
  const [whoisRawOpen, setWhoisRawOpen] = useState(false)

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
    setTraceError('')
    try {
      const res = await fetch(`/api/traceroute?target=${encodeURIComponent(traceTarget)}`)
      const data = await res.json()
      setTraceHops(data.hops || [])
      if (data.error) setTraceError(data.error)
    } catch {
      setTraceError('Falha ao executar traceroute')
    } finally {
      setTraceLoading(false)
    }
  }

  const runBenchmark = async () => {
    setBenchLoading(true)
    setBenchDone(false)
    setBenchResults([])
    try {
      const customTrim = benchCustomIp.trim()
      const [mainRes, customRes] = await Promise.all([
        fetch('/api/dns-benchmark').then(r => r.json()),
        customTrim
          ? fetch(`/api/dns-benchmark?ip=${encodeURIComponent(customTrim)}`).then(r => r.json())
          : Promise.resolve(null),
      ])

      const rows: BenchResult[] = mainRes.results ?? []
      setBenchIspFound(mainRes.ispFound ?? false)
      if (customRes?.avg != null) {
        rows.push({ name: `Personalizado (${customTrim})`, ip: customTrim, flag: '⚙️', avg: customRes.avg, samples: customRes.samples, timeout: customRes.timeout, isp: false })
        rows.sort((a, b) => (a.timeout ? 1 : 0) - (b.timeout ? 1 : 0) || a.avg - b.avg)
      }

      setBenchResults(rows)
      setBenchDone(true)
    } finally {
      setBenchLoading(false)
    }
  }

  const copyIp = (ip: string) => {
    navigator.clipboard.writeText(ip).then(() => {
      setCopied(ip)
      setTimeout(() => setCopied(''), 2000)
    })
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

  const runWhois = async () => {
    setWhoisLoading(true)
    setWhoisError('')
    setWhoisResult(null)
    setWhoisRawOpen(false)
    try {
      const res = await fetch(`/api/whois?domain=${encodeURIComponent(whoisDomain.trim())}`)
      const data: WhoisResult = await res.json()
      if (data.error) setWhoisError(data.error)
      else setWhoisResult(data)
    } catch {
      setWhoisError('Falha ao consultar WHOIS')
    } finally {
      setWhoisLoading(false)
    }
  }

  const packetLoss = pingStats.sent > 0 ? (pingStats.lost / pingStats.sent) * 100 : 0
  const lastLatency = pingData[pingData.length - 1]?.latency ?? null

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-bold text-white">Análise de Rede</h1>
        <p className="text-sm text-gray-500 mt-1">Ping, Jitter, Traceroute e DNS</p>
      </div>

      {/* Tab Nav */}
      <div className="flex gap-1 mb-6 bg-[#0a1128] rounded-xl p-1 border border-[#1a2744] w-full sm:w-fit overflow-x-auto">
        {([
          { id: 'ping', icon: Activity, label: 'Ping / Jitter' },
          { id: 'traceroute', icon: Network, label: 'Traceroute' },
          { id: 'dns', icon: Globe, label: 'DNS Lookup' },
          { id: 'benchmark', icon: Zap, label: 'DNS Benchmark' },
          { id: 'whois', icon: FileSearch, label: 'WHOIS' },
        ] as const).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all whitespace-nowrap',
              tab === t.id ? 'bg-[#1a2744] text-white' : 'text-gray-500 hover:text-gray-300'
            )}
          >
            <t.icon className="w-4 h-4 shrink-0" />
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

          {traceError && (
            <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {traceError}
            </div>
          )}

          <div className="card overflow-x-auto">
            {traceHops.length === 0 && !traceLoading ? (
              <div className="p-8 text-center text-gray-600 text-sm">
                <Network className="w-8 h-8 mx-auto mb-2 opacity-30" />
                Execute o traceroute para ver os saltos
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[480px]">
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
      {tab === 'benchmark' && (
        <div className="space-y-4">
          {/* controles */}
          <div className="card p-4 flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-48">
              <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">
                IP personalizado — gateway/DNS local <span className="text-gray-600 normal-case">(opcional)</span>
              </label>
              <input
                className="dark-input"
                value={benchCustomIp}
                onChange={e => setBenchCustomIp(e.target.value)}
                placeholder="ex: 192.168.1.1"
                onKeyDown={e => e.key === 'Enter' && !benchLoading && runBenchmark()}
              />
            </div>
            <button
              onClick={runBenchmark}
              disabled={benchLoading}
              className="btn-cyan px-5 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 disabled:opacity-50"
            >
              {benchLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              {benchLoading ? 'Testando…' : 'Iniciar Benchmark'}
            </button>
          </div>

          {benchLoading && benchResults.length === 0 && (
            <div className="card p-8 flex flex-col items-center gap-3 text-gray-500">
              <Loader2 className="w-8 h-8 animate-spin text-[#00d4ff]" />
              <p className="text-sm">Medindo latência ICMP para cada servidor DNS — aguarde…</p>
            </div>
          )}

          {benchDone && benchResults.length > 0 && (() => {
            const best    = benchResults.find(r => !r.timeout)
            const bestIsp = benchResults.find(r => !r.timeout && r.isp)
            const maxAvg  = Math.max(...benchResults.filter(r => !r.timeout).map(r => r.avg), 1)
            const ispResults    = benchResults.filter(r => r.isp)
            const publicResults = benchResults.filter(r => !r.isp)

            return (
              <div className="card p-5">
                {/* destaque vencedor */}
                {best && (
                  <div className="flex items-center gap-3 p-3 rounded-xl mb-4 border border-[#00d4ff]/20 bg-[#00d4ff]/5">
                    <span className="text-2xl">{best.flag}</span>
                    <div className="flex-1">
                      <p className="text-xs text-[#00d4ff] font-semibold uppercase tracking-wider mb-0.5">🏆 Mais rápido</p>
                      <p className="text-white font-bold">{best.name} <span className="text-gray-400 font-normal text-sm">({best.ip})</span></p>
                      <p className="text-xs text-gray-500 mt-0.5">Média {best.avg.toFixed(1)}ms · menor latência na sua rede</p>
                    </div>
                    <button
                      onClick={() => copyIp(best.ip)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#00d4ff]/30 text-[#00d4ff] hover:bg-[#00d4ff]/10 transition-all"
                    >
                      {copied === best.ip ? <><Check className="w-3 h-3" />Copiado!</> : <><Copy className="w-3 h-3" />Copiar IP</>}
                    </button>
                  </div>
                )}

                {/* destaque DNS do provedor */}
                {bestIsp && !bestIsp.timeout && (
                  <div className="flex items-center gap-3 p-3 rounded-xl mb-5 border border-amber-500/20 bg-amber-500/5">
                    <span className="text-2xl">{bestIsp.flag}</span>
                    <div className="flex-1">
                      <p className="text-xs text-amber-400 font-semibold uppercase tracking-wider mb-0.5">🏠 DNS do Provedor</p>
                      <p className="text-white font-bold">{bestIsp.name} <span className="text-gray-400 font-normal text-sm">({bestIsp.ip})</span></p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Média {bestIsp.avg.toFixed(1)}ms ·{' '}
                        {best && !best.isp
                          ? bestIsp.avg <= best.avg
                            ? 'mais rápido que os DNS públicos'
                            : `${(bestIsp.avg - best.avg).toFixed(1)}ms mais lento que ${best.name}`
                          : 'detectado automaticamente'
                        }
                      </p>
                    </div>
                    <button
                      onClick={() => copyIp(bestIsp.ip)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-all"
                    >
                      {copied === bestIsp.ip ? <><Check className="w-3 h-3" />Copiado!</> : <><Copy className="w-3 h-3" />Copiar IP</>}
                    </button>
                  </div>
                )}

                {/* DNS do provedor — ranking */}
                {ispResults.length > 0 && (
                  <>
                    <p className="text-xs text-amber-400/70 font-semibold uppercase tracking-wider mb-2">DNS do Provedor (ISP)</p>
                    <div className="space-y-2 mb-5">
                      {ispResults.map(r => {
                        const rank   = benchResults.indexOf(r)
                        const barPct = r.timeout ? 100 : (r.avg / maxAvg) * 100
                        const color  = r.timeout ? '#ff4d4d' : '#f59e0b'
                        return (
                          <div key={r.ip} className="group">
                            <div className="flex items-center gap-3 mb-1">
                              <span className="text-gray-600 text-xs w-4 text-right shrink-0">{rank + 1}</span>
                              <span className="text-base shrink-0">{r.flag}</span>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm text-white font-medium truncate">{r.name}</span>
                                  <span className="text-xs text-gray-600 mono shrink-0">{r.ip}</span>
                                </div>
                                <div className="relative h-1.5 bg-white/5 rounded-full mt-1.5 overflow-hidden">
                                  <div className="absolute left-0 top-0 h-full rounded-full" style={{ width: `${barPct}%`, background: color }} />
                                </div>
                              </div>
                              <div className="text-right shrink-0 w-20">
                                {r.timeout ? <span className="text-xs text-red-400">Timeout</span>
                                  : <span className="text-sm font-bold mono" style={{ color }}>{r.avg.toFixed(1)}<span className="text-gray-500 text-xs font-normal ml-0.5">ms</span></span>}
                              </div>
                              <button onClick={() => copyIp(r.ip)} className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-600 hover:text-amber-400" title="Copiar IP">
                                {copied === r.ip ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}

                {/* DNS públicos — ranking */}
                <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-2">DNS Públicos</p>
                <div className="space-y-2">
                  {publicResults.map(r => {
                    const rank   = benchResults.indexOf(r)
                    const barPct = r.timeout ? 100 : (r.avg / maxAvg) * 100
                    const color  = r.timeout ? '#ff4d4d' : rank === 0 ? '#00d4ff' : rank < 3 ? '#00ff88' : rank < 6 ? '#ffd700' : '#ff8800'
                    return (
                      <div key={r.ip} className="group">
                        <div className="flex items-center gap-3 mb-1">
                          <span className="text-gray-600 text-xs w-4 text-right shrink-0">{rank + 1}</span>
                          <span className="text-base shrink-0">{r.flag}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-white font-medium truncate">{r.name}</span>
                              <span className="text-xs text-gray-600 mono shrink-0">{r.ip}</span>
                            </div>
                            <div className="relative h-1.5 bg-white/5 rounded-full mt-1.5 overflow-hidden">
                              <div className="absolute left-0 top-0 h-full rounded-full" style={{ width: `${barPct}%`, background: color }} />
                            </div>
                          </div>
                          <div className="text-right shrink-0 w-20">
                            {r.timeout ? <span className="text-xs text-red-400">Timeout</span>
                              : <span className="text-sm font-bold mono" style={{ color }}>{r.avg.toFixed(1)}<span className="text-gray-500 text-xs font-normal ml-0.5">ms</span></span>}
                          </div>
                          <button onClick={() => copyIp(r.ip)} className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-600 hover:text-[#00d4ff]" title="Copiar IP">
                            {copied === r.ip ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {!benchIspFound && (
                  <p className="text-xs text-amber-500/60 mt-3">⚠ DNS do provedor não detectado automaticamente — use o campo personalizado para adicioná-lo manualmente.</p>
                )}

                <p className="text-xs text-gray-600 mt-4 text-center">
                  Medido via ICMP ping (OS) · 5 amostras por servidor · mesma precisão do CMD
                </p>
              </div>
            )
          })()}
        </div>
      )}

      {/* WHOIS TAB */}
      {tab === 'whois' && (
        <div className="space-y-4">
          {/* barra de busca */}
          <div className="card p-4 flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-48">
              <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Domínio</label>
              <input
                className="dark-input"
                value={whoisDomain}
                onChange={e => setWhoisDomain(e.target.value)}
                placeholder="ex: google.com"
                onKeyDown={e => e.key === 'Enter' && !whoisLoading && runWhois()}
              />
            </div>
            <button
              onClick={runWhois}
              disabled={whoisLoading}
              className="btn-cyan px-5 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 disabled:opacity-50"
            >
              {whoisLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSearch className="w-4 h-4" />}
              {whoisLoading ? 'Consultando…' : 'Consultar WHOIS'}
            </button>
          </div>

          {whoisError && (
            <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {whoisError}
            </div>
          )}

          {whoisResult && (
            <div className="space-y-4">
              {/* header */}
              <div className="card p-5">
                <div className="flex items-start justify-between gap-4 mb-5">
                  <div>
                    <h2 className="text-lg font-bold text-white">{whoisResult.domainName || whoisResult.domain}</h2>
                    {whoisResult.organization && (
                      <p className="text-sm text-gray-400 mt-0.5">{whoisResult.organization}</p>
                    )}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {whoisResult.status.slice(0, 4).map(s => {
                        const ok = s.toLowerCase().includes('active') || s.toLowerCase().includes('ok')
                        return (
                          <span key={s} className={`tag text-[10px] ${ok ? 'tag-green' : 'tag-yellow'}`}>
                            {s.split(' ')[0].replace('client', '').replace('server', '').trim() || s}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-gray-600">Consultado em</p>
                    <p className="text-xs text-gray-500 mono">{whoisResult.elapsed}ms</p>
                    <p className="text-xs text-gray-700 mt-1 mono">{whoisResult.server}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {/* Registrar */}
                  {whoisResult.registrar && (
                    <div className="bg-white/3 rounded-xl p-3.5">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Shield className="w-3.5 h-3.5 text-[#00d4ff]" />
                        <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Registrar</span>
                      </div>
                      <p className="text-sm text-white font-medium">{whoisResult.registrar}</p>
                      {whoisResult.registrarUrl && (
                        <a
                          href={whoisResult.registrarUrl.startsWith('http') ? whoisResult.registrarUrl : `https://${whoisResult.registrarUrl}`}
                          target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-[#00d4ff]/70 hover:text-[#00d4ff] mt-1 transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" />{whoisResult.registrarUrl}
                        </a>
                      )}
                    </div>
                  )}

                  {/* Criação */}
                  {whoisResult.createdDate && (
                    <div className="bg-white/3 rounded-xl p-3.5">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Calendar className="w-3.5 h-3.5 text-[#00ff88]" />
                        <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Criado em</span>
                      </div>
                      <p className="text-sm text-white font-medium mono">
                        {whoisResult.createdDate.split('T')[0]}
                      </p>
                    </div>
                  )}

                  {/* Expiração */}
                  {whoisResult.expiresDate && (() => {
                    const exp = new Date(whoisResult.expiresDate)
                    const daysLeft = Math.ceil((exp.getTime() - Date.now()) / 86400000)
                    const expired = daysLeft < 0
                    const soon = daysLeft >= 0 && daysLeft <= 30
                    return (
                      <div className={`bg-white/3 rounded-xl p-3.5 ${expired ? 'border border-red-500/30' : soon ? 'border border-amber-500/30' : ''}`}>
                        <div className="flex items-center gap-2 mb-1.5">
                          <Calendar className={`w-3.5 h-3.5 ${expired ? 'text-red-400' : soon ? 'text-amber-400' : 'text-gray-400'}`} />
                          <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Expira em</span>
                        </div>
                        <p className={`text-sm font-medium mono ${expired ? 'text-red-400' : soon ? 'text-amber-400' : 'text-white'}`}>
                          {whoisResult.expiresDate.split('T')[0]}
                        </p>
                        <p className={`text-xs mt-0.5 ${expired ? 'text-red-400' : soon ? 'text-amber-400' : 'text-gray-500'}`}>
                          {expired ? `Expirado há ${Math.abs(daysLeft)} dias` : `${daysLeft} dias restantes`}
                        </p>
                      </div>
                    )
                  })()}

                  {/* Última atualização */}
                  {whoisResult.updatedDate && (
                    <div className="bg-white/3 rounded-xl p-3.5">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Clock className="w-3.5 h-3.5 text-gray-500" />
                        <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Atualizado</span>
                      </div>
                      <p className="text-sm text-white mono">{whoisResult.updatedDate.split('T')[0]}</p>
                    </div>
                  )}

                  {/* País */}
                  {whoisResult.country && (
                    <div className="bg-white/3 rounded-xl p-3.5">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Globe className="w-3.5 h-3.5 text-gray-500" />
                        <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold">País</span>
                      </div>
                      <p className="text-sm text-white">{whoisResult.country}</p>
                    </div>
                  )}

                  {/* DNSSEC */}
                  {whoisResult.dnssec && (
                    <div className="bg-white/3 rounded-xl p-3.5">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Shield className="w-3.5 h-3.5 text-gray-500" />
                        <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold">DNSSEC</span>
                      </div>
                      <p className="text-sm text-white">{whoisResult.dnssec}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Name Servers */}
              {whoisResult.nameServers.length > 0 && (
                <div className="card p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Server className="w-4 h-4 text-[#00d4ff]" />
                    <h3 className="text-sm font-semibold text-white">Name Servers</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {whoisResult.nameServers.map(ns => (
                      <div key={ns} className="flex items-center gap-2 bg-white/3 rounded-lg px-3 py-2">
                        <ChevronRight className="w-3 h-3 text-[#00d4ff] shrink-0" />
                        <span className="text-sm text-gray-300 mono truncate">{ns.toLowerCase()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Raw WHOIS */}
              {whoisResult.raw && (
                <div className="card overflow-hidden">
                  <button
                    onClick={() => setWhoisRawOpen(p => !p)}
                    className="w-full flex items-center justify-between px-5 py-3.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
                  >
                    <span className="font-semibold">Resposta bruta (raw WHOIS)</span>
                    {whoisRawOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {whoisRawOpen && (
                    <pre className="px-5 pb-5 text-xs text-gray-500 mono whitespace-pre-wrap break-all leading-5 max-h-96 overflow-y-auto border-t border-white/5">
                      {whoisResult.raw}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}

          {!whoisResult && !whoisLoading && !whoisError && (
            <div className="card p-10 flex flex-col items-center gap-3 text-gray-600">
              <FileSearch className="w-10 h-10 opacity-30" />
              <p className="text-sm">Digite um domínio e clique em Consultar WHOIS</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
