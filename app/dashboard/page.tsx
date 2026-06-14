'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  Activity, Download, Upload, Globe, Wifi, Shield, Clock,
  RefreshCw, TrendingUp, TrendingDown, Minus, MapPin, Building
} from 'lucide-react'
import LatencyChart from '@/components/LatencyChart'
import StatCard from '@/components/StatCard'
import { latencyColor, latencyLabel, calcJitter, jitterColor, jitterLabel, formatSpeed } from '@/lib/utils'
import { loadSettings, AppSettings } from '@/lib/settings'
import clsx from 'clsx'

interface IPInfo {
  ip: string
  city?: string
  region?: string
  country?: string
  isp?: string
  asn?: string
  timezone?: string
}

interface LatencyPoint { t: number; latency: number }

export default function Dashboard() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [ipInfo, setIpInfo] = useState<IPInfo | null>(null)
  const [loadingIp, setLoadingIp] = useState(true)
  const [latencyData, setLatencyData] = useState<LatencyPoint[]>([])
  const [currentLatency, setCurrentLatency] = useState<number | null>(null)
  const [jitter, setJitter] = useState<number | null>(null)
  const [pingTarget, setPingTarget] = useState('self')
  const [pingRunning, setPingRunning] = useState(false)
  const [packetLoss, setPacketLoss] = useState(0)
  const [sentPackets, setSentPackets] = useState(0)
  const [lostPackets, setLostPackets] = useState(0)
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const latencyHistory = useRef<number[]>([])

  useEffect(() => {
    const s = loadSettings()
    setSettings(s)
    setPingTarget(s.pingTargets[0]?.host ?? 'self')
  }, [])

  useEffect(() => {
    const parse = (d: Record<string, unknown>) => ({
      ip: (d.ip ?? d.query) as string,
      city: (d.city) as string,
      region: (d.region ?? d.regionName) as string,
      country: (d.country ?? d.country_name) as string,
      isp: (d.org ?? d.isp) as string,
      asn: (d.asn ?? (d.org as string)?.split(' ')[0]) as string,
      timezone: ((d.timezone as Record<string,unknown>)?.id ?? d.timezone) as string,
    })

    fetch('https://ipwho.is/')
      .then(r => r.json())
      .then(d => { if (d.success === false) throw new Error('fail'); setIpInfo(parse(d)) })
      .catch(() =>
        fetch('https://ipinfo.io/json')
          .then(r => r.json())
          .then(d => { if (d.bogon) throw new Error('bogon'); setIpInfo(parse(d)) })
          .catch(() =>
            fetch('/api/ip-info')
              .then(r => r.json())
              .then(d => setIpInfo(d))
              .catch(() => {})
          )
      )
      .finally(() => setLoadingIp(false))
  }, [])

  const doPing = useCallback(async () => {
    const t0 = performance.now()
    try {
      let url: string
      if (pingTarget === 'self') {
        url = `/api/ping?_=${Date.now()}`
      } else if (pingTarget === '1.1.1.1') {
        url = `https://one.one.one.one/dns-query?name=a.test&type=A&_=${Date.now()}`
      } else if (pingTarget === '8.8.8.8') {
        url = `https://dns.google/dns-query?name=a.test&type=A&_=${Date.now()}`
      } else {
        url = `/api/speedtest/ping?target=${encodeURIComponent(pingTarget)}&_=${Date.now()}`
      }
      await fetch(url, { cache: 'no-store' })
      const latency = performance.now() - t0
      setSentPackets(s => s + 1)
      setCurrentLatency(latency)
      latencyHistory.current = [...latencyHistory.current.slice(-59), latency]
      setLatencyData(prev => [...prev.slice(-59), { t: Date.now(), latency }])
      if (latencyHistory.current.length >= 2) setJitter(calcJitter(latencyHistory.current))
    } catch {
      setSentPackets(s => s + 1)
      setLostPackets(l => l + 1)
    }
  }, [pingTarget])

  useEffect(() => {
    setPacketLoss(sentPackets > 0 ? (lostPackets / sentPackets) * 100 : 0)
  }, [sentPackets, lostPackets])

  const startPing = useCallback(() => {
    if (pingRef.current) clearInterval(pingRef.current)
    setSentPackets(0); setLostPackets(0)
    latencyHistory.current = []; setLatencyData([])
    setPingRunning(true)
    doPing()
    pingRef.current = setInterval(doPing, settings?.pingInterval ?? 1000)
  }, [doPing, settings?.pingInterval])

  const stopPing = useCallback(() => {
    if (pingRef.current) clearInterval(pingRef.current)
    setPingRunning(false)
  }, [])

  useEffect(() => {
    startPing()
    return () => { if (pingRef.current) clearInterval(pingRef.current) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const latColor = currentLatency ? latencyColor(currentLatency) : '#4a5568'
  const latLabel = currentLatency ? latencyLabel(currentLatency) : '—'

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="mb-6 md:mb-8">
        <h1 className="text-xl md:text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Monitoramento em tempo real da sua conexão</p>
      </div>

      <div className="card p-4 mb-6">
        {loadingIp ? (
          <div className="flex gap-3">
            {[80, 120, 160, 100].map(w => (
              <div key={w} className="h-8 bg-white/5 rounded animate-pulse" style={{ width: w }} />
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-[#00d4ff] shrink-0" />
              <span className="text-xs text-gray-500">IP</span>
              <span className="text-sm font-bold mono text-white">{ipInfo?.ip || '—'}</span>
            </div>
            <div className="w-px h-4 bg-white/10 hidden sm:block" />
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-gray-500 shrink-0" />
              <span className="text-sm text-gray-300">
                {ipInfo?.city || '—'}
                {ipInfo?.region ? `, ${ipInfo.region.replace(/^State of /, '').replace(/^Minas Gerais$/, 'MG').replace(/^São Paulo$/, 'SP').replace(/^Rio de Janeiro$/, 'RJ').replace(/^Paraná$/, 'PR').replace(/^Rio Grande do Sul$/, 'RS')}` : ''}
                {ipInfo?.country ? ` · ${ipInfo.country}` : ''}
              </span>
            </div>
            <div className="w-px h-4 bg-white/10 hidden sm:block" />
            <div className="flex items-center gap-2 min-w-0">
              <Building className="w-4 h-4 text-gray-500 shrink-0" />
              <span className="text-sm text-gray-300 truncate max-w-[200px]">
                {ipInfo?.isp ? ipInfo.isp.replace(/^AS\d+\s+/, '').replace(/\s+(Servicos?|Serviços?)\s+de\s+Telecomunicacoes?.*/i, '').replace(/\s+S\.A\.?$/i, '').trim() : '—'}
              </span>
              {ipInfo?.asn && <span className="tag tag-cyan shrink-0">{ipInfo.asn.split(' ')[0]}</span>}
            </div>
            <div className="w-px h-4 bg-white/10 hidden sm:block" />
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-gray-500 shrink-0" />
              <span className="text-sm text-gray-300">{ipInfo?.timezone?.replace('America/', '').replace('_', ' ') || '—'}</span>
            </div>
            <div className="w-full sm:w-auto mt-1 sm:mt-0 sm:ml-auto">
              <a href="/speedtest" className="btn-cyan px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2 w-full sm:w-auto justify-center">
                <Activity className="w-4 h-4" />Testar Velocidade
              </a>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Latência" value={currentLatency ? currentLatency.toFixed(1) : '—'} unit="ms" icon={Activity}
          color={currentLatency ? (currentLatency <= 50 ? 'cyan' : currentLatency <= 100 ? 'yellow' : 'red') : 'cyan'}
          tag={latLabel} tagColor={currentLatency ? (currentLatency <= 50 ? 'tag-cyan' : currentLatency <= 100 ? 'tag-yellow' : 'tag-red') : undefined} />
        <StatCard label="Jitter" value={jitter ? jitter.toFixed(1) : '—'} unit="ms" icon={TrendingUp}
          color={jitter ? (jitter <= 5 ? 'green' : jitter <= 15 ? 'cyan' : jitter <= 30 ? 'yellow' : 'red') : 'purple'}
          tag={jitter ? jitterLabel(jitter) : undefined} tagColor={jitter ? (jitter <= 5 ? 'tag-green' : jitter <= 15 ? 'tag-cyan' : 'tag-yellow') : undefined} />
        <StatCard label="Pacotes enviados" value={sentPackets} icon={Shield} color="purple" sub={`${lostPackets} perdidos`} />
        <StatCard label="Perda de pacotes" value={packetLoss.toFixed(1)} unit="%" icon={packetLoss > 0 ? TrendingDown : Minus}
          color={packetLoss === 0 ? 'green' : packetLoss < 1 ? 'yellow' : 'red'}
          tag={packetLoss === 0 ? 'Sem perda' : packetLoss < 1 ? 'Aceitável' : 'Crítico'}
          tagColor={packetLoss === 0 ? 'tag-green' : packetLoss < 1 ? 'tag-yellow' : 'tag-red'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-white">Monitor de Latência</h2>
              <p className="text-xs text-gray-500 mt-0.5">Últimas 60 medições</p>
            </div>
            <div className="flex items-center gap-2">
              <select value={pingTarget} onChange={e => setPingTarget(e.target.value)}
                className="bg-[#0a1128] border border-[#1a2744] text-gray-300 text-xs rounded-lg px-2 py-1.5 outline-none">
                {(settings?.pingTargets ?? []).map(t => <option key={t.host} value={t.host}>{t.label}</option>)}
              </select>
              <button onClick={pingRunning ? stopPing : startPing}
                className={clsx('px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5', pingRunning ? 'btn-purple' : 'btn-cyan')}>
                {pingRunning ? <><span className="w-2 h-2 rounded-sm bg-current" />Parar</> : <><RefreshCw className="w-3 h-3" />Iniciar</>}
              </button>
            </div>
          </div>
          {latencyData.length > 0 ? <LatencyChart data={latencyData} height={180} showGrid /> : (
            <div className="h-44 flex items-center justify-center text-gray-600 text-sm">Aguardando dados...</div>
          )}
        </div>

        <div className="card p-5 flex flex-col items-center justify-center">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">Latência Atual</div>
          <div className="text-6xl font-black mono mb-1 transition-colors" style={{ color: latColor, textShadow: `0 0 30px ${latColor}40` }}>
            {currentLatency ? currentLatency.toFixed(0) : '—'}
          </div>
          <div className="text-sm text-gray-400 mb-4">ms</div>
          <div className={clsx('tag', currentLatency ? (currentLatency <= 50 ? 'tag-cyan' : currentLatency <= 100 ? 'tag-yellow' : 'tag-red') : 'tag-cyan')}>{latLabel}</div>
          <div className="w-full mt-6 space-y-2">
            {[
              { label: 'Excelente', range: '< 20ms', color: '#00ff88', check: currentLatency !== null && currentLatency <= 20 },
              { label: 'Ótimo', range: '20–50ms', color: '#00d4ff', check: currentLatency !== null && currentLatency > 20 && currentLatency <= 50 },
              { label: 'Bom', range: '50–100ms', color: '#ffd700', check: currentLatency !== null && currentLatency > 50 && currentLatency <= 100 },
              { label: 'Ruim', range: '> 100ms', color: '#ff4d4d', check: currentLatency !== null && currentLatency > 100 },
            ].map(row => (
              <div key={row.label} className={clsx('flex items-center justify-between text-xs px-3 py-1.5 rounded-lg transition-all', row.check ? 'bg-white/5' : '')}>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: row.check ? row.color : '#1a2744' }} />
                  <span className={row.check ? 'text-white font-semibold' : 'text-gray-600'}>{row.label}</span>
                </div>
                <span className={row.check ? 'text-gray-400' : 'text-gray-700'}>{row.range}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
        {[
          { href: '/speedtest', icon: Activity, label: 'Teste de Velocidade', color: '#00d4ff', desc: 'Download, upload e ping' },
          { href: '/network', icon: Wifi, label: 'Análise de Rede', color: '#7b2fff', desc: 'Traceroute e DNS' },
          { href: '/devices', icon: Shield, label: 'Dispositivos', color: '#00ff88', desc: 'Scan e vulnerabilidades' },
          { href: '/security', icon: Shield, label: 'Segurança', color: '#ffd700', desc: 'SSL, DNS, Ameaças, IA' },
        ].map(({ href, icon: Icon, label, color, desc }) => (
          <a key={href} href={href} className="card p-4 hover:scale-[1.02] transition-all group cursor-pointer block">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: `${color}15`, border: `1px solid ${color}30` }}>
              <Icon className="w-5 h-5" style={{ color }} />
            </div>
            <p className="text-sm font-semibold text-white group-hover:text-[#00d4ff] transition-colors">{label}</p>
            <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
          </a>
        ))}
      </div>
    </div>
  )
}
