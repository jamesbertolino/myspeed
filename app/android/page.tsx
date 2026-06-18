'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Smartphone, RefreshCw, Wifi, Battery, BatteryCharging,
  Signal, Clock, ChevronDown, ChevronUp, Radio, AlertCircle,
  Download, TrendingDown, TrendingUp, Minus,
} from 'lucide-react'
import clsx from 'clsx'

// ── Types ──────────────────────────────────────────────────────────────────────

interface AndroidDevice {
  id: number
  device_id: string
  device_name: string | null
  model: string | null
  android_ver: string | null
  last_seen: number
}

interface AndroidReport {
  id: number
  ts: number
  device_id: string
  wifi_ssid: string | null
  wifi_bssid: string | null
  wifi_rssi: number | null
  wifi_freq: number | null
  wifi_speed: number | null
  ip_address: string | null
  ping_ms: number | null
  battery_pct: number | null
  battery_chg: number | null
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const s = Math.floor(Date.now() / 1000) - ts
  if (s < 60) return `${s}s atrás`
  if (s < 3600) return `${Math.floor(s / 60)}min atrás`
  if (s < 86400) return `${Math.floor(s / 3600)}h atrás`
  return `${Math.floor(s / 86400)}d atrás`
}

function formatTs(ts: number): string {
  return new Date(ts * 1000).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function rssiLabel(rssi: number | null): string {
  if (rssi === null) return '—'
  if (rssi >= -50) return 'Excelente'
  if (rssi >= -65) return 'Bom'
  if (rssi >= -75) return 'Regular'
  return 'Fraco'
}

function rssiColor(rssi: number | null): string {
  if (rssi === null) return 'text-gray-500'
  if (rssi >= -50) return 'text-green-400'
  if (rssi >= -65) return 'text-cyan-400'
  if (rssi >= -75) return 'text-yellow-400'
  return 'text-red-400'
}

function pingColor(ms: number | null): string {
  if (ms === null) return 'text-gray-500'
  if (ms < 50)  return 'text-green-400'
  if (ms < 120) return 'text-cyan-400'
  if (ms < 200) return 'text-yellow-400'
  return 'text-red-400'
}

function freqBand(freq: number | null): string {
  if (!freq) return '—'
  if (freq < 3000) return '2.4 GHz'
  if (freq < 6000) return '5 GHz'
  return '6 GHz'
}

function isOnline(lastSeen: number): boolean {
  return Date.now() / 1000 - lastSeen < 180
}

// ── Battery bar ────────────────────────────────────────────────────────────────

function BatteryBar({ pct, charging }: { pct: number | null; charging: number | null }) {
  if (pct === null) return <span className="text-gray-500 text-xs">—</span>
  const color = charging ? '#00d4ff' : pct > 50 ? '#00ff88' : pct > 20 ? '#ffd700' : '#ff4d4d'
  const Icon  = charging ? BatteryCharging : Battery
  return (
    <div className="flex items-center gap-2">
      <Icon className="w-3.5 h-3.5 shrink-0" style={{ color }} />
      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden min-w-[40px]">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-mono" style={{ color }}>{pct}%</span>
    </div>
  )
}

// ── RSSI bar ───────────────────────────────────────────────────────────────────

function SignalBar({ rssi }: { rssi: number | null }) {
  if (rssi === null) return <span className="text-gray-500 text-xs">—</span>
  const pct   = Math.max(0, Math.min(100, ((rssi + 100) / 60) * 100))
  const color = rssi >= -50 ? '#00ff88' : rssi >= -65 ? '#00d4ff' : rssi >= -75 ? '#ffd700' : '#ff4d4d'
  return (
    <div className="flex items-center gap-2">
      <Signal className="w-3.5 h-3.5 shrink-0" style={{ color }} />
      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden min-w-[40px]">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-mono" style={{ color }}>{rssi} dBm</span>
    </div>
  )
}

// ── Ping delta icon ────────────────────────────────────────────────────────────

function PingTrend({ curr, prev }: { curr: number | null; prev: number | null }) {
  if (!curr || !prev) return null
  const delta = curr - prev
  if (Math.abs(delta) < 5) return <Minus className="w-3 h-3 text-gray-500" />
  if (delta > 0) return <TrendingUp className="w-3 h-3 text-red-400" />
  return <TrendingDown className="w-3 h-3 text-green-400" />
}

// ── History table ──────────────────────────────────────────────────────────────

function HistoryTable({ reports }: { reports: AndroidReport[] }) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? reports : reports.slice(0, 10)

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/5">
              <th className="text-left py-2 px-3 text-gray-500 font-medium">Horário</th>
              <th className="text-left py-2 px-3 text-gray-500 font-medium">WiFi</th>
              <th className="text-right py-2 px-3 text-gray-500 font-medium">RSSI</th>
              <th className="text-right py-2 px-3 text-gray-500 font-medium">Banda</th>
              <th className="text-right py-2 px-3 text-gray-500 font-medium">Velocidade</th>
              <th className="text-right py-2 px-3 text-gray-500 font-medium">IP</th>
              <th className="text-right py-2 px-3 text-gray-500 font-medium">Ping</th>
              <th className="text-right py-2 px-3 text-gray-500 font-medium">Bateria</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <tr key={r.id} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                <td className="py-2 px-3 text-gray-400 whitespace-nowrap">{formatTs(r.ts)}</td>
                <td className="py-2 px-3 text-gray-200 max-w-[120px] truncate">{r.wifi_ssid ?? <span className="text-gray-600">—</span>}</td>
                <td className={clsx('py-2 px-3 text-right font-mono', rssiColor(r.wifi_rssi))}>
                  {r.wifi_rssi !== null ? `${r.wifi_rssi}` : '—'}
                </td>
                <td className="py-2 px-3 text-right text-gray-400">{freqBand(r.wifi_freq)}</td>
                <td className="py-2 px-3 text-right text-gray-400 font-mono">
                  {r.wifi_speed !== null ? `${r.wifi_speed} Mb/s` : '—'}
                </td>
                <td className="py-2 px-3 text-right font-mono text-gray-400">{r.ip_address ?? '—'}</td>
                <td className={clsx('py-2 px-3 text-right font-mono', pingColor(r.ping_ms))}>
                  <span className="flex items-center justify-end gap-1">
                    <PingTrend curr={r.ping_ms} prev={reports[i + 1]?.ping_ms ?? null} />
                    {r.ping_ms !== null ? `${Math.round(r.ping_ms)}ms` : '—'}
                  </span>
                </td>
                <td className="py-2 px-3 text-right">
                  {r.battery_pct !== null ? (
                    <span className={clsx('font-mono', r.battery_chg ? 'text-cyan-400' : r.battery_pct > 20 ? 'text-gray-300' : 'text-red-400')}>
                      {r.battery_chg ? '⚡' : ''}{r.battery_pct}%
                    </span>
                  ) : <span className="text-gray-600">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {reports.length > 10 && (
        <button
          onClick={() => setShowAll(v => !v)}
          className="mt-3 w-full flex items-center justify-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 py-2 rounded-lg hover:bg-white/5 transition-all"
        >
          {showAll
            ? <><ChevronUp className="w-3.5 h-3.5" /> Mostrar menos</>
            : <><ChevronDown className="w-3.5 h-3.5" /> Ver todos {reports.length} registros</>
          }
        </button>
      )}
    </div>
  )
}

