'use client'

import { useState, useEffect } from 'react'
import {
  Server, Wifi, Cpu, Activity, Users, Network,
  CheckCircle, AlertCircle, Loader2, Eye, EyeOff,
  RefreshCw, Radio, HardDrive, Thermometer, Zap
} from 'lucide-react'
import clsx from 'clsx'

type Controller = 'unifi' | 'mikrotik'

interface UnifiDevice {
  name: string
  ip: string
  mac: string
  model: string
  state: number
  uptime: number
  tx_bytes?: number
  rx_bytes?: number
  num_sta?: number
  radio_table_stats?: Array<{ radio: string; num_sta: number; channel: number }>
}

interface UnifiClient {
  hostname?: string
  ip: string
  mac: string
  rssi?: number
  tx_rate?: number
  rx_rate?: number
  essid?: string
  channel?: number
  is_wired: boolean
  uptime: number
}

interface MtInterface {
  name: string
  type: string
  running: boolean
  'tx-byte': string
  'rx-byte': string
  'tx-rate'?: string
  'rx-rate'?: string
  comment?: string
  disabled: boolean
}

interface MtResource {
  'cpu-load': string
  'free-memory': string
  'total-memory': string
  uptime: string
  version: string
  'board-name': string
  platform: string
  'cpu-frequency': string
}

interface MtWirelessClient {
  interface: string
  mac_address: string
  ssid?: string
  signal_strength: string
  tx_rate?: string
  rx_rate?: string
  uptime?: string
}

