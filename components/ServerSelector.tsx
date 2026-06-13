'use client'

import { useEffect, useState } from 'react'
import { Server, ChevronDown, ChevronUp, Wifi, Loader2, Globe } from 'lucide-react'
import { TestServer } from '@/lib/servers'
import { latencyColor } from '@/lib/utils'
import clsx from 'clsx'

interface Props {
  selected: TestServer | null
  onChange: (server: TestServer) => void
  disabled?: boolean
}

interface ServerWithPing extends TestServer {
  ping?: number
  pinging?: boolean
}

interface StnetServer {
  id: string
  name: string
  sponsor: string
  country: string
  cc: string
  host: string
  lat: string
  lon: string
  distance: number
  url: string
}

type Tab = 'builtin' | 'speedtest'

function stnetToTestServer(s: StnetServer): TestServer {
  // Derive download URL from upload URL (e.g. .../upload.php → .../random4000x4000.jpg)
  const uploadUrl = s.url || ''
  const downloadRemote = uploadUrl
    ? uploadUrl.replace(/upload\.php$/i, 'random4000x4000.jpg')
    : `https://${s.host}/download?size=25000000`

  return {
    id: `stnet-${s.id}`,
    name: s.sponsor,
    location: `${s.name}, ${s.country}`,
    flag: countryFlag(s.cc),
    provider: 'Speedtest.net',
    downloadUrl: `/api/speedtest/download?remote=${encodeURIComponent(downloadRemote)}`,
    uploadUrl: '/api/speedtest/upload',
    pingUrl: `/api/speedtest/ping?target=${encodeURIComponent(s.host.split(':')[0])}`,
    cors: false,
  }
}

function countryFlag(cc: string): string {
  if (!cc || cc.length !== 2) return '🌐'
  const upper = cc.toUpperCase()
  return String.fromCodePoint(0x1F1E6 + upper.charCodeAt(0) - 65, 0x1F1E6 + upper.charCodeAt(1) - 65)
}

