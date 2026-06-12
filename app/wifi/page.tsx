'use client'

import { useState, useCallback, useEffect } from 'react'
import { Wifi, Plus, Trash2, Info, CheckCircle, AlertTriangle, Radio, ScanLine, RefreshCw, Puzzle } from 'lucide-react'
import WiFiChannelMap, { WiFiNetwork } from '@/components/WiFiChannelMap'
import { NON_OVERLAPPING_24, NON_OVERLAPPING_5 } from '@/lib/utils'
import clsx from 'clsx'

const CHANNELS_24 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
const CHANNELS_5 = [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165]

const EXAMPLE_NETWORKS_24: WiFiNetwork[] = [
  { ssid: 'HomeWiFi', channel: 6, signal: -45, band: '2.4', width: 20 },
  { ssid: 'Neighbor-1', channel: 6, signal: -72, band: '2.4', width: 20 },
  { ssid: 'Neighbor-2', channel: 11, signal: -65, band: '2.4', width: 20 },
  { ssid: 'Office-Net', channel: 1, signal: -80, band: '2.4', width: 20 },
]

const EXAMPLE_NETWORKS_5: WiFiNetwork[] = [
  { ssid: 'HomeWiFi_5G', channel: 36, signal: -50, band: '5', width: 80 },
  { ssid: 'Neighbor_5G', channel: 40, signal: -70, band: '5', width: 40 },
  { ssid: 'Office_5G', channel: 149, signal: -68, band: '5', width: 80 },
]

function bestChannel(networks: WiFiNetwork[], band: '2.4' | '5'): number {
  const candidates = band === '2.4' ? NON_OVERLAPPING_24 : NON_OVERLAPPING_5
  const scores: Record<number, number> = {}
  candidates.forEach(ch => { scores[ch] = 0 })
  networks.filter(n => n.band === band).forEach(n => {
    candidates.forEach(ch => {
      const dist = Math.abs(n.channel - ch)
      if (band === '2.4' && dist < 5) scores[ch] -= Math.max(0, 100 + n.signal) * (1 - dist / 5)
      else if (band === '5' && dist < 4) scores[ch] -= Math.max(0, 100 + n.signal) * 0.5
    })
  })
  return candidates.reduce((best, ch) => scores[ch] > scores[best] ? ch : best, candidates[0])
}