// ── Device card ────────────────────────────────────────────────────────────────

function DeviceCard({
  device,
  onSelect,
  selected,
}: {
  device: AndroidDevice
  onSelect: (d: AndroidDevice) => void
  selected: boolean
}) {
  const online = isOnline(device.last_seen)

  return (
    <button
      onClick={() => onSelect(device)}
      className={clsx(
        'w-full text-left rounded-xl border transition-all p-4',
        selected
          ? 'border-cyan-500/40 bg-cyan-500/5'
          : online
            ? 'border-white/8 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]'
            : 'border-white/5 bg-white/[0.01] hover:border-white/10 hover:bg-white/[0.03]'
      )}
    >
      <div className="flex items-start gap-3">
        <div className={clsx(
          'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
          online ? 'bg-cyan-500/10' : 'bg-gray-700/30'
        )}>
          <Smartphone className={clsx('w-5 h-5', online ? 'text-cyan-400' : 'text-gray-500')} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-semibold text-sm text-white truncate">
              {device.device_name ?? device.model ?? 'Dispositivo Android'}
            </span>
            <span className={clsx(
              'shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-medium',
              online
                ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                : 'bg-gray-500/10 text-gray-500 border border-gray-500/20'
            )}>
              {online ? 'Online' : 'Offline'}
            </span>
          </div>

          <div className="text-xs text-gray-500 mb-2 truncate">
            {device.model ?? '—'} · Android {device.android_ver ?? '?'}
          </div>

          <div className="flex items-center gap-1.5 text-[11px] text-gray-600">
            <Clock className="w-3 h-3 shrink-0" />
            {timeAgo(device.last_seen)}
          </div>
        </div>

        <ChevronDown className={clsx(
          'w-4 h-4 text-gray-600 shrink-0 mt-1 transition-transform',
          selected && 'rotate-180'
        )} />
      </div>
    </button>
  )
}

