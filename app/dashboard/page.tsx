'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  Activity, Download, Upload, Globe, Wifi, Shield, Clock,
  RefreshCw, TrendingUp, TrendingDown, Minus, MapPin, Building, Network, Monitor
} from 'lucide-react'
import LatencyChart from '@/components/LatencyChart'
import StatCard from '@/components/StatCard'
import { latencyColor, latencyLabel, calcJitter, jitterColor, jitterLabel, formatSpeed } from '@/lib/utils'
import { loadSettings, AppSettings } from '@/lib/settings'
import { checkAlerts, requestNotificationPermission } from '@/lib/alerts'

const LAST_RUN_KEY = 'myspeed_auto_speedtest_last'
function getLastAutoRun(): number {
  try { return Number(localStorage.getItem(LAST_RUN_KEY) ?? 0) } catch { return 0 }
}
import clsx from 'clsx'

interface IfaceStats {
  name: string
  rxBytes: number
  txBytes: number
  mac?: string
  ipv4?: string
}

interface IfacePoint { t: number; rx: number; tx: number }

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

  // auto speedtest badge
  const [lastAutoRun,    setLastAutoRun]    = useState(0)
  const [autoRunning,    setAutoRunning]    = useState(false)

  // health summary
  const [wifiScore24, setWifiScore24] = useState<number | null>(null)
  const [wifiScore5,  setWifiScore5]  = useState<number | null>(null)
  const [devicesCount, setDevicesCount] = useState<number | null>(null)
  const [lastAlertMsg, setLastAlertMsg] = useState<string | null>(null)
  const [lastAlertTs,  setLastAlertTs]  = useState<number | null>(null)

  useEffect(() => {
    // último scan WiFi
    fetch('/api/history/wifi?limit=1')
      .then(r => r.json())
      .then(d => {
        const row = d.rows?.[0]
        if (row) {
          setWifiScore24(row.band24_score ?? null)
          setWifiScore5(row.band5_score ?? null)
        }
      })
      .catch(() => {})
    // dispositivos conhecidos
    fetch('/api/devices/known')
      .then(r => r.json())
      .then(d => setDevicesCount(d.rows?.length ?? 0))
      .catch(() => {})
    // último alerta
    fetch('/api/history/alerts?limit=1')
      .then(r => r.json())
      .then(d => {
        const row = d.rows?.[0]
        if (row) { setLastAlertMsg(row.message); setLastAlertTs(row.ts) }
      })
      .catch(() => {})
  }, [])

  // interface monitor
  const [ifaces,       setIfaces]       = useState<IfaceStats[]>([])
  const [selIface,     setSelIface]     = useState<string>('')
  const [ifacePoints,  setIfacePoints]  = useState<IfacePoint[]>([])
  const [ifaceRx,      setIfaceRx]      = useState(0)   // bps atual
  const [ifaceTx,      setIfaceTx]      = useState(0)
  const prevIfaceRef   = useRef<{ ts: number; rx: number; tx: number } | null>(null)
  const ifaceTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null)

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
      // self e IPs conhecidos usam ICMP server-side via /api/ping para precisão real
      const useIcmp = pingTarget === 'self' || pingTarget === '8.8.8.8' || pingTarget === '1.1.1.1'
      let latency: number

      if (useIcmp) {
        const target = pingTarget === 'self' ? '8.8.8.8' : pingTarget
        const res  = await fetch(`/api/ping?target=${target}&_=${Date.now()}`, { cache: 'no-store' })
        const data = await res.json()
        if (data.ms < 0) throw new Error('timeout')
        latency = data.ms
      } else {
        const url = `/api/speedtest/ping?target=${encodeURIComponent(pingTarget)}&_=${Date.now()}`
        await fetch(url, { cache: 'no-store' })
        latency = performance.now() - t0
      }

      setSentPackets(s => s + 1)
      setCurrentLatency(latency)
      latencyHistory.current = [...latencyHistory.current.slice(-59), latency]
      setLatencyData(prev => [...prev.slice(-59), { t: Date.now(), latency }])
      if (latencyHistory.current.length >= 2) setJitter(calcJitter(latencyHistory.current))

      // verificar limiares de alerta
      const s = loadSettings()
      const loss = sentPackets > 0 ? (lostPackets / sentPackets) * 100 : 0
      checkAlerts(s.alerts, { pingMs: latency, packetLossPct: loss })
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
    requestNotificationPermission()
    return () => { if (pingRef.current) clearInterval(pingRef.current) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // atualiza badge do último teste automático a cada 30s
  useEffect(() => {
    const tick = () => {
      setLastAutoRun(getLastAutoRun())
      // detecta se auto-teste está rodando checando se mudou nos últimos 15s
      const last = getLastAutoRun()
      setAutoRunning(last > 0 && Date.now() - last < 15_000)
    }
    tick()
    const id = setInterval(tick, 30_000)
    window.addEventListener('myspeed-settings-changed', tick)
    return () => { clearInterval(id); window.removeEventListener('myspeed-settings-changed', tick) }
  }, [])

  // carrega lista de interfaces uma vez
  useEffect(() => {
    fetch('/api/interfaces')
      .then(r => r.json())
      .then(d => {
        if (d.ifaces?.length) {
          setIfaces(d.ifaces)
          setSelIface(d.ifaces[0].name)
        }
      })
      .catch(() => {})
  }, [])

  // polling de stats da interface selecionada
  useEffect(() => {
    if (!selIface) return
    prevIfaceRef.current = null
    setIfacePoints([])
    setIfaceRx(0); setIfaceTx(0)

    const poll = () => {
      fetch('/api/interfaces')
        .then(r => r.json())
        .then(d => {
          const iface = (d.ifaces as IfaceStats[]).find(i => i.name === selIface)
          if (!iface) return
          const now = d.ts as number
          const prev = prevIfaceRef.current
          if (prev) {
            const dt  = (now - prev.ts) / 1000
            const rx  = Math.round((iface.rxBytes - prev.rx) / dt)
            const tx  = Math.round((iface.txBytes - prev.tx) / dt)
            setIfaceRx(Math.max(0, rx))
            setIfaceTx(Math.max(0, tx))
            setIfacePoints(p => [...p.slice(-59), { t: now, rx: Math.max(0, rx), tx: Math.max(0, tx) }])
          }
          prevIfaceRef.current = { ts: now, rx: iface.rxBytes, tx: iface.txBytes }
        })
        .catch(() => {})
    }

    poll()
    if (ifaceTimerRef.current) clearInterval(ifaceTimerRef.current)
    ifaceTimerRef.current = setInterval(poll, 1000)
    return () => { if (ifaceTimerRef.current) clearInterval(ifaceTimerRef.current) }
  }, [selIface])

  const latColor = currentLatency ? latencyColor(currentLatency) : '#4a5568'
  const latLabel = currentLatency ? latencyLabel(currentLatency) : '—'

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="mb-6 md:mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Monitoramento em tempo real da sua conexão</p>
        </div>
        {loadSettings().autoSpeedtest > 0 && (
          <div className={clsx('flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs shrink-0', autoRunning ? 'bg-cyan-500/10 border-cyan-500/30 text-[#00d4ff]' : 'bg-white/5 border-white/10 text-gray-500')}>
            <span className={clsx('w-1.5 h-1.5 rounded-full', autoRunning ? 'bg-[#00d4ff] animate-pulse' : 'bg-gray-600')} />
            {autoRunning
              ? 'Teste automático em andamento…'
              : lastAutoRun > 0
              ? `Último auto-teste: ${new Date(lastAutoRun).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
              : `Auto-teste a cada ${loadSettings().autoSpeedtest}h`}
          </div>
        )}
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

      {/* Health summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* WiFi 2.4 */}
        <div className="card p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: wifiScore24 == null ? '#1a2744' : wifiScore24 >= 70 ? '#00ff8820' : wifiScore24 >= 40 ? '#ffd70020' : '#ff4d4d20' }}>
            <Wifi className="w-4 h-4" style={{ color: wifiScore24 == null ? '#4a5568' : wifiScore24 >= 70 ? '#00ff88' : wifiScore24 >= 40 ? '#ffd700' : '#ff4d4d' }} />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-gray-500">WiFi 2.4GHz</p>
            <p className="text-lg font-black mono" style={{ color: wifiScore24 == null ? '#4a5568' : wifiScore24 >= 70 ? '#00ff88' : wifiScore24 >= 40 ? '#ffd700' : '#ff4d4d' }}>
              {wifiScore24 != null ? `${wifiScore24}/100` : '—'}
            </p>
            <p className="text-xs text-gray-600">{wifiScore24 == null ? 'Sem scan' : wifiScore24 >= 70 ? 'Ótimo' : wifiScore24 >= 40 ? 'Regular' : 'Ruim'}</p>
          </div>
        </div>
        {/* WiFi 5 */}
        <div className="card p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: wifiScore5 == null ? '#1a2744' : wifiScore5 >= 70 ? '#00ff8820' : wifiScore5 >= 40 ? '#ffd70020' : '#ff4d4d20' }}>
            <Wifi className="w-4 h-4" style={{ color: wifiScore5 == null ? '#4a5568' : wifiScore5 >= 70 ? '#00ff88' : wifiScore5 >= 40 ? '#ffd700' : '#ff4d4d' }} />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-gray-500">WiFi 5GHz</p>
            <p className="text-lg font-black mono" style={{ color: wifiScore5 == null ? '#4a5568' : wifiScore5 >= 70 ? '#00ff88' : wifiScore5 >= 40 ? '#ffd700' : '#ff4d4d' }}>
              {wifiScore5 != null ? `${wifiScore5}/100` : '—'}
            </p>
            <p className="text-xs text-gray-600">{wifiScore5 == null ? 'Sem scan' : wifiScore5 >= 70 ? 'Ótimo' : wifiScore5 >= 40 ? 'Regular' : 'Ruim'}</p>
          </div>
        </div>
        {/* Dispositivos */}
        <div className="card p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-purple-500/10">
            <Monitor className="w-4 h-4 text-purple-400" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-gray-500">Dispositivos</p>
            <p className="text-lg font-black mono text-purple-400">{devicesCount ?? '—'}</p>
            <p className="text-xs text-gray-600">{devicesCount == null ? 'Sem scan' : devicesCount === 0 ? 'Nenhum mapeado' : 'conhecidos'}</p>
          </div>
        </div>
        {/* Último alerta */}
        <div className="card p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: lastAlertTs ? '#ff4d4d20' : '#1a2744' }}>
            <Shield className="w-4 h-4" style={{ color: lastAlertTs ? '#ff4d4d' : '#4a5568' }} />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-gray-500">Último alerta</p>
            <p className="text-sm font-semibold text-red-400 truncate">{lastAlertTs ? new Date(lastAlertTs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}</p>
            <p className="text-xs text-gray-600 truncate max-w-[120px]">{lastAlertMsg ?? 'Nenhum alerta'}</p>
          </div>
        </div>
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

      {/* Monitor de Interface */}
      <div className="card p-5 mt-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Network className="w-4 h-4 text-[#7b2fff]" />
            <h2 className="text-sm font-semibold text-white">Monitor de Interface</h2>
          </div>
          <select
            value={selIface}
            onChange={e => setSelIface(e.target.value)}
            className="bg-[#0a1128] border border-[#1a2744] text-gray-300 text-xs rounded-lg px-2 py-1.5 outline-none"
          >
            {ifaces.map(i => (
              <option key={i.name} value={i.name}>
                {i.name}{i.ipv4 ? ` — ${i.ipv4}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="bg-white/5 rounded-xl p-3 flex items-center gap-3">
            <Download className="w-5 h-5 text-[#00d4ff] shrink-0" />
            <div>
              <p className="text-xs text-gray-500">Download</p>
              <p className="text-lg font-bold mono" style={{ color: '#00d4ff' }}>
                {ifaceRx >= 1_000_000
                  ? (ifaceRx / 1_000_000).toFixed(1) + ' MB/s'
                  : ifaceRx >= 1_000
                  ? (ifaceRx / 1_000).toFixed(0) + ' KB/s'
                  : ifaceRx + ' B/s'}
              </p>
            </div>
          </div>
          <div className="bg-white/5 rounded-xl p-3 flex items-center gap-3">
            <Upload className="w-5 h-5 text-[#00ff88] shrink-0" />
            <div>
              <p className="text-xs text-gray-500">Upload</p>
              <p className="text-lg font-bold mono" style={{ color: '#00ff88' }}>
                {ifaceTx >= 1_000_000
                  ? (ifaceTx / 1_000_000).toFixed(1) + ' MB/s'
                  : ifaceTx >= 1_000
                  ? (ifaceTx / 1_000).toFixed(0) + ' KB/s'
                  : ifaceTx + ' B/s'}
              </p>
            </div>
          </div>
        </div>

        {/* Mini gráfico de barras */}
        {ifacePoints.length > 1 ? (
          <div className="flex items-end gap-px h-16">
            {ifacePoints.map((p, i) => {
              const maxVal = Math.max(...ifacePoints.map(x => Math.max(x.rx, x.tx)), 1)
              return (
                <div key={i} className="flex-1 flex flex-col justify-end gap-px h-full">
                  <div className="rounded-sm" style={{ height: `${(p.tx / maxVal) * 100}%`, background: '#00ff8866', minHeight: 1 }} />
                  <div className="rounded-sm" style={{ height: `${(p.rx / maxVal) * 100}%`, background: '#00d4ff66', minHeight: 1 }} />
                </div>
              )
            })}
          </div>
        ) : (
          <div className="h-16 flex items-center justify-center text-gray-600 text-xs">Coletando dados...</div>
        )}
        <div className="flex gap-4 mt-2">
          <span className="flex items-center gap-1 text-xs text-gray-500"><span className="w-2 h-2 rounded-sm bg-[#00d4ff66]" />Download</span>
          <span className="flex items-center gap-1 text-xs text-gray-500"><span className="w-2 h-2 rounded-sm bg-[#00ff8866]" />Upload</span>
          {ifaces.find(i => i.name === selIface)?.mac && (
            <span className="text-xs text-gray-600 ml-auto mono">{ifaces.find(i => i.name === selIface)?.mac}</span>
          )}
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