export default function WiFiPage() {
  const [band, setBand] = useState<'2.4' | '5'>('2.4')
  const [networks, setNetworks] = useState<WiFiNetwork[]>([...EXAMPLE_NETWORKS_24, ...EXAMPLE_NETWORKS_5])
  const [showAdd, setShowAdd] = useState(false)
  const [newNet, setNewNet] = useState<Partial<WiFiNetwork>>({ band: '2.4', width: 20, security: 'WPA2' })
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [isRealData, setIsRealData] = useState(false)
  const [extensionReady, setExtensionReady] = useState(false)

  // Detect if the MySpeed WiFi extension is installed and active
  useEffect(() => {
    const onReady = () => setExtensionReady(true)
    window.addEventListener('myspeed:extension-ready', onReady)
    return () => window.removeEventListener('myspeed:extension-ready', onReady)
  }, [])

  // Ask the extension (content script bridge) for a WiFi scan
  const scanViaExtension = (): Promise<WiFiNetwork[] | null> =>
    new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 4000)
      window.addEventListener('myspeed:wifi-scan-response', (e) => {
        clearTimeout(timeout)
        const detail = (e as CustomEvent).detail
        resolve(detail?.networks?.length > 0 ? detail.networks : null)
      }, { once: true })
      window.dispatchEvent(new CustomEvent('myspeed:wifi-scan-request'))
    })

  const scanNetworks = useCallback(async () => {
    setScanning(true)
    setScanError(null)
    try {
      // 1. Try extension first (works on Vercel too)
      if (extensionReady) {
        const extNetworks = await scanViaExtension()
        if (extNetworks) {
          setNetworks(extNetworks)
          setIsRealData(true)
          return
        }
      }

      // 2. Fall back to server-side API (works only when running locally)
      const res = await fetch('/api/wifi/scan')
      const data = await res.json()
      if (data.error) {
        setScanError(data.error)
      } else if (data.networks?.length > 0) {
        setNetworks(data.networks)
        setIsRealData(true)
      } else {
        setScanError('Nenhuma rede encontrada. Verifique se o WiFi está ativo.')
      }
    } catch {
      setScanError('Erro ao conectar com a API de scan.')
    } finally {
      setScanning(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extensionReady])

  const currentBandNets = networks.filter(n => n.band === band)
  const recommended = bestChannel(networks, band)

  const addNetwork = () => {
    if (!newNet.ssid || !newNet.channel || !newNet.signal) return
    setNetworks(prev => [...prev, newNet as WiFiNetwork])
    setShowAdd(false)
    setNewNet({ band, width: 20, security: 'WPA2' })
  }

  const removeNetwork = (i: number) => {
    setNetworks(prev => prev.filter((_, idx) => {
      const bandNets = prev.filter(n => n.band === band)
      return prev.indexOf(bandNets[i]) !== prev.indexOf(prev[prev.indexOf(bandNets[0]) + i])
    }))
  }

  // Get channel interference score
  const getInterference = (ch: number): 'none' | 'low' | 'medium' | 'high' => {
    const others = networks.filter(n => n.band === band && n.ssid !== currentBandNets[0]?.ssid)
    const nearby = others.filter(n => Math.abs(n.channel - ch) < (band === '2.4' ? 5 : 4))
    if (nearby.length === 0) return 'none'
    if (nearby.length === 1) return 'low'
    if (nearby.length === 2) return 'medium'
    return 'high'
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Analisador WiFi</h1>
          <p className="text-sm text-gray-500 mt-1">
            Visualize canais, interferências e recomendações
            {isRealData && <span className="ml-2 tag tag-green">Dados reais</span>}
          </p>
        </div>
        <button
          onClick={scanNetworks}
          disabled={scanning}
          className="btn-cyan px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 shrink-0 disabled:opacity-50"
        >
          {scanning
            ? <RefreshCw className="w-4 h-4 animate-spin" />
            : <ScanLine className="w-4 h-4" />}
          {scanning ? 'Escaneando...' : 'Escanear Redes'}
        </button>
      </div>

      {!extensionReady && (
        <div className="mb-4 px-4 py-3 rounded-lg border border-[#1a2744] bg-[#050a1a] text-gray-400 text-sm flex items-start gap-3">
          <Puzzle className="w-4 h-4 mt-0.5 shrink-0 text-cyan-400" />
          <div>
            <span className="font-semibold text-white">Extensão não detectada</span>
            <p className="text-xs text-gray-500 mt-0.5">
              Para escanear redes reais no Vercel, instale a extensão Chrome em{' '}
              <code className="bg-[#0a1128] px-1 rounded">extension/</code> e execute{' '}
              <code className="bg-[#0a1128] px-1 rounded">native-host/install.ps1</code>.
              Localmente, <code className="bg-[#0a1128] px-1 rounded">npm run dev</code> funciona sem extensão.
            </p>
          </div>
        </div>
      )}

      {scanError && (
        <div className="mb-4 px-4 py-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5 text-yellow-400 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold">Scan indisponível:</span> {scanError}
          </div>
        </div>
      )}

      {/* Band Selector */}
      <div className="flex gap-1 mb-6 bg-[#0a1128] rounded-xl p-1 border border-[#1a2744] w-fit">
        {(['2.4', '5'] as const).map(b => (
          <button
            key={b}
            onClick={() => setBand(b)}
            className={clsx(
              'px-5 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2',
              band === b ? 'bg-[#1a2744] text-white' : 'text-gray-500 hover:text-gray-300'
            )}
          >
            <Radio className="w-4 h-4" />
            {b} GHz
          </button>
        ))}
      </div>

      {/* Channel Map */}
      <div className="card p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-white">Mapa de Canais — {band} GHz</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {band === '2.4'
                ? 'Canais não sobrepostos: 1, 6 e 11 (recomendados)'
                : 'Canais UNII-1 (36–48) e UNII-3 (149–165) preferidos'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Melhor canal disponível:</span>
            <span className="tag tag-green">CH {recommended}</span>
          </div>
        </div>
        <WiFiChannelMap band={band} networks={networks} highlight={recommended} />
      </div>

      {/* Networks List + Add */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white">Redes Detectadas — {band} GHz</h3>
            <button
              onClick={() => setShowAdd(!showAdd)}
              className="btn-cyan px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              Adicionar
            </button>
          </div>

          {showAdd && (
            <div className="bg-[#050a1a] rounded-xl p-4 mb-4 border border-[#1a2744] space-y-3">
              <h4 className="text-xs font-semibold text-gray-400 uppercase">Nova Rede</h4>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">SSID</label>
                  <input className="dark-input text-xs" placeholder="Nome da rede"
                    value={newNet.ssid || ''} onChange={e => setNewNet(p => ({ ...p, ssid: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Canal</label>
                  <select className="bg-[#0a1128] border border-[#1a2744] text-gray-300 text-xs rounded-lg px-2 py-2 w-full outline-none"
                    value={newNet.channel || ''} onChange={e => setNewNet(p => ({ ...p, channel: parseInt(e.target.value), band }))}>
                    <option value="">Selecionar</option>
                    {(band === '2.4' ? CHANNELS_24 : CHANNELS_5).map(ch => <option key={ch}>{ch}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Sinal (dBm)</label>
                  <input className="dark-input text-xs" type="number" placeholder="-70" min="-100" max="0"
                    value={newNet.signal || ''} onChange={e => setNewNet(p => ({ ...p, signal: parseInt(e.target.value) }))} />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Largura (MHz)</label>
                  <select className="bg-[#0a1128] border border-[#1a2744] text-gray-300 text-xs rounded-lg px-2 py-2 w-full outline-none"
                    value={newNet.width || 20} onChange={e => setNewNet(p => ({ ...p, width: parseInt(e.target.value) as 20 | 40 | 80 | 160 }))}>
                    <option value={20}>20 MHz</option>
                    <option value={40}>40 MHz</option>
                    {band === '5' && <option value={80}>80 MHz</option>}
                    {band === '5' && <option value={160}>160 MHz</option>}
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={addNetwork} className="btn-cyan px-3 py-1.5 rounded-lg text-xs font-semibold flex-1">Adicionar</button>
                <button onClick={() => setShowAdd(false)} className="text-gray-500 hover:text-gray-300 px-3 py-1.5 text-xs">Cancelar</button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {currentBandNets.length === 0 ? (
              <p className="text-gray-600 text-sm text-center py-4">Nenhuma rede cadastrada</p>
            ) : (
              currentBandNets.map((net, i) => {
                const signalPct = Math.max(0, Math.min(100, ((net.signal + 100) / 70) * 100))
                const sigColor = signalPct > 60 ? '#00ff88' : signalPct > 30 ? '#ffd700' : '#ff4d4d'
                return (
                  <div key={i} className="bg-[#050a1a] rounded-lg px-3 py-2.5 border border-[#1a2744] flex items-center gap-3">
                    <Wifi className="w-4 h-4 shrink-0" style={{ color: sigColor }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-white font-medium truncate">{net.ssid}</span>
                        <span className="tag tag-cyan shrink-0">CH {net.channel}</span>
                        {net.width && net.width > 20 && <span className="tag tag-purple shrink-0">{net.width}MHz</span>}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="progress-bar flex-1" style={{ height: 3 }}>
                          <div className="progress-fill" style={{ width: `${signalPct}%`, background: sigColor }} />
                        </div>
                        <span className="text-xs mono shrink-0" style={{ color: sigColor }}>{net.signal}dBm</span>
                      </div>
                    </div>
                    <button onClick={() => {
                      setNetworks(prev => {
                        const bn = prev.filter(n => n.band === band)
                        const target = bn[i]
                        return prev.filter(n => n !== target)
                      })
                    }} className="text-gray-600 hover:text-red-400 transition-colors shrink-0">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Channel Recommendations */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Recomendações de Canal</h3>

          <div className="space-y-2">
            {(band === '2.4' ? NON_OVERLAPPING_24 : NON_OVERLAPPING_5.slice(0, 8)).map(ch => {
              const interference = getInterference(ch)
              const isRecommended = ch === recommended
              const icon = interference === 'none' ? CheckCircle :
                interference === 'low' ? Info : AlertTriangle
              const color = interference === 'none' ? '#00ff88' :
                interference === 'low' ? '#00d4ff' :
                interference === 'medium' ? '#ffd700' : '#ff4d4d'
              const label = interference === 'none' ? 'Livre' :
                interference === 'low' ? 'Baixa interferência' :
                interference === 'medium' ? 'Interferência moderada' : 'Alta interferência'

              return (
                <div
                  key={ch}
                  className={clsx(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all',
                    isRecommended
                      ? 'border-green-500/30 bg-green-500/5'
                      : 'border-[#1a2744] bg-[#050a1a]'
                  )}
                >
                  <span className="text-xs font-bold mono w-12" style={{ color: isRecommended ? '#00ff88' : '#94a3b8' }}>
                    CH {ch}
                  </span>
                  {React.createElement(icon, { className: 'w-4 h-4 shrink-0', style: { color } })}
                  <span className="text-xs text-gray-400 flex-1">{label}</span>
                  {isRecommended && <span className="tag tag-green">Recomendado</span>}
                </div>
              )
            })}
          </div>

          <div className="mt-4 p-3 bg-[#050a1a] rounded-lg border border-[#1a2744]">
            <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Dicas</h4>
            <ul className="space-y-1 text-xs text-gray-500">
              {band === '2.4' ? (
                <>
                  <li>• Use apenas canais 1, 6 ou 11 para evitar sobreposição</li>
                  <li>• Prefira 5 GHz se disponível (menos interferência)</li>
                  <li>• Largura de canal 20 MHz é ideal em ambientes com muitas redes</li>
                </>
              ) : (
                <>
                  <li>• Canais UNII-1 (36-48) têm menor interferência</li>
                  <li>• 80 MHz oferece maior velocidade, mas pode ter mais interferência</li>
                  <li>• DFS (52-144) pode ser bloqueado em alguns locais</li>
                </>
              )}
            </ul>
          </div>
        </div>
      </div>

      {/* Frequency Reference */}
      <div className="card p-5 mt-4">
        <h3 className="text-sm font-semibold text-white mb-3">Referência de Canais — {band} GHz</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 uppercase tracking-wider border-b border-[#1a2744]">
                <th className="text-left pb-2">Canal</th>
                <th className="text-left pb-2">Frequência</th>
                <th className="text-left pb-2">Status</th>
                <th className="text-left pb-2">Interferência</th>
              </tr>
            </thead>
            <tbody>
              {(band === '2.4' ? CHANNELS_24 : CHANNELS_5).map(ch => {
                const freq = band === '2.4'
                  ? (ch === 14 ? 2484 : 2412 + (ch - 1) * 5)
                  : (ch >= 36 && ch <= 64 ? 5180 + (ch - 36) * 5 :
                    ch >= 100 && ch <= 144 ? 5500 + (ch - 100) * 5 :
                    5745 + (ch - 149) * 5)
                const isNonOverlap = band === '2.4' ? NON_OVERLAPPING_24.includes(ch) : NON_OVERLAPPING_5.includes(ch)
                const inter = getInterference(ch)
                return (
                  <tr key={ch} className="border-b border-[#1a2744]/30 hover:bg-white/2">
                    <td className="py-1.5 mono font-bold" style={{ color: ch === recommended ? '#00ff88' : '#e2e8f0' }}>
                      {ch}
                    </td>
                    <td className="py-1.5 mono text-gray-400">{freq} MHz</td>
                    <td className="py-1.5">
                      {isNonOverlap ? (
                        <span className="tag tag-cyan">Não sobreposto</span>
                      ) : (
                        <span className="text-gray-600">Sobreposição</span>
                      )}
                    </td>
                    <td className="py-1.5">
                      <span className={clsx('tag', inter === 'none' ? 'tag-green' : inter === 'low' ? 'tag-cyan' : inter === 'medium' ? 'tag-yellow' : 'tag-red')}>
                        {inter === 'none' ? 'Nenhuma' : inter === 'low' ? 'Baixa' : inter === 'medium' ? 'Média' : 'Alta'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// Need React for createElement
import React from 'react'