// ── Detail panel ───────────────────────────────────────────────────────────────

function DeviceDetail({ device }: { device: AndroidDevice }) {
  const [reports, setReports] = useState<AndroidReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res  = await fetch(`/api/android/report?device_id=${encodeURIComponent(device.device_id)}&limit=100`)
      const data = await res.json()
      setReports(data.reports ?? [])
    } catch {
      setError('Erro ao carregar histórico')
    } finally {
      setLoading(false)
    }
  }, [device.device_id])

  useEffect(() => { load() }, [load])

  const latest = reports[0]

  return (
    <div className="card">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center">
            <Smartphone className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h2 className="font-semibold text-white text-base">
              {device.device_name ?? device.model ?? 'Dispositivo Android'}
            </h2>
            <p className="text-xs text-gray-500">{device.model} · Android {device.android_ver}</p>
          </div>
        </div>
        <button
          onClick={load}
          className="p-2 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-all"
        >
          <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Latest reading summary */}
      {latest && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3">
            <div className="flex items-center gap-1.5 text-[11px] text-gray-500 mb-2 uppercase tracking-wide">
              <Wifi className="w-3 h-3" /> WiFi
            </div>
            <p className="text-sm font-medium text-white truncate">{latest.wifi_ssid ?? '—'}</p>
            <SignalBar rssi={latest.wifi_rssi} />
          </div>

          <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3">
            <div className="flex items-center gap-1.5 text-[11px] text-gray-500 mb-2 uppercase tracking-wide">
              <Radio className="w-3 h-3" /> Ping
            </div>
            <p className={clsx('text-2xl font-bold font-mono', pingColor(latest.ping_ms))}>
              {latest.ping_ms !== null ? `${Math.round(latest.ping_ms)}` : '—'}
              {latest.ping_ms !== null && <span className="text-sm font-normal text-gray-500 ml-0.5">ms</span>}
            </p>
          </div>

          <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3">
            <div className="flex items-center gap-1.5 text-[11px] text-gray-500 mb-2 uppercase tracking-wide">
              <Battery className="w-3 h-3" /> Bateria
            </div>
            <BatteryBar pct={latest.battery_pct} charging={latest.battery_chg} />
          </div>

          <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3">
            <div className="flex items-center gap-1.5 text-[11px] text-gray-500 mb-2 uppercase tracking-wide">
              <Signal className="w-3 h-3" /> Banda/IP
            </div>
            <p className="text-sm font-medium text-white">{freqBand(latest.wifi_freq)}</p>
            <p className="text-xs text-gray-500 font-mono truncate">{latest.ip_address ?? '—'}</p>
          </div>
        </div>
      )}

      {/* History */}
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-2">
          <Clock className="w-3.5 h-3.5" />
          Histórico ({reports.length} registros)
        </h3>

        {loading && (
          <div className="flex items-center justify-center py-8 text-gray-600 text-sm gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" /> Carregando...
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-red-400 text-sm py-4">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        {!loading && !error && reports.length === 0 && (
          <p className="text-gray-600 text-sm py-4 text-center">Nenhum relatório recebido ainda</p>
        )}

        {!loading && reports.length > 0 && <HistoryTable reports={reports} />}
      </div>
    </div>
  )
}

