'use client'

import { useEffect, useState } from 'react'
import { Printer, RefreshCw, Zap } from 'lucide-react'

interface SpeedRow { ts: number; download: number; upload: number; ping: number; server?: string }
interface AlertRow { ts: number; type: string; message: string }
interface WifiRow { ts: number; band24_ch: number | null; band24_score: number | null; band5_ch: number | null; band5_score: number | null }
interface KnownDevice { mac: string; ip: string | null; vendor: string | null; label: string | null; first_seen: number; last_seen: number; trusted: number }
interface Insight { type: string; title: string; detail: string }
interface SlaData { overallPct: number; dlPct: number; ulPct: number; avgDl: number; avgUl: number; avgPing: number; daysOk: number; daysBad: number }

function fmt(ts: number) {
  return new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString('pt-BR')
}

export default function ReportPage() {
  const [speed, setSpeed] = useState<SpeedRow[]>([])
  const [alerts, setAlerts] = useState<AlertRow[]>([])
  const [wifi, setWifi] = useState<WifiRow[]>([])
  const [devices, setDevices] = useState<KnownDevice[]>([])
  const [insights, setInsights] = useState<Insight[]>([])
  const [sla, setSla] = useState<SlaData | null>(null)
  const [loading, setLoading] = useState(true)
  const [generatedAt] = useState(() => new Date().toLocaleString('pt-BR'))
  const [contractedDl, setContractedDl] = useState(0)
  const [contractedUl, setContractedUl] = useState(0)

  useEffect(() => {
    try {
      const raw = localStorage.getItem('myspeed_settings')
      if (raw) {
        const s = JSON.parse(raw)
        setContractedDl(s.contractedDownload ?? 0)
        setContractedUl(s.contractedUpload ?? 0)
      }
    } catch { /* */ }
  }, [])

  const load = () => {
    setLoading(true)
    Promise.all([
      fetch('/api/history/speedtest?limit=50').then(r => r.json()),
      fetch('/api/history/alerts?limit=50').then(r => r.json()),
      fetch('/api/history/wifi?limit=20').then(r => r.json()),
      fetch('/api/devices/known').then(r => r.json()),
      fetch('/api/history/trends').then(r => r.json()),
      fetch('/api/history/sla?days=30').then(r => r.json()),
    ]).then(([sp, al, wf, kd, tr, sl]) => {
      setSpeed(sp.rows ?? [])
      setAlerts(al.rows ?? [])
      setWifi(wf.rows ?? [])
      setDevices(kd.rows ?? [])
      setInsights(tr.insights ?? [])
      setSla(sl.sla)
    }).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const avgDl = speed.length ? speed.reduce((s, r) => s + r.download, 0) / speed.length : 0
  const avgUl = speed.length ? speed.reduce((s, r) => s + r.upload, 0) / speed.length : 0
  const avgPing = speed.length ? speed.reduce((s, r) => s + r.ping, 0) / speed.length : 0
  const lastWifi = wifi[0]

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Print-hide toolbar */}
      <div className="print:hidden sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-400 to-purple-600 flex items-center justify-center">
            <Zap className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-bold text-gray-800">MySpeed — Relatório da Rede</span>
        </div>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
          </button>
          <button onClick={() => window.print()} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700 transition-colors">
            <Printer className="w-4 h-4" /> Imprimir / Salvar PDF
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-gray-900 pb-4">
          <div>
            <h1 className="text-2xl font-black text-gray-900">Relatório de Análise de Rede</h1>
            <p className="text-sm text-gray-500 mt-1">Gerado em {generatedAt}</p>
          </div>
          <div className="text-right text-xs text-gray-400">
            <p>MySpeed Network Analyzer</p>
            {contractedDl > 0 && <p>Contrato: ↓{contractedDl}Mbps ↑{contractedUl}Mbps</p>}
          </div>
        </div>

        {/* Summary cards */}
        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 border-l-4 border-cyan-500 pl-3">Resumo Executivo</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Download médio', value: `${avgDl.toFixed(1)} Mbps`, sub: `${speed.length} testes` },
              { label: 'Upload médio', value: `${avgUl.toFixed(1)} Mbps`, sub: '' },
              { label: 'Ping médio', value: `${avgPing.toFixed(0)} ms`, sub: '' },
              { label: 'SLA', value: sla ? `${sla.overallPct}%` : '—', sub: sla ? `${sla.daysOk}d OK · ${sla.daysBad}d ruim` : 'Configure velocidade' },
            ].map(c => (
              <div key={c.label} className="border border-gray-200 rounded-lg p-3">
                <p className="text-xs text-gray-500">{c.label}</p>
                <p className="text-xl font-black text-gray-900 my-0.5">{c.value}</p>
                {c.sub && <p className="text-xs text-gray-400">{c.sub}</p>}
              </div>
            ))}
          </div>
        </section>

        {/* Insights */}
        {insights.length > 0 && (
          <section>
            <h2 className="text-base font-bold text-gray-800 mb-3 border-l-4 border-purple-500 pl-3">Insights de Tendência (últimos 7 dias)</h2>
            <div className="space-y-2">
              {insights.map((ins, i) => (
                <div key={i} className={`flex items-start gap-3 p-3 rounded-lg border text-sm ${ins.type === 'warning' ? 'border-orange-200 bg-orange-50' : ins.type === 'good' ? 'border-green-200 bg-green-50' : 'border-blue-200 bg-blue-50'}`}>
                  <span className="font-semibold">{ins.title}:</span>
                  <span className="text-gray-600">{ins.detail}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* WiFi */}
        {lastWifi && (
          <section>
            <h2 className="text-base font-bold text-gray-800 mb-3 border-l-4 border-yellow-500 pl-3">Qualidade WiFi (último scan)</h2>
            <div className="grid grid-cols-2 gap-4">
              {[
                { band: '2.4 GHz', ch: lastWifi.band24_ch, score: lastWifi.band24_score },
                { band: '5 GHz',   ch: lastWifi.band5_ch,  score: lastWifi.band5_score  },
              ].map(b => (
                <div key={b.band} className="border border-gray-200 rounded-lg p-3">
                  <p className="text-xs text-gray-500">{b.band}</p>
                  <p className="text-xl font-black">{b.score != null ? `${b.score}/100` : '—'}</p>
                  {b.ch && <p className="text-xs text-gray-400">Canal {b.ch}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Speed history */}
        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 border-l-4 border-cyan-500 pl-3">Histórico de Velocidade (últimos {speed.length} testes)</h2>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100">
                <th className="text-left p-2 border border-gray-200">Data/Hora</th>
                <th className="text-right p-2 border border-gray-200">Download</th>
                <th className="text-right p-2 border border-gray-200">Upload</th>
                <th className="text-right p-2 border border-gray-200">Ping</th>
                <th className="text-left p-2 border border-gray-200">Servidor</th>
              </tr>
            </thead>
            <tbody>
              {speed.slice(0, 20).map((r, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="p-2 border border-gray-200 font-mono">{fmt(r.ts)}</td>
                  <td className="p-2 border border-gray-200 text-right font-mono">{r.download.toFixed(1)} Mbps</td>
                  <td className="p-2 border border-gray-200 text-right font-mono">{r.upload.toFixed(1)} Mbps</td>
                  <td className="p-2 border border-gray-200 text-right font-mono">{r.ping.toFixed(0)} ms</td>
                  <td className="p-2 border border-gray-200 text-gray-500 truncate max-w-[120px]">{r.server ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {speed.length > 20 && <p className="text-xs text-gray-400 mt-1">Mostrando 20 de {speed.length} testes</p>}
        </section>

        {/* Devices */}
        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 border-l-4 border-green-500 pl-3">Dispositivos Conhecidos ({devices.length})</h2>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100">
                <th className="text-left p-2 border border-gray-200">IP</th>
                <th className="text-left p-2 border border-gray-200">MAC</th>
                <th className="text-left p-2 border border-gray-200">Fabricante</th>
                <th className="text-left p-2 border border-gray-200">Label</th>
                <th className="text-right p-2 border border-gray-200">1ª vez</th>
                <th className="text-right p-2 border border-gray-200">Última vez</th>
                <th className="text-right p-2 border border-gray-200">Status</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d, i) => (
                <tr key={d.mac} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="p-2 border border-gray-200 font-mono">{d.ip ?? '—'}</td>
                  <td className="p-2 border border-gray-200 font-mono text-[10px]">{d.mac}</td>
                  <td className="p-2 border border-gray-200">{d.vendor ?? '—'}</td>
                  <td className="p-2 border border-gray-200 text-gray-500">{d.label ?? '—'}</td>
                  <td className="p-2 border border-gray-200 text-right font-mono">{fmtDate(d.first_seen)}</td>
                  <td className="p-2 border border-gray-200 text-right font-mono">{fmtDate(d.last_seen)}</td>
                  <td className="p-2 border border-gray-200 text-right">{d.trusted ? 'Confiável' : 'Desconhecido'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Alerts */}
        {alerts.length > 0 && (
          <section>
            <h2 className="text-base font-bold text-gray-800 mb-3 border-l-4 border-red-500 pl-3">Alertas Registrados ({alerts.length})</h2>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="text-left p-2 border border-gray-200">Data/Hora</th>
                  <th className="text-left p-2 border border-gray-200">Tipo</th>
                  <th className="text-left p-2 border border-gray-200">Mensagem</th>
                </tr>
              </thead>
              <tbody>
                {alerts.slice(0, 30).map((a, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="p-2 border border-gray-200 font-mono whitespace-nowrap">{fmt(a.ts)}</td>
                    <td className="p-2 border border-gray-200 font-semibold">{a.type.replace('_', ' ')}</td>
                    <td className="p-2 border border-gray-200 text-gray-600">{a.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* Footer */}
        <div className="border-t border-gray-200 pt-4 text-xs text-gray-400 flex justify-between">
          <span>MySpeed Network Analyzer · {generatedAt}</span>
          <span>Dados locais — nenhuma informação enviada a terceiros</span>
        </div>
      </div>

      <style>{`
        @media print {
          body { background: white !important; }
          @page { margin: 1.5cm; }
        }
      `}</style>
    </div>
  )
}
