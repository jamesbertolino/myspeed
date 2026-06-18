'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Download, Upload, Activity, Trash2, RefreshCw, TrendingUp, Bell, Wifi } from 'lucide-react'
import { formatSpeed, latencyColor } from '@/lib/utils'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'

interface SpeedRow {
  id: number; ts: number; ping: number; jitter: number
  download: number; upload: number; server?: string; auto: number
}
interface PingRow  { id: number; ts: number; ms: number; ttl?: number }
interface AlertRow { id: number; ts: number; type: string; value: number; threshold: number; message: string }
interface WifiRow  {
  id: number; ts: number
  band24_ch: number | null; band24_score: number | null; band24_rec: number | null
  band5_ch:  number | null; band5_score:  number | null; band5_rec:  number | null
  net_count: number; networks_json: string | null
}

function fmt(ts: number) {
  return new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function scoreColor(s: number | null) {
  if (s == null) return '#4a5568'
  if (s >= 80) return '#00ff88'
  if (s >= 60) return '#ffd700'
  if (s >= 40) return '#ff8c00'
  return '#ff4d4d'
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-gray-600">—</span>
  return <span className="font-bold mono" style={{ color: scoreColor(score) }}>{score}</span>
}

export default function HistoryPage() {
  const [speedRows,  setSpeedRows]  = useState<SpeedRow[]>([])
  const [pingRows,   setPingRows]   = useState<PingRow[]>([])
  const [alertRows,  setAlertRows]  = useState<AlertRow[]>([])
  const [wifiRows,   setWifiRows]   = useState<WifiRow[]>([])
  const [loading,    setLoading]    = useState(true)
  const [tab,        setTab]        = useState<'speedtest' | 'ping' | 'alerts' | 'wifi'>('speedtest')

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      fetch('/api/history/speedtest?limit=100').then(r => r.json()),
      fetch('/api/history/ping?limit=200').then(r => r.json()),
      fetch('/api/history/alerts?limit=100').then(r => r.json()),
      fetch('/api/history/wifi?limit=200').then(r => r.json()),
    ]).then(([sp, pg, al, wf]) => {
      setSpeedRows(sp.rows ?? [])
      setPingRows((pg.rows ?? []).reverse())
      setAlertRows(al.rows ?? [])
      setWifiRows(wf.rows ?? [])
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const clearSpeedtest = async () => {
    if (!confirm('Apagar todo o histórico de speedtest?')) return
    await fetch('/api/history/speedtest', { method: 'DELETE' })
    setSpeedRows([])
  }

  const clearAlerts = async () => {
    if (!confirm('Apagar todo o log de alertas?')) return
    await fetch('/api/history/alerts', { method: 'DELETE' })
    setAlertRows([])
  }

  const clearWifi = async () => {
    if (!confirm('Apagar todo o histórico WiFi?')) return
    await fetch('/api/history/wifi', { method: 'DELETE' })
    setWifiRows([])
  }

  // Gráfico de score ao longo do tempo (cronológico)
  const wifiChart = useMemo(() =>
    [...wifiRows].reverse().map(r => ({
      t:      fmt(r.ts),
      '2.4GHz': r.band24_score,
      '5GHz':   r.band5_score,
    })), [wifiRows])

  // SSIDs únicos vistos: primeira e última vez
  const ssidTimeline = useMemo(() => {
    const map = new Map<string, { first: number; last: number; maxSignal: number; lastCh: number | null }>()
    ;[...wifiRows].reverse().forEach(r => {
      if (!r.networks_json) return
      try {
        const nets: { ssid: string; signal: number; channel: number }[] = JSON.parse(r.networks_json)
        nets.forEach(n => {
          if (!n.ssid || n.ssid === 'Hidden') return
          const entry = map.get(n.ssid)
          if (!entry) {
            map.set(n.ssid, { first: r.ts, last: r.ts, maxSignal: n.signal, lastCh: n.channel })
          } else {
            entry.last = r.ts
            if (n.signal > entry.maxSignal) entry.maxSignal = n.signal
            entry.lastCh = n.channel
          }
        })
      } catch { /* ignore malformed */ }
    })
    return [...map.entries()]
      .map(([ssid, v]) => ({ ssid, ...v }))
      .sort((a, b) => b.maxSignal - a.maxSignal)
  }, [wifiRows])

  const deleteRow = async (id: number) => {
    await fetch(`/api/history/speedtest?id=${id}`, { method: 'DELETE' })
    setSpeedRows(p => p.filter(r => r.id !== id))
  }

  // dados para o gráfico — ordem cronológica
  const chartData = [...speedRows].reverse().map(r => ({
    t:        fmt(r.ts),
    Download: parseFloat(r.download.toFixed(1)),
    Upload:   parseFloat(r.upload.toFixed(1)),
    Ping:     parseFloat(r.ping.toFixed(1)),
  }))

  const pingChart = pingRows.map(r => ({ t: fmt(r.ts), ms: r.ms, ttl: r.ttl }))

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-white">Histórico</h1>
          <p className="text-sm text-gray-500 mt-1">Registro persistente de testes e ping</p>
        </div>
        <button onClick={load} className="btn-cyan px-3 py-2 rounded-lg text-xs flex items-center gap-1.5">
          <RefreshCw className="w-3 h-3" />Atualizar
        </button>
      </div>

      {/* tabs */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {(['speedtest', 'ping', 'alerts', 'wifi'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${tab === t ? 'btn-cyan' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>
            {t === 'speedtest' ? 'Speedtest'
              : t === 'ping'  ? 'Ping / TTL'
              : t === 'alerts' ? `Alertas${alertRows.length ? ` (${alertRows.length})` : ''}`
              : <span className="flex items-center gap-1.5"><Wifi className="w-3 h-3" />WiFi{wifiRows.length ? ` (${wifiRows.length})` : ''}</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-gray-500 text-sm">Carregando...</div>
      ) : tab === 'wifi' ? (
        <>
          {/* Gráfico de score ao longo do tempo */}
          {wifiChart.length > 1 && (
            <div className="card p-5 mb-4">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-4 h-4 text-[#00d4ff]" />
                <h2 className="text-sm font-semibold text-white">Qualidade do canal ao longo do tempo</h2>
                <span className="text-xs text-gray-500 ml-1">(score 0–100)</span>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={wifiChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                  <XAxis dataKey="t" tick={{ fill: '#4a5568', fontSize: 9 }} interval="preserveStartEnd" />
                  <YAxis domain={[0, 100]} tick={{ fill: '#4a5568', fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: '#0a1128', border: '1px solid #1a2744', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="2.4GHz" stroke="#00d4ff" dot={false} strokeWidth={2} connectNulls />
                  <Line type="monotone" dataKey="5GHz"   stroke="#a855f7" dot={false} strokeWidth={2} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Tabela de scans */}
          <div className="card p-5 mb-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white">{wifiRows.length} scans registrados</h2>
              {wifiRows.length > 0 && (
                <button onClick={clearWifi} className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors">
                  <Trash2 className="w-3 h-3" />Limpar
                </button>
              )}
            </div>
            {wifiRows.length === 0 ? (
              <p className="text-gray-600 text-sm text-center py-8">Nenhum scan registrado ainda.<br/><span className="text-xs">Abra o Analisador WiFi e faça um scan real com o agente.</span></p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 border-b border-white/5">
                      <th className="text-left pb-2 font-medium">Data</th>
                      <th className="text-center pb-2 font-medium">2.4GHz<br/><span className="text-gray-600 font-normal">ch · score · rec</span></th>
                      <th className="text-center pb-2 font-medium">5GHz<br/><span className="text-gray-600 font-normal">ch · score · rec</span></th>
                      <th className="text-right pb-2 font-medium">Redes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wifiRows.map(r => (
                      <tr key={r.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-2 text-gray-400 mono whitespace-nowrap">{fmt(r.ts)}</td>
                        <td className="py-2 text-center">
                          {r.band24_ch != null ? (
                            <span className="inline-flex items-center gap-1">
                              <span className="text-gray-400">CH{r.band24_ch}</span>
                              <span className="text-gray-600">·</span>
                              <ScoreBadge score={r.band24_score} />
                              {r.band24_rec != null && r.band24_rec !== r.band24_ch && (
                                <span className="text-gray-600 text-[10px]">→CH{r.band24_rec}</span>
                              )}
                            </span>
                          ) : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="py-2 text-center">
                          {r.band5_ch != null ? (
                            <span className="inline-flex items-center gap-1">
                              <span className="text-gray-400">CH{r.band5_ch}</span>
                              <span className="text-gray-600">·</span>
                              <ScoreBadge score={r.band5_score} />
                              {r.band5_rec != null && r.band5_rec !== r.band5_ch && (
                                <span className="text-gray-600 text-[10px]">→CH{r.band5_rec}</span>
                              )}
                            </span>
                          ) : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="py-2 text-right text-gray-400">{r.net_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* SSIDs vistos */}
          {ssidTimeline.length > 0 && (
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-white mb-4">Redes já vistas ({ssidTimeline.length} SSIDs)</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 border-b border-white/5">
                      <th className="text-left pb-2 font-medium">SSID</th>
                      <th className="text-right pb-2 font-medium">CH</th>
                      <th className="text-right pb-2 font-medium">Sinal máx</th>
                      <th className="text-left pb-2 font-medium pl-3">Primeira vez</th>
                      <th className="text-left pb-2 font-medium pl-2">Última vez</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ssidTimeline.map(({ ssid, lastCh, maxSignal, first, last }) => {
                      const sigColor = maxSignal >= -65 ? '#00ff88' : maxSignal >= -75 ? '#ffd700' : '#ff8c00'
                      return (
                        <tr key={ssid} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                          <td className="py-2 text-white font-medium truncate max-w-[140px]">{ssid}</td>
                          <td className="py-2 text-right text-gray-400 mono">{lastCh ?? '—'}</td>
                          <td className="py-2 text-right mono font-semibold" style={{ color: sigColor }}>{maxSignal} dBm</td>
                          <td className="py-2 pl-3 text-gray-500 mono whitespace-nowrap">{fmt(first)}</td>
                          <td className="py-2 pl-2 text-gray-500 mono whitespace-nowrap">{fmt(last)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : tab === 'speedtest' ? (
        <>
          {/* gráfico */}
          {chartData.length > 1 && (
            <div className="card p-5 mb-5">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-4 h-4 text-[#00d4ff]" />
                <h2 className="text-sm font-semibold text-white">Tendência de velocidade</h2>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                  <XAxis dataKey="t" tick={{ fill: '#4a5568', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#4a5568', fontSize: 10 }} unit=" Mbps" />
                  <Tooltip contentStyle={{ background: '#0a1128', border: '1px solid #1a2744', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="Download" stroke="#00d4ff" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="Upload"   stroke="#00ff88" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* tabela */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white">{speedRows.length} registros</h2>
              {speedRows.length > 0 && (
                <button onClick={clearSpeedtest} className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors">
                  <Trash2 className="w-3 h-3" />Limpar tudo
                </button>
              )}
            </div>
            {speedRows.length === 0 ? (
              <p className="text-gray-600 text-sm text-center py-8">Nenhum teste registrado ainda.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 border-b border-white/5">
                      <th className="text-left pb-2 font-medium">Data</th>
                      <th className="text-right pb-2 font-medium"><Download className="w-3 h-3 inline mr-1" />Down</th>
                      <th className="text-right pb-2 font-medium"><Upload className="w-3 h-3 inline mr-1" />Up</th>
                      <th className="text-right pb-2 font-medium"><Activity className="w-3 h-3 inline mr-1" />Ping</th>
                      <th className="text-right pb-2 font-medium">Jitter</th>
                      <th className="text-left pb-2 font-medium pl-3">Servidor</th>
                      <th className="pb-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {speedRows.map(r => {
                      const dl = formatSpeed(r.download)
                      const ul = formatSpeed(r.upload)
                      const pc = latencyColor(r.ping)
                      return (
                        <tr key={r.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                          <td className="py-2 text-gray-400 mono whitespace-nowrap">{fmt(r.ts)}</td>
                          <td className="py-2 text-right font-bold mono" style={{ color: '#00d4ff' }}>
                            {dl.value}<span className="text-gray-500 font-normal ml-0.5">{dl.unit}</span>
                          </td>
                          <td className="py-2 text-right font-bold mono" style={{ color: '#00ff88' }}>
                            {ul.value}<span className="text-gray-500 font-normal ml-0.5">{ul.unit}</span>
                          </td>
                          <td className="py-2 text-right font-bold mono" style={{ color: pc }}>
                            {r.ping.toFixed(0)}<span className="text-gray-500 font-normal ml-0.5">ms</span>
                          </td>
                          <td className="py-2 text-right mono text-gray-400">
                            {r.jitter.toFixed(1)}<span className="text-gray-600 ml-0.5">ms</span>
                          </td>
                          <td className="py-2 pl-3 text-gray-500 truncate max-w-[120px]">
                            {r.server ?? '—'}
                            {!!r.auto && <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-white/5 text-gray-600">auto</span>}
                          </td>
                          <td className="py-2 text-right">
                            <button onClick={() => deleteRow(r.id)} className="text-gray-700 hover:text-red-400 transition-colors">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        /* tab ping */
        /* tab alerts */
        tab === 'alerts' ? (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">{alertRows.length} alertas registrados</h2>
            {alertRows.length > 0 && (
              <button onClick={clearAlerts} className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors">
                <Trash2 className="w-3 h-3" />Limpar
              </button>
            )}
          </div>
          {alertRows.length === 0 ? (
            <p className="text-gray-600 text-sm text-center py-8">Nenhum alerta registrado.</p>
          ) : (
            <div className="space-y-2">
              {alertRows.map(r => {
                const colors: Record<string, string> = { ping: '#ffd700', packet_loss: '#ff4d4d', download: '#00d4ff', upload: '#00ff88' }
                const color = colors[r.type] ?? '#aaa'
                return (
                  <div key={r.id} className="flex items-start gap-3 px-3 py-2.5 rounded-lg bg-white/5">
                    <Bell className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white">{r.message}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{fmt(r.ts)}</p>
                    </div>
                    <span className="text-xs font-semibold mono shrink-0" style={{ color }}>
                      {r.type.replace('_', ' ')}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        ) : (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-white mb-4">{pingRows.length} amostras (últimas 24h)</h2>
          {pingRows.length > 1 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={pingChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                <XAxis dataKey="t" tick={{ fill: '#4a5568', fontSize: 9 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: '#4a5568', fontSize: 10 }} unit="ms" />
                <Tooltip contentStyle={{ background: '#0a1128', border: '1px solid #1a2744', borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey="ms" stroke="#00ff41" dot={false} strokeWidth={1.5} name="Ping (ms)" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-gray-600 text-sm text-center py-8">Aguardando amostras de ping...</p>
          )}
        </div>
        )
      )}
    </div>
  )
}