// ── Empty state ────────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="card text-center py-16">
      <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 flex items-center justify-center mx-auto mb-5">
        <Smartphone className="w-8 h-8 text-cyan-400/50" />
      </div>
      <h3 className="text-gray-300 font-semibold text-base mb-2">Nenhum dispositivo Android registrado</h3>
      <p className="text-sm text-gray-600 max-w-sm mx-auto mb-6">
        Instale o app <strong className="text-gray-400">MySpeed Monitor</strong> no seu Android,
        configure a URL deste servidor e ative o monitoramento.
      </p>
      <div className="inline-flex flex-col items-start gap-3 bg-white/[0.02] border border-white/8 rounded-xl p-5 text-left max-w-sm mx-auto">
        <div className="flex items-start gap-2.5">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 text-xs font-bold flex items-center justify-center">1</span>
          <p className="text-sm text-gray-400">Faça o download do APK pela aba <strong className="text-gray-200">Releases</strong> do repositório GitHub</p>
        </div>
        <div className="flex items-start gap-2.5">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 text-xs font-bold flex items-center justify-center">2</span>
          <p className="text-sm text-gray-400">Instale o APK e abra o app <strong className="text-gray-200">MySpeed Monitor</strong></p>
        </div>
        <div className="flex items-start gap-2.5">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 text-xs font-bold flex items-center justify-center">3</span>
          <p className="text-sm text-gray-400">Configure a URL do servidor e toque em <strong className="text-gray-200">Ativar monitoramento</strong></p>
        </div>
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AndroidPage() {
  const [devices, setDevices]       = useState<AndroidDevice[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')
  const [selected, setSelected]     = useState<AndroidDevice | null>(null)

  const loadDevices = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res  = await fetch('/api/android/report')
      const data = await res.json()
      const list: AndroidDevice[] = data.devices ?? []
      setDevices(list)
      // keep selected in sync
      if (selected) {
        const refreshed = list.find(d => d.device_id === selected.device_id)
        if (refreshed) setSelected(refreshed)
      }
    } catch {
      setError('Erro ao carregar dispositivos')
    } finally {
      setLoading(false)
    }
  }, [selected])

  useEffect(() => {
    loadDevices()
    const id = setInterval(loadDevices, 30_000)
    return () => clearInterval(id)
  }, [loadDevices])

  const online  = devices.filter(d => isOnline(d.last_seen))
  const offline = devices.filter(d => !isOnline(d.last_seen))

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl mx-auto">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2.5">
            <Smartphone className="w-5 h-5 text-cyan-400" />
            Dispositivos Android
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {loading ? 'Carregando…' : `${devices.length} dispositivo${devices.length !== 1 ? 's' : ''} · ${online.length} online`}
          </p>
        </div>
        <button
          onClick={loadDevices}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-gray-300 hover:text-white border border-white/10 hover:border-white/20 hover:bg-white/5 transition-all"
        >
          <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
          Atualizar
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-red-400 text-sm card">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && devices.length === 0 && (
        <div className="grid sm:grid-cols-2 gap-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="card animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/5" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-white/5 rounded w-3/4" />
                  <div className="h-2.5 bg-white/5 rounded w-1/2" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && devices.length === 0 && <EmptyState />}

      {/* Two-column layout: device list + detail */}
      {devices.length > 0 && (
        <div className="grid lg:grid-cols-[320px_1fr] gap-5 items-start">

          {/* Device list */}
          <div className="space-y-3">

            {online.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                  Online ({online.length})
                </p>
                <div className="space-y-2">
                  {online.map(d => (
                    <DeviceCard
                      key={d.device_id}
                      device={d}
                      selected={selected?.device_id === d.device_id}
                      onSelect={setSelected}
                    />
                  ))}
                </div>
              </div>
            )}

            {offline.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5 mt-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-600 inline-block" />
                  Offline ({offline.length})
                </p>
                <div className="space-y-2">
                  {offline.map(d => (
                    <DeviceCard
                      key={d.device_id}
                      device={d}
                      selected={selected?.device_id === d.device_id}
                      onSelect={setSelected}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Detail panel */}
          <div>
            {selected
              ? <DeviceDetail key={selected.device_id} device={selected} />
              : (
                <div className="card text-center py-12">
                  <Smartphone className="w-10 h-10 text-gray-700 mx-auto mb-3" />
                  <p className="text-gray-500 text-sm">Selecione um dispositivo para ver o histórico</p>
                </div>
              )
            }
          </div>

        </div>
      )}

      {/* Stats summary when multiple devices */}
      {devices.length > 1 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total',  value: devices.length,  color: 'text-gray-300' },
            { label: 'Online', value: online.length,   color: 'text-green-400' },
            { label: 'Offline',value: offline.length,  color: 'text-gray-500' },
            {
              label: 'Ping médio',
              value: '—',
              color: 'text-cyan-400',
            },
          ].map(({ label, value, color }) => (
            <div key={label} className="card text-center py-4">
              <p className={clsx('text-2xl font-bold font-mono', color)}>{value}</p>
              <p className="text-xs text-gray-600 mt-1">{label}</p>
            </div>
          ))}
        </div>
      )}

    </div>
  )
}