function formatUptime(s: number): string {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatBytes(b: number): string {
  if (b > 1e9) return `${(b / 1e9).toFixed(1)} GB`
  if (b > 1e6) return `${(b / 1e6).toFixed(1)} MB`
  return `${(b / 1e3).toFixed(1)} KB`
}

export default function ControllersPage() {
  const [tab, setTab] = useState<Controller>('unifi')

  // UniFi state
  const [unifiUrl, setUnifiUrl] = useState('')
  const [unifiUser, setUnifiUser] = useState('admin')
  const [unifiPass, setUnifiPass] = useState('')
  const [unifiSite, setUnifiSite] = useState('default')
  const [unifiConnected, setUnifiConnected] = useState(false)
  const [unifiLoading, setUnifiLoading] = useState(false)
  const [unifiError, setUnifiError] = useState('')
  const [unifiDevices, setUnifiDevices] = useState<UnifiDevice[]>([])
  const [unifiClients, setUnifiClients] = useState<UnifiClient[]>([])
  const [unifiView, setUnifiView] = useState<'devices' | 'clients' | 'wlan'>('devices')

  // MikroTik state
  const [mtUrl, setMtUrl] = useState('')
  const [mtUser, setMtUser] = useState('admin')
  const [mtPass, setMtPass] = useState('')
  const [mtConnected, setMtConnected] = useState(false)
  const [mtLoading, setMtLoading] = useState(false)
  const [mtError, setMtError] = useState('')
  const [mtResource, setMtResource] = useState<MtResource | null>(null)
  const [mtInterfaces, setMtInterfaces] = useState<MtInterface[]>([])
  const [mtClients, setMtClients] = useState<MtWirelessClient[]>([])
  const [mtView, setMtView] = useState<'overview' | 'interfaces' | 'wireless'>('overview')

  const [showPass, setShowPass] = useState({ unifi: false, mt: false })

  // Persist credentials (session only — sessionStorage)
  useEffect(() => {
    const saved = sessionStorage.getItem('unifi_creds')
    if (saved) { const p = JSON.parse(saved); setUnifiUrl(p.url); setUnifiUser(p.user); setUnifiSite(p.site || 'default') }
    const saved2 = sessionStorage.getItem('mt_creds')
    if (saved2) { const p = JSON.parse(saved2); setMtUrl(p.url); setMtUser(p.user) }
  }, [])

  async function unifiCall(action: string) {
    const res = await fetch('/api/unifi/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ controllerUrl: unifiUrl, username: unifiUser, password: unifiPass, site: unifiSite, action }),
    })
    return res.json()
  }

  async function connectUnifi() {
    setUnifiLoading(true)
    setUnifiError('')
    try {
      const healthData = await unifiCall('health')
      if (!healthData.ok) throw new Error(healthData.error || 'Falha na conexão')
      const devData = await unifiCall('devices')
      const cliData = await unifiCall('clients')
      setUnifiDevices(devData.data?.data || [])
      setUnifiClients(cliData.data?.data || [])
      setUnifiConnected(true)
      sessionStorage.setItem('unifi_creds', JSON.stringify({ url: unifiUrl, user: unifiUser, site: unifiSite }))
    } catch (e: unknown) {
      setUnifiError(e instanceof Error ? e.message : 'Erro de conexão')
    } finally {
      setUnifiLoading(false)
    }
  }

  async function refreshUnifi() {
    setUnifiLoading(true)
    try {
      const devData = await unifiCall('devices')
      const cliData = await unifiCall('clients')
      setUnifiDevices(devData.data?.data || [])
      setUnifiClients(cliData.data?.data || [])
    } finally {
      setUnifiLoading(false)
    }
  }

  async function mtCall(action: string) {
    const res = await fetch('/api/mikrotik/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ controllerUrl: mtUrl, username: mtUser, password: mtPass, action }),
    })
    return res.json()
  }

  async function connectMikroTik() {
    setMtLoading(true)
    setMtError('')
    try {
      const identityData = await mtCall('identity')
      if (!identityData.ok) throw new Error(identityData.error || 'Falha na conexão')
      const [resData, ifData, wifiData] = await Promise.all([
        mtCall('resources'),
        mtCall('interfaces'),
        mtCall('wireless_clients').catch(() => ({ ok: true, data: [] })),
      ])
      setMtResource(resData.data)
      setMtInterfaces(ifData.data || [])
      setMtClients(wifiData.data || [])
      setMtConnected(true)
      sessionStorage.setItem('mt_creds', JSON.stringify({ url: mtUrl, user: mtUser }))
    } catch (e: unknown) {
      setMtError(e instanceof Error ? e.message : 'Erro de conexão')
    } finally {
      setMtLoading(false)
    }
  }

  async function refreshMikroTik() {
    setMtLoading(true)
    try {
      const [resData, ifData] = await Promise.all([mtCall('resources'), mtCall('interfaces')])
      setMtResource(resData.data)
      setMtInterfaces(ifData.data || [])
    } finally {
      setMtLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Controladores</h1>
        <p className="text-sm text-gray-500 mt-1">Conecte ao UniFi Controller ou MikroTik para análise em tempo real</p>
      </div>

      <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-4 py-3 mb-6 flex items-start gap-3">
        <AlertCircle className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
        <p className="text-xs text-yellow-300">
          O controlador precisa estar acessível a partir do servidor Vercel (internet). Para controladores locais, execute a aplicação com <code className="mono bg-yellow-500/10 px-1 rounded">npm run dev</code> na sua rede.
        </p>
      </div>

      {/* Tab Selector */}
      <div className="flex gap-1 mb-6 bg-[#0a1128] rounded-xl p-1 border border-[#1a2744] w-fit">
        {([
          { id: 'unifi', icon: Wifi, label: 'UniFi Controller' },
          { id: 'mikrotik', icon: Server, label: 'MikroTik RouterOS' },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={clsx('flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all',
              tab === t.id ? 'bg-[#1a2744] text-white' : 'text-gray-500 hover:text-gray-300')}>
            <t.icon className="w-4 h-4" />{t.label}
          </button>
        ))}
      </div>

      {/* UNIFI */}
      {tab === 'unifi' && (
        <div className="space-y-4">
          {!unifiConnected ? (
            <div className="card p-6 max-w-lg">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                  <Wifi className="w-5 h-5 text-[#00d4ff]" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Conectar ao UniFi</h2>
                  <p className="text-xs text-gray-500">UniFi Network Controller v6+</p>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">URL do Controlador</label>
                  <input className="dark-input" placeholder="https://192.168.1.1:8443" value={unifiUrl} onChange={e => setUnifiUrl(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Usuário</label>
                    <input className="dark-input" value={unifiUser} onChange={e => setUnifiUser(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Senha</label>
                    <div className="relative">
                      <input className="dark-input pr-8" type={showPass.unifi ? 'text' : 'password'} value={unifiPass} onChange={e => setUnifiPass(e.target.value)} />
                      <button onClick={() => setShowPass(p => ({ ...p, unifi: !p.unifi }))} className="absolute right-2 top-2 text-gray-500 hover:text-gray-300">
                        {showPass.unifi ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Site</label>
                  <input className="dark-input" placeholder="default" value={unifiSite} onChange={e => setUnifiSite(e.target.value)} />
                </div>

                {unifiError && (
                  <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 rounded-lg px-3 py-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {unifiError}
                  </div>
                )}

                <button onClick={connectUnifi} disabled={unifiLoading || !unifiUrl || !unifiPass}
                  className="btn-cyan w-full py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                  {unifiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  {unifiLoading ? 'Conectando...' : 'Conectar'}
                </button>
              </div>
            </div>
          ) : (
            <div>
              {/* Connected Header */}
              <div className="card p-4 mb-4 flex items-center gap-4">
                <div className="w-2 h-2 rounded-full bg-[#00ff88] glow-green" />
                <span className="text-sm text-white font-semibold">Conectado: {unifiUrl}</span>
                <div className="flex items-center gap-4 ml-auto">
                  <span className="text-xs text-gray-500">{unifiDevices.length} dispositivos • {unifiClients.length} clientes</span>
                  <button onClick={refreshUnifi} disabled={unifiLoading}
                    className="btn-cyan px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5">
                    {unifiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    Atualizar
                  </button>
                  <button onClick={() => { setUnifiConnected(false); setUnifiDevices([]); setUnifiClients([]) }}
                    className="text-gray-500 hover:text-gray-300 text-xs">Desconectar</button>
                </div>
              </div>

              {/* Sub-tabs */}
              <div className="flex gap-1 mb-4 w-fit">
                {(['devices', 'clients', 'wlan'] as const).map(v => (
                  <button key={v} onClick={() => setUnifiView(v)}
                    className={clsx('px-4 py-1.5 rounded-lg text-xs font-semibold transition-all',
                      unifiView === v ? 'bg-[#1a2744] text-white' : 'text-gray-500 hover:text-gray-300')}>
                    {v === 'devices' ? `APs (${unifiDevices.length})` : v === 'clients' ? `Clientes (${unifiClients.length})` : 'WLANs'}
                  </button>
                ))}
              </div>

              {unifiView === 'devices' && (
                <div className="grid gap-3">
                  {unifiDevices.map((d, i) => (
                    <div key={i} className="card p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className={clsx('w-9 h-9 rounded-lg flex items-center justify-center', d.state === 1 ? 'bg-green-500/10 border border-green-500/20' : 'bg-red-500/10 border border-red-500/20')}>
                            <Radio className={clsx('w-4 h-4', d.state === 1 ? 'text-[#00ff88]' : 'text-[#ff4d4d]')} />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-white">{d.name || d.mac}</p>
                            <p className="text-xs text-gray-500">{d.model} • {d.ip}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={clsx('tag', d.state === 1 ? 'tag-green' : 'tag-red')}>
                            {d.state === 1 ? 'Online' : 'Offline'}
                          </span>
                          {d.num_sta !== undefined && <span className="tag tag-cyan"><Users className="w-3 h-3" />{d.num_sta}</span>}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-3 text-xs">
                        <div>
                          <p className="text-gray-500 mb-0.5">Uptime</p>
                          <p className="text-white mono">{formatUptime(d.uptime || 0)}</p>
                        </div>
                        {d.tx_bytes !== undefined && (
                          <div>
                            <p className="text-gray-500 mb-0.5">TX Total</p>
                            <p className="text-[#7b2fff] mono">{formatBytes(d.tx_bytes)}</p>
                          </div>
                        )}
                        {d.rx_bytes !== undefined && (
                          <div>
                            <p className="text-gray-500 mb-0.5">RX Total</p>
                            <p className="text-[#00d4ff] mono">{formatBytes(d.rx_bytes)}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {unifiDevices.length === 0 && <p className="text-gray-600 text-sm">Nenhum dispositivo encontrado</p>}
                </div>
              )}

              {unifiView === 'clients' && (
                <div className="card overflow-hidden">
                  <div className="grid grid-cols-12 px-4 py-2 border-b border-[#1a2744] text-xs text-gray-500 uppercase tracking-wider font-semibold">
                    <span className="col-span-3">Host</span>
                    <span className="col-span-2">IP</span>
                    <span className="col-span-2">MAC</span>
                    <span className="col-span-2">SSID</span>
                    <span className="col-span-1 text-right">Sinal</span>
                    <span className="col-span-2 text-right">Uptime</span>
                  </div>
                  {unifiClients.slice(0, 50).map((c, i) => (
                    <div key={i} className="grid grid-cols-12 px-4 py-2.5 border-b border-[#1a2744]/40 text-xs hover:bg-white/2">
                      <span className="col-span-3 text-gray-300 truncate">{c.hostname || '—'}</span>
                      <span className="col-span-2 mono text-gray-400 truncate">{c.ip}</span>
                      <span className="col-span-2 mono text-gray-600 text-[10px] truncate">{c.mac}</span>
                      <span className="col-span-2 truncate">
                        {c.is_wired
                          ? <span className="tag tag-cyan">Cabeado</span>
                          : <span className="text-gray-400">{c.essid || '—'}</span>
                        }
                      </span>
                      <span className="col-span-1 text-right mono" style={{ color: c.rssi ? (c.rssi > -60 ? '#00ff88' : c.rssi > -75 ? '#ffd700' : '#ff4d4d') : '#4a5568' }}>
                        {c.rssi !== undefined ? `${c.rssi}` : '—'}
                      </span>
                      <span className="col-span-2 text-right text-gray-500">{formatUptime(c.uptime || 0)}</span>
                    </div>
                  ))}
                  {unifiClients.length === 0 && <p className="p-4 text-gray-600 text-sm">Nenhum cliente ativo</p>}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* MIKROTIK */}
      {tab === 'mikrotik' && (
        <div className="space-y-4">
          {!mtConnected ? (
            <div className="card p-6 max-w-lg">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                  <Server className="w-5 h-5 text-[#7b2fff]" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Conectar ao MikroTik</h2>
                  <p className="text-xs text-gray-500">RouterOS v6.49+ (REST API)</p>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">URL do Roteador</label>
                  <input className="dark-input" placeholder="https://192.168.88.1" value={mtUrl} onChange={e => setMtUrl(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Usuário</label>
                    <input className="dark-input" value={mtUser} onChange={e => setMtUser(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Senha</label>
                    <div className="relative">
                      <input className="dark-input pr-8" type={showPass.mt ? 'text' : 'password'} value={mtPass} onChange={e => setMtPass(e.target.value)} />
                      <button onClick={() => setShowPass(p => ({ ...p, mt: !p.mt }))} className="absolute right-2 top-2 text-gray-500 hover:text-gray-300">
                        {showPass.mt ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>

                {mtError && (
                  <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 rounded-lg px-3 py-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {mtError}
                  </div>
                )}

                <button onClick={connectMikroTik} disabled={mtLoading || !mtUrl || !mtPass}
                  className="btn-purple w-full py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                  {mtLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  {mtLoading ? 'Conectando...' : 'Conectar'}
                </button>

                <div className="text-xs text-gray-600 space-y-1 mt-2">
                  <p>• Habilite a REST API: <code className="mono bg-white/5 px-1 rounded">/ip service enable www-ssl</code></p>
                  <p>• Ou via HTTP: <code className="mono bg-white/5 px-1 rounded">/ip service enable www</code></p>
                </div>
              </div>
            </div>
          ) : (
            <div>
              {/* Connected Header */}
              <div className="card p-4 mb-4 flex items-center gap-4">
                <div className="w-2 h-2 rounded-full bg-[#00ff88] glow-green" />
                <span className="text-sm text-white font-semibold">
                  {mtResource?.['board-name'] || 'MikroTik'} — {mtUrl}
                </span>
                <div className="flex items-center gap-4 ml-auto">
                  {mtResource && <span className="text-xs text-gray-500">RouterOS {mtResource.version}</span>}
                  <button onClick={refreshMikroTik} disabled={mtLoading}
                    className="btn-purple px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5">
                    {mtLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    Atualizar
                  </button>
                  <button onClick={() => { setMtConnected(false); setMtResource(null); setMtInterfaces([]) }}
                    className="text-gray-500 hover:text-gray-300 text-xs">Desconectar</button>
                </div>
              </div>

              {/* Sub-tabs */}
              <div className="flex gap-1 mb-4 w-fit">
                {(['overview', 'interfaces', 'wireless'] as const).map(v => (
                  <button key={v} onClick={() => setMtView(v)}
                    className={clsx('px-4 py-1.5 rounded-lg text-xs font-semibold transition-all',
                      mtView === v ? 'bg-[#1a2744] text-white' : 'text-gray-500 hover:text-gray-300')}>
                    {v === 'overview' ? 'Visão Geral' : v === 'interfaces' ? `Interfaces (${mtInterfaces.length})` : `Wireless (${mtClients.length})`}
                  </button>
                ))}
              </div>

              {mtView === 'overview' && mtResource && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    { label: 'CPU', value: `${mtResource['cpu-load']}%`, icon: Cpu, color: '#00d4ff', sub: mtResource['cpu-frequency'] + ' MHz' },
                    { label: 'Memória Livre', value: mtResource['free-memory'], icon: HardDrive, color: '#00ff88', sub: `Total: ${mtResource['total-memory']}` },
                    { label: 'Uptime', value: mtResource.uptime.split('d')[0] + 'd', icon: Activity, color: '#7b2fff', sub: mtResource.uptime },
                    { label: 'Plataforma', value: mtResource.platform, icon: Zap, color: '#ffd700', sub: mtResource['board-name'] },
                  ].map(({ label, value, icon: Icon, color, sub }) => (
                    <div key={label} className="card p-4" style={{ borderColor: `${color}20` }}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-gray-500 uppercase tracking-wider">{label}</span>
                        <Icon className="w-4 h-4" style={{ color }} />
                      </div>
                      <p className="text-xl font-bold mono" style={{ color }}>{value}</p>
                      {sub && <p className="text-xs text-gray-600 mt-1">{sub}</p>}
                    </div>
                  ))}

                  {parseInt(mtResource['cpu-load']) > 0 && (
                    <div className="col-span-2 lg:col-span-4 card p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-semibold text-white">Uso de CPU</span>
                        <span className="text-[#00d4ff] mono font-bold">{mtResource['cpu-load']}%</span>
                      </div>
                      <div className="progress-bar" style={{ height: 8 }}>
                        <div className="progress-fill" style={{
                          width: `${mtResource['cpu-load']}%`,
                          background: parseInt(mtResource['cpu-load']) > 80 ? '#ff4d4d' :
                            parseInt(mtResource['cpu-load']) > 50 ? '#ffd700' : '#00d4ff'
                        }} />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {mtView === 'interfaces' && (
                <div className="card overflow-hidden">
                  <div className="grid grid-cols-12 px-4 py-2 border-b border-[#1a2744] text-xs text-gray-500 uppercase tracking-wider font-semibold">
                    <span className="col-span-3">Interface</span>
                    <span className="col-span-2">Tipo</span>
                    <span className="col-span-2">Status</span>
                    <span className="col-span-2 text-right">TX Total</span>
                    <span className="col-span-2 text-right">RX Total</span>
                    <span className="col-span-1"></span>
                  </div>
                  {mtInterfaces.map((iface, i) => (
                    <div key={i} className="grid grid-cols-12 px-4 py-2.5 border-b border-[#1a2744]/40 text-xs hover:bg-white/2 items-center">
                      <span className="col-span-3 text-white font-medium">{iface.name}</span>
                      <span className="col-span-2 text-gray-500">{iface.type}</span>
                      <span className="col-span-2">
                        <span className={clsx('tag', iface.running && !iface.disabled ? 'tag-green' : 'tag-red')}>
                          {iface.disabled ? 'Disabled' : iface.running ? 'Up' : 'Down'}
                        </span>
                      </span>
                      <span className="col-span-2 text-right mono text-[#7b2fff]">
                        {formatBytes(parseInt(iface['tx-byte'] || '0'))}
                      </span>
                      <span className="col-span-2 text-right mono text-[#00d4ff]">
                        {formatBytes(parseInt(iface['rx-byte'] || '0'))}
                      </span>
                      <span className="col-span-1 text-right">
                        {iface.comment && <span className="text-gray-600 truncate text-[10px]">{iface.comment}</span>}
                      </span>
                    </div>
                  ))}
                  {mtInterfaces.length === 0 && <p className="p-4 text-gray-600 text-sm">Nenhuma interface encontrada</p>}
                </div>
              )}

              {mtView === 'wireless' && (
                <div>
                  {mtClients.length === 0 ? (
                    <div className="card p-8 text-center text-gray-600 text-sm">
                      <Radio className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      Nenhum cliente wireless — verifique se o roteador tem interfaces sem fio ativas
                    </div>
                  ) : (
                    <div className="card overflow-hidden">
                      <div className="grid grid-cols-10 px-4 py-2 border-b border-[#1a2744] text-xs text-gray-500 uppercase tracking-wider font-semibold">
                        <span className="col-span-2">Interface</span>
                        <span className="col-span-3">MAC</span>
                        <span className="col-span-2">SSID</span>
                        <span className="col-span-1 text-right">Sinal</span>
                        <span className="col-span-2 text-right">Uptime</span>
                      </div>
                      {mtClients.map((c, i) => (
                        <div key={i} className="grid grid-cols-10 px-4 py-2.5 border-b border-[#1a2744]/40 text-xs hover:bg-white/2">
                          <span className="col-span-2 text-gray-300">{c.interface}</span>
                          <span className="col-span-3 mono text-gray-500 text-[10px]">{c.mac_address}</span>
                          <span className="col-span-2 text-gray-400">{c.ssid || '—'}</span>
                          <span className="col-span-1 text-right mono" style={{ color: parseInt(c.signal_strength) > -65 ? '#00ff88' : parseInt(c.signal_strength) > -75 ? '#ffd700' : '#ff4d4d' }}>
                            {c.signal_strength}
                          </span>
                          <span className="col-span-2 text-right text-gray-500">{c.uptime || '—'}</span>
                        </div>
                      ))}
                    </div>
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
