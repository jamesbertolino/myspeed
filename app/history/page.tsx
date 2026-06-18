'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Download, Upload, Activity, Trash2, RefreshCw, TrendingUp, Bell, Wifi, BarChart2 } from 'lucide-react'
import { formatSpeed, latencyColor } from '@/lib/utils'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, BarChart, Bar, Cell } from 'recharts'

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
  const [tab,        setTab]        = useState<'speedtest' | 'ping' | 'alerts' | 'wifi' | 'stability' | 'sla'>('speedtest')
  const [stability,  setStability]  = useState<{ hourly: {hour:number;avgMs:number|null;count:number}[]; daily: {day:string;avgMs:number|null;maxMs:number;minMs:number;count:number;p95Ms:number|null}[] } | null>(null)
  const [slaData,    setSlaData]    = useState<{ overallPct:number; dlPct:number; ulPct:number; avgDl:number; avgUl:number; avgPing:number; minDl:number; minUl:number; maxPing:number; daysOk:number; daysBad:number; daily:{day:string;avgDl:number;avgUl:number;avgPing:number;ok:boolean}[] } | null>(null)
  const [slaSettings, setSlaSettings] = useState({ dl: 0, ul: 0 })

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      fetch('/api/history/speedtest?limit=100').then(r => r.json()),
      fetch('/api/history/ping?limit=200').then(r => r.json()),
      fetch('/api/history/alerts?limit=100').then(r => r.json()),
      fetch('/api/history/wifi?limit=200').then(r => r.json()),
      fetch('/api/history/stability?days=7').then(r => r.json()),
    ]).then(([sp, pg, al, wf, st]) => {
      setSpeedRows(sp.rows ?? [])
      setPingRows((pg.rows ?? []).reverse())
      setAlertRows(al.rows ?? [])
      setWifiRows(wf.rows ?? [])
      setStability(st)
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    // load contracted speeds from localStorage
    try {
      const raw = localStorage.getItem('myspeed_settings')
      if (raw) {
        const s = JSON.parse(raw)
        setSlaSettings({ dl: s.contractedDownload ?? 0, ul: s.contractedUpload ?? 0 })
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (tab !== 'sla') return
    fetch(`/api/history/sla?days=30&dl=${slaSettings.dl}&ul=${slaSettings.ul}`)
      .then(r => r.json())
      .then(d => setSlaData(d.sla))
      .catch(() => {})
  }, [tab, slaSettings])

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

  // Correlação latência × score WiFi
  // Para cada scan WiFi, busca o ping mais próximo no tempo (±2min).
  // Série resultante usada num gráfico dual-eixo.
  const correlationData = useMemo(() => {
    if (!wifiRows.length || !pingRows.length) return []
    const sorted = [...wifiRows].reverse() // cronológico
    return sorted.flatMap(w => {
      const nearest = pingRows.reduce<PingRow | null>((best, p) => {
        const diff = Math.abs(p.ts - w.ts)
        if (diff > 120_000) return best            // mais de 2 min: descarta
        if (!best) return p
        return diff < Math.abs(best.ts - w.ts) ? p : best
      }, null)
      if (!nearest) return []
      return [{
        t:       fmt(w.ts),
        latency: nearest.ms,
        score24: w.band24_score,
        score5:  w.band5_score,
      }]
    })
  }, [wifiRows, pingRows])

  // Pearson entre latência e score 2.4GHz
  const pearson24 = useMemo(() => {
    const pts = correlationData.filter(d => d.score24 != null)
    if (pts.length < 3) return null
    const xs = pts.map(d => d.latency)
    const ys = pts.map(d => d.score24 as number)
    const n  = xs.length
    const mx = xs.reduce((a, b) => a + b, 0) / n
    const my = ys.reduce((a, b) => a + b, 0) / n
    const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0)
    const den = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) * ys.reduce((s, y) => s + (y - my) ** 2, 0))
    return den === 0 ? null : parseFloat((num / den).toFixed(2))
  }, [correlationData])

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
    return Array.from(map.entries())
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
        {(['speedtest', 'ping', 'alerts', 'wifi', 'stability', 'sla'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${tab === t ? 'btn-cyan' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>
            {t === 'speedtest' ? 'Speedtest'
              : t === 'ping'  ? 'Ping / TTL'
              : t === 'alerts' ? `Alertas${alertRows.length ? ` (${alertRows.length})` : ''}`
              : t === 'stability' ? <span className="flex items-center gap-1.5"><BarChart2 className="w-3 h-3" />Estabilidade</span>
              : t === 'sla' ? 'SLA'
              : <span className="flex items-center gap-1.5"><Wifi className="w-3 h-3" />WiFi{wifiRows.length ? ` (${wifiRows.length})` : ''}</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-gray-500 text-sm">Carregando...</div>
      ) : tab === 'wifi' ? (
        <>
          {/* Correlação latência × score WiFi */}
          {correlationData.length > 1 && (
            <div className="card p-5 mb-4">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-[#ffd700]" />
                  <h2 className="text-sm font-semibold text-white">Correlação Latência × Qualidade WiFi</h2>
                </div>
                {pearson24 !== null && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-gray-500">Pearson r =</span>
                    <span className={`font-bold mono ${Math.abs(pearson24) >= 0.6 ? 'text-yellow-400' : 'text-gray-400'}`}>
                      {pearson24}
                    </span>
                    <span className="text-gray-600">
                      {Math.abs(pearson24) >= 0.7 ? '(correlação forte)' : Math.abs(pearson24) >= 0.4 ? '(correlação moderada)' : '(correlação fraca)'}
                    </span>
                  </div>
                )}
              </div>
              <p className="text-[11px] text-gray-600 mb-4">
                Latência (ms) vs score do canal 2.4GHz — picos de latência coincidindo com queda de score indicam WiFi como causa.
              </p>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={correlationData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                  <XAxis dataKey="t" tick={{ fill: '#4a5568', fontSize: 9 }} interval="preserveStartEnd" />
                  <YAxis yAxisId="lat" orientation="left"  tick={{ fill: '#4a5568', fontSize: 10 }} unit="ms" />
                  <YAxis yAxisId="sc"  orientation="right" domain={[0, 100]} tick={{ fill: '#4a5568', fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: '#0a1128', border: '1px solid #1a2744', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line yAxisId="lat" type="monotone" dataKey="latency" stroke="#ffd700" dot={false} strokeWidth={2} name="Latência (ms)" />
                  <Line yAxisId="sc"  type="monotone" dataKey="score24" stroke="#00d4ff" dot={false} strokeWidth={2} name="Score 2.4GHz" connectNulls />
                  <Line yAxisId="sc"  type="monotone" dataKey="score5"  stroke="#a855f7" dot={false} strokeWidth={1.5} name="Score 5GHz" connectNulls strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

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
        ) : tab === 'sla' ? (
        /* ── SLA ── */
        <div className="space-y-5">
          {/* Config */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-white mb-1">Velocidade Contratada</h2>
            <p className="text-xs text-gray-500 mb-4">Configure em Configurações → Velocidade Contratada ou ajuste aqui temporariamente</p>
            <div className="flex gap-4 flex-wrap">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Download contratado (Mbps)</label>
                <input type="number" min={0} className="input-field w-32 text-right mono"
                  value={slaSettings.dl}
                  onChange={e => setSlaSettings(s => ({ ...s, dl: Number(e.target.value) }))} />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Upload contratado (Mbps)</label>
                <input type="number" min={0} className="input-field w-32 text-right mono"
                  value={slaSettings.ul}
                  onChange={e => setSlaSettings(s => ({ ...s, ul: Number(e.target.value) }))} />
              </div>
              <div className="flex items-end">
                <button onClick={() => fetch(`/api/history/sla?days=30&dl=${slaSettings.dl}&ul=${slaSettings.ul}`).then(r => r.json()).then(d => setSlaData(d.sla)).catch(()=>{})}
                  className="btn-cyan px-4 py-2 rounded-lg text-xs font-semibold">
                  Calcular
                </button>
              </div>
            </div>
          </div>

          {slaData ? (
            <>
              {/* Scorecard */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'SLA Geral', value: `${slaData.overallPct}%`, color: slaData.overallPct >= 95 ? '#00ff88' : slaData.overallPct >= 80 ? '#ffd700' : '#ff4d4d', sub: slaData.overallPct >= 95 ? 'Excelente' : slaData.overallPct >= 80 ? 'Regular' : 'Abaixo do esperado' },
                  { label: 'Download SLA', value: `${slaData.dlPct}%`, color: slaData.dlPct >= 95 ? '#00ff88' : slaData.dlPct >= 80 ? '#ffd700' : '#ff4d4d', sub: `Média ${slaData.avgDl} Mbps` },
                  { label: 'Upload SLA', value: `${slaData.ulPct}%`, color: slaData.ulPct >= 95 ? '#00ff88' : slaData.ulPct >= 80 ? '#ffd700' : '#ff4d4d', sub: `Média ${slaData.avgUl} Mbps` },
                  { label: 'Dias dentro do SLA', value: `${slaData.daysOk}/${slaData.daysOk + slaData.daysBad}`, color: slaData.daysBad === 0 ? '#00ff88' : '#ffd700', sub: `${slaData.daysBad} dia${slaData.daysBad !== 1 ? 's' : ''} com degradação` },
                ].map(c => (
                  <div key={c.label} className="card p-4">
                    <p className="text-xs text-gray-500 mb-1">{c.label}</p>
                    <p className="text-2xl font-black mono" style={{ color: c.color }}>{c.value}</p>
                    <p className="text-xs text-gray-600 mt-1">{c.sub}</p>
                  </div>
                ))}
              </div>

              {/* Daily table */}
              <div className="card p-5">
                <h2 className="text-sm font-semibold text-white mb-4">Últimos 30 dias — detalhe diário</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500 border-b border-[#1a2744]">
                        <th className="text-left pb-2">Dia</th>
                        <th className="text-right pb-2">Download</th>
                        <th className="text-right pb-2">Upload</th>
                        <th className="text-right pb-2">Ping</th>
                        <th className="text-right pb-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {slaData.daily.map(d => (
                        <tr key={d.day} className="border-b border-[#1a2744]/50 hover:bg-white/3">
                          <td className="py-1.5 mono text-gray-300">{d.day}</td>
                          <td className="py-1.5 text-right mono" style={{ color: slaSettings.dl > 0 && d.avgDl < slaSettings.dl * 0.8 ? '#ff4d4d' : '#00d4ff' }}>{d.avgDl} Mbps</td>
                          <td className="py-1.5 text-right mono" style={{ color: slaSettings.ul > 0 && d.avgUl < slaSettings.ul * 0.8 ? '#ff4d4d' : '#00ff88' }}>{d.avgUl} Mbps</td>
                          <td className="py-1.5 text-right mono text-gray-400">{d.avgPing} ms</td>
                          <td className="py-1.5 text-right">
                            <span className={`tag text-[10px] ${d.ok ? 'tag-green' : 'tag-red'}`}>{d.ok ? 'OK' : 'Degradado'}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="card p-8 text-center text-gray-600 text-sm">
              Configure a velocidade contratada e clique em Calcular
            </div>
          )}
        </div>
        ) : tab === 'stability' ? (
        /* ── Estabilidade ── */
        <div className="space-y-5">
          {/* Latência por hora do dia */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-white mb-1">Latência média por hora do dia (últimos 7 dias)</h2>
            <p className="text-xs text-gray-500 mb-4">Identifica horários problemáticos recorrentes</p>
            {stability?.hourly && stability.hourly.some(h => h.count > 0) ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={stability.hourly} barCategoryGap="10%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                  <XAxis dataKey="hour" tickFormatter={h => `${h}h`} tick={{ fill: '#4a5568', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#4a5568', fontSize: 10 }} unit="ms" />
                  <Tooltip
                    contentStyle={{ background: '#0a1128', border: '1px solid #1a2744', borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => [`${v} ms`, 'Média']}
                    labelFormatter={h => `${h}h00`}
                  />
                  <Bar dataKey="avgMs" radius={[3, 3, 0, 0]}>
                    {stability.hourly.map((h, i) => (
                      <Cell key={i} fill={
                        h.avgMs == null ? '#1a2744'
                          : h.avgMs <= 30 ? '#00ff88'
                          : h.avgMs <= 80 ? '#ffd700'
                          : h.avgMs <= 150 ? '#ff8c00'
                          : '#ff4d4d'
                      } />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-gray-600 text-sm text-center py-8">Sem amostras suficientes.</p>
            )}
          </div>

          {/* Latência diária */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-white mb-1">Evolução diária (últimos 7 dias)</h2>
            <p className="text-xs text-gray-500 mb-4">Média, mínimo, máximo e P95 por dia</p>
            {stability?.daily && stability.daily.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={stability.daily}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                    <XAxis dataKey="day" tickFormatter={d => d.slice(5)} tick={{ fill: '#4a5568', fontSize: 10 }} />
                    <YAxis tick={{ fill: '#4a5568', fontSize: 10 }} unit="ms" />
                    <Tooltip contentStyle={{ background: '#0a1128', border: '1px solid #1a2744', borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="avgMs" stroke="#00d4ff" dot strokeWidth={2} name="Média (ms)" />
                    <Line type="monotone" dataKey="p95Ms" stroke="#ffd700" dot={false} strokeWidth={1.5} strokeDasharray="4 2" name="P95 (ms)" />
                    <Line type="monotone" dataKey="maxMs" stroke="#ff4d4d" dot={false} strokeWidth={1} strokeDasharray="2 3" name="Máximo (ms)" />
                  </LineChart>
                </ResponsiveContainer>

                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500 border-b border-[#1a2744]">
                        <th className="text-left pb-2">Dia</th>
                        <th className="text-right pb-2">Amostras</th>
                        <th className="text-right pb-2">Mín</th>
                        <th className="text-right pb-2">Média</th>
                        <th className="text-right pb-2">P95</th>
                        <th className="text-right pb-2">Máx</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stability.daily.map(d => (
                        <tr key={d.day} className="border-b border-[#1a2744]/50 hover:bg-white/3">
                          <td className="py-1.5 text-gray-300 mono">{d.day}</td>
                          <td className="py-1.5 text-right text-gray-500">{d.count}</td>
                          <td className="py-1.5 text-right" style={{ color: '#00ff88' }}>{d.minMs}ms</td>
                          <td className="py-1.5 text-right" style={{ color: d.avgMs != null && d.avgMs > 100 ? '#ff4d4d' : d.avgMs != null && d.avgMs > 50 ? '#ffd700' : '#00d4ff' }}>
                            {d.avgMs ?? '—'}ms
                          </td>
                          <td className="py-1.5 text-right text-yellow-400">{d.p95Ms ?? '—'}ms</td>
                          <td className="py-1.5 text-right text-red-400">{d.maxMs}ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="text-gray-600 text-sm text-center py-8">Sem amostras suficientes.</p>
            )}
          </div>
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
