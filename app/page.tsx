'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  Activity, Download, Upload, Globe, Wifi, Shield, Clock,
  RefreshCw, TrendingUp, TrendingDown, Minus, MapPin, Building
} from 'lucide-react'
import LatencyChart from '@/components/LatencyChart'
import StatCard from '@/components/StatCard'
import { latencyColor, latencyLabel, calcJitter, jitterColor, jitterLabel, formatSpeed } from '@/lib/utils'
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

const PING_TARGETS = [
  { label: 'Cloudflare', host: '1.1.1.1' },
  { label: 'Google', host: '8.8.8.8' },
  { label: 'Este servidor', host: 'self' },
]

export default function Dashboard() {
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
    fetch('https://ipwho.is/')
      .then(r => r.json())
      .then(d => setIpInfo({
        ip: d.ip,
        city: d.city,
        region: d.region,
        country: d.country,
        isp: d.connection?.isp || d.connection?.org,
        asn: d.connection?.asn ? `AS${d.connection.asn}` : undefined,
        timezone: d.timezone?.id,
      }))
      .catch(() => {})
      .finally(() => setLoadingIp(false))
  }, [])

  const doPing = useCallback(async () => {
    const t0 = performance.now()
    try {
      const url = pingTarget === 'self'
        ? '/api/ping'
        : `https://${pingTarget === '1.1.1.1' ? 'one.one.one.one' : 'dns.google'}/dns-query?name=a.test&type=A`
      await fetch(url + `?_=${Date.now()}`, { cache: 'no-store' })
      const latency = performance.now() - t0

      setSentPackets(s => s + 1)
      setCurrentLatency(latency)
      latencyHistory.current = [...latencyHistory.current.slice(-59), latency]
      setLatencyData(prev => [
        ...prev.slice(-59),
        { t: Date.now(), latency }
      ])
      if (latencyHistory.current.length >= 2) {
        setJitter(calcJitter(latencyHistory.current))
      }
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
    setSentPackets(0)
    setLostPackets(0)
    latencyHistory.current = []
    setLatencyData([])
    setPingRunning(true)
    doPing()
    pingRef.current = setInterval(doPing, 1000)
  }, [doPing])

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
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Monitoramento em tempo real da sua conexão</p>
      </div>

      {/* IP Info Banner */}
      <div className="card p-4 mb-6 flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
            <Globe className="w-5 h-5 text-[#00d4ff]" />
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider">IP Público</p>
            {loadingIp ? (
              <div className="h-5 w-28 bg-white/5 rounded animate-pulse mt-0.5" />
            ) : (
              <p className="text-base font-bold mono text-white">{ipInfo?.ip || '—'}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <MapPin className="w-4 h-4 text-gray-500" />
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Localização</p>
            <p className="text-sm text-gray-300">
              {ipInfo ? `${ipInfo.city || '—'}, ${ipInfo.region || ''} ${ipInfo.country || ''}` : '—'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Building className="w-4 h-4 text-gray-500" />
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider">ISP / ASN</p>
            <p className="text-sm text-gray-300">{ipInfo?.isp || '—'}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Clock className="w-4 h-4 text-gray-500" />
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Fuso Horário</p>
            <p className="text-sm text-gray-300">{ipInfo?.timezone || '—'}</p>
          </div>
        </div>
        <div className="ml-auto">
          <a href="/speedtest" className="btn-cyan px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Testar Velocidade
          </a>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Latência"
          value={currentLatency ? currentLatency.toFixed(1) : '—'}
          unit="ms"
          icon={Activity}
          color={currentLatency ? (currentLatency <= 50 ? 'cyan' : currentLatency <= 100 ? 'yellow' : 'red') : 'cyan'}
          tag={latLabel}
          tagColor={currentLatency ? (currentLatency <= 50 ? 'tag-cyan' : currentLatency <= 100 ? 'tag-yellow' : 'tag-red') : undefined}
        />
        <StatCard
          label="Jitter"
          value={jitter ? jitter.toFixed(1) : '—'}
          unit="ms"
          icon={TrendingUp}
          color={jitter ? (jitter <= 5 ? 'green' : jitter <= 15 ? 'cyan' : jitter <= 30 ? 'yellow' : 'red') : 'purple'}
          tag={jitter ? jitterLabel(jitter) : undefined}
          tagColor={jitter ? (jitter <= 5 ? 'tag-green' : jitter <= 15 ? 'tag-cyan' : 'tag-yellow') : undefined}
        />
        <StatCard
          label="Pacotes enviados"
          value={sentPackets}
          icon={Shield}
          color="purple"
          sub={`${lostPackets} perdidos`}
        />
        <StatCard
          label="Perda de pacotes"
          value={packetLoss.toFixed(1)}
          unit="%"
          icon={packetLoss > 0 ? TrendingDown : Minus}
          color={packetLoss === 0 ? 'green' : packetLoss < 1 ? 'yellow' : 'red'}
          tag={packetLoss === 0 ? 'Sem perda' : packetLoss < 1 ? 'Aceitável' : 'Crítico'}
          tagColor={packetLoss === 0 ? 'tag-green' : packetLoss < 1 ? 'tag-yellow' : 'tag-red'}
        />
      </div>

      {/* Latency Monitor */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-white">Monitor de Latência</h2>
              <p className="text-xs text-gray-500 mt-0.5">Últimas 60 medições</p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={pingTarget}
                onChange={e => { setPingTarget(e.target.value); }}
                className="bg-[#0a1128] border border-[#1a2744] text-gray-300 text-xs rounded-lg px-2 py-1.5 outline-none"
              >
                {PING_TARGETS.map(t => (
                  <option key={t.host} value={t.host}>{t.label}</option>
                ))}
              </select>
              <button
                onClick={pingRunning ? stopPing : startPing}
                className={clsx('px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5',
                  pingRunning ? 'btn-purple' : 'btn-cyan')}
              >
                {pingRunning ? (
                  <><span className="w-2 h-2 rounded-sm bg-current" />Parar</>
                ) : (
                  <><RefreshCw className="w-3 h-3" />Iniciar</>
                )}
              </button>
            </div>
          </div>

          {latencyData.length > 0 ? (
            <LatencyChart data={latencyData} height={180} showGrid />
          ) : (
            <div className="h-44 flex items-center justify-center text-gray-600 text-sm">
              Aguardando dados...
            </div>
          )}
        </div>

        {/* Current Latency Big Display */}
        <div className="card p-5 flex flex-col items-center justify-center">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">Latência Atual</div>
          <div
            className="text-6xl font-black mono mb-1 transition-colors"
            style={{ color: latColor, textShadow: `0 0 30px ${latColor}40` }}
          >
            {currentLatency ? currentLatency.toFixed(0) : '—'}
          </div>
          <div className="text-sm text-gray-400 mb-4">ms</div>
          <div className={clsx('tag', currentLatency ? (currentLatency <= 50 ? 'tag-cyan' : currentLatency <= 100 ? 'tag-yellow' : 'tag-red') : 'tag-cyan')}>
            {latLabel}
          </div>

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

      {/* Quick Links */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
        {[
          { href: '/speedtest', icon: Gauge, label: 'Teste de Velocidade', color: '#00d4ff', desc: 'Download, upload e ping' },
          { href: '/network', icon: Activity, label: 'Análise de Rede', color: '#7b2fff', desc: 'Traceroute e DNS' },
          { href: '/wifi', icon: Wifi, label: 'Analisador WiFi', color: '#00ff88', desc: 'Canais 2.4 e 5 GHz' },
          { href: '/controllers', icon: Shield, label: 'Controladores', color: '#ffd700', desc: 'UniFi e MikroTik' },
        ].map(({ href, icon: Icon, label, color, desc }) => (
          <a
            key={href}
            href={href}
            className="card p-4 hover:scale-[1.02] transition-all group cursor-pointer block"
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
              style={{ background: `${color}15`, border: `1px solid ${color}30` }}>
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

function Gauge({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a10 10 0 0 1 7.38 16.75" />
      <path d="M12 2a10 10 0 0 0-7.38 16.75" />
      <path d="M12 22v-4" />
      <path d="m15.5 8.5-3.5 5" />
    </svg>
  )
}