export default function ServerSelector({ selected, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('builtin')

  // Built-in servers
  const [servers, setServers] = useState<ServerWithPing[]>([])
  const [cfPop, setCfPop] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Speedtest.net servers
  const [stnetServers, setStnetServers] = useState<(StnetServer & { pinging?: boolean; ping?: number })[]>([])
  const [stnetLoading, setStnetLoading] = useState(false)
  const [stnetError, setStnetError] = useState<string | null>(null)
  const [stnetFetched, setStnetFetched] = useState(false)

  // Load built-in servers + ping them
  useEffect(() => {
    fetch('/api/speedtest/servers')
      .then(r => r.json())
      .then(({ servers: list, cfPop: pop }: { servers: TestServer[]; cfPop: string }) => {
        setCfPop(pop)
        setServers(list.map(s => ({ ...s, pinging: true })))
        setLoading(false)

        list.forEach((s, i) => {
          const t0 = performance.now()
          fetch(`${s.pingUrl}&_=${Date.now()}`, { cache: 'no-store' })
            .then(() => {
              const ms = Math.round(performance.now() - t0)
              setServers(prev => prev.map((p, j) => j === i ? { ...p, ping: ms, pinging: false } : p))
            })
            .catch(() => {
              setServers(prev => prev.map((p, j) => j === i ? { ...p, ping: 9999, pinging: false } : p))
            })
        })
      })
      .catch(() => setLoading(false))
  }, [])

  // Auto-select lowest-ping built-in server once
  useEffect(() => {
    const done = servers.every(s => !s.pinging)
    if (!done || servers.length === 0 || selected) return
    const best = [...servers].filter(s => s.ping !== 9999).sort((a, b) => (a.ping ?? 9999) - (b.ping ?? 9999))[0]
    if (best) onChange(best)
  }, [servers, selected, onChange])

  // Load Speedtest.net servers when tab is opened
  function loadStnet() {
    if (stnetFetched) return
    setStnetLoading(true)
    setStnetError(null)

    // Server resolves client IP geolocation automatically via x-forwarded-for
    fetch('/api/speedtest/stnet-servers?limit=30')
      .then(r => r.json())
      .then(({ servers: list, error }: { servers: StnetServer[]; error?: string }) => {
        if (error && !list?.length) { setStnetError(error); return }
        setStnetServers(list.map(s => ({ ...s, pinging: true })))
        setStnetFetched(true)
        list.forEach((s, i) => {
          // Ping directly from browser using multiple samples, take the minimum.
          // First request warms up DNS/TCP; subsequent ones reflect pure network RTT.
          const base = s.url.replace(/\/upload\.php$/i, '')
          const SAMPLES = 4

          async function measurePing(): Promise<number> {
            const times: number[] = []
            for (let k = 0; k < SAMPLES; k++) {
              const t0 = performance.now()
              try {
                await fetch(`${base}/latency.txt?_=${Date.now()}`, { mode: 'no-cors', cache: 'no-store' })
                times.push(performance.now() - t0)
              } catch {
                // ignore failed sample
              }
            }
            if (times.length === 0) return 9999
            // Drop first sample (DNS overhead), take min of the rest
            const samples = times.length > 1 ? times.slice(1) : times
            return Math.round(Math.min(...samples))
          }

          measurePing().then(ms => {
            setStnetServers(prev => {
              const updated = prev.map((p, j) => j === i ? { ...p, ping: ms, pinging: false } : p)
              return [...updated].sort((a, b) => {
                if (a.pinging && !b.pinging) return 1
                if (!a.pinging && b.pinging) return -1
                return (a.ping ?? 9999) - (b.ping ?? 9999)
              })
            })
          })
        })
      })
      .catch(e => setStnetError(String(e)))
      .finally(() => setStnetLoading(false))
  }

  const currentServer: ServerWithPing | null = selected
    ? (servers.find(s => s.id === selected.id) ?? { ...selected })
    : (servers[0] ?? null)

  const isStnetSelected = selected?.id.startsWith('stnet-')

  return (
    <div className="card p-4 mb-4">
      <button
        className="w-full flex items-center gap-3 text-left"
        onClick={() => { if (!disabled) setOpen(o => !o) }}
        disabled={disabled}
      >
        <Server className="w-4 h-4 text-cyan-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-0.5">Servidor de Teste</div>
          {loading && !isStnetSelected ? (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Loader2 className="w-3 h-3 animate-spin" /> Detectando servidores...
            </div>
          ) : selected ? (
            <div className="flex items-center gap-2">
              <span className="text-base">{selected.flag}</span>
              <span className="text-sm font-semibold text-white truncate">{selected.name}</span>
              <span className="text-xs text-gray-500 truncate">{selected.location}</span>
              {isStnetSelected
                ? <span className="tag tag-cyan shrink-0">Speedtest.net</span>
                : currentServer?.ping && currentServer.ping < 9999
                  ? <span className="text-xs mono shrink-0" style={{ color: latencyColor(currentServer.ping) }}>{currentServer.ping}ms</span>
                  : null
              }
              {cfPop && selected.id === 'cloudflare' && (
                <span className="tag tag-cyan shrink-0">{cfPop}</span>
              )}
            </div>
          ) : null}
        </div>
        {!disabled && (open ? <ChevronUp className="w-4 h-4 text-gray-500 shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" />)}
      </button>

      {open && !disabled && (
        <div className="mt-3 border-t border-[#1a2744] pt-3">
          {/* Tabs */}
          <div className="flex gap-1 mb-3">
            <button
              onClick={() => setTab('builtin')}
              className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                tab === 'builtin' ? 'bg-cyan-500/10 border border-cyan-500/30 text-[#00d4ff]' : 'text-gray-500 hover:text-gray-300')}
            >
              <Server className="w-3 h-3" /> Embutidos
            </button>
            <button
              onClick={() => { setTab('speedtest'); loadStnet() }}
              className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                tab === 'speedtest' ? 'bg-cyan-500/10 border border-cyan-500/30 text-[#00d4ff]' : 'text-gray-500 hover:text-gray-300')}
            >
              <Globe className="w-3 h-3" /> Speedtest.net
            </button>
          </div>

          {/* Built-in list */}
          {tab === 'builtin' && (
            <div className="space-y-1">
              {servers.map(s => {
                const isSelected = selected?.id === s.id
                const pingOk = s.ping !== undefined && s.ping < 9999
                return (
                  <button
                    key={s.id}
                    onClick={() => { onChange(s); setOpen(false) }}
                    className={clsx(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all',
                      isSelected ? 'bg-cyan-500/10 border border-cyan-500/30' : 'hover:bg-white/5 border border-transparent'
                    )}
                  >
                    <span className="text-base w-5 text-center shrink-0">{s.flag}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white">{s.name}</div>
                      <div className="text-xs text-gray-500">{s.provider} · {s.location}</div>
                    </div>
                    <div className="shrink-0 w-14 text-right">
                      {s.pinging ? (
                        <Loader2 className="w-3 h-3 animate-spin text-gray-600 ml-auto" />
                      ) : pingOk ? (
                        <span className="text-xs mono" style={{ color: latencyColor(s.ping!) }}>{s.ping}ms</span>
                      ) : (
                        <span className="text-xs text-gray-600">—</span>
                      )}
                    </div>
                    {isSelected && <Wifi className="w-3.5 h-3.5 text-cyan-400 shrink-0" />}
                  </button>
                )
              })}
            </div>
          )}

          {/* Speedtest.net list */}
          {tab === 'speedtest' && (
            <div>
              {stnetLoading && (
                <div className="flex items-center gap-2 text-sm text-gray-400 py-4 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" /> Buscando servidores Speedtest.net...
                </div>
              )}
              {stnetError && (
                <div className="text-xs text-red-400 py-3 text-center">{stnetError}</div>
              )}
              {!stnetLoading && !stnetError && stnetServers.length === 0 && stnetFetched && (
                <div className="text-xs text-gray-500 py-3 text-center">Nenhum servidor encontrado</div>
              )}
              <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                {stnetServers.map((s) => {
                  const srv = stnetToTestServer(s)
                  const isSelected = selected?.id === srv.id
                  const pingOk = s.ping !== undefined && s.ping < 9999
                  return (
                    <button
                      key={s.id}
                      onClick={() => { onChange(srv); setOpen(false) }}
                      className={clsx(
                        'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all',
                        isSelected ? 'bg-cyan-500/10 border border-cyan-500/30' : 'hover:bg-white/5 border border-transparent'
                      )}
                    >
                      <span className="text-base w-5 text-center shrink-0">{countryFlag(s.cc)}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-white truncate">{s.sponsor}</div>
                        <div className="text-xs text-gray-500 truncate">
                          {s.name}, {s.country} · {Math.round(s.distance)} km
                          {s.ip && <span className="text-gray-600"> · {s.ip}</span>}
                        </div>
                      </div>
                      <div className="shrink-0 w-14 text-right">
                        {s.pinging ? (
                          <Loader2 className="w-3 h-3 animate-spin text-gray-600 ml-auto" />
                        ) : pingOk ? (
                          <span className="text-xs mono" style={{ color: latencyColor(s.ping!) }}>{s.ping}ms</span>
                        ) : (
                          <span className="text-xs text-gray-600">—</span>
                        )}
                      </div>
                      {isSelected && <Wifi className="w-3.5 h-3.5 text-cyan-400 shrink-0" />}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
