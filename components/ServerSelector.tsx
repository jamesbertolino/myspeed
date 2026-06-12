'use client'

import { useEffect, useState } from 'react'
import { Server, ChevronDown, ChevronUp, Wifi, Loader2 } from 'lucide-react'
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

export default function ServerSelector({ selected, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [servers, setServers] = useState<ServerWithPing[]>([])
  const [cfPop, setCfPop] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/speedtest/servers')
      .then(r => r.json())
      .then(({ servers: list, cfPop: pop }: { servers: TestServer[]; cfPop: string }) => {
        setCfPop(pop)
        setServers(list.map(s => ({ ...s, pinging: true })))
        setLoading(false)

        // Measure ping for each server in parallel
        list.forEach((s, i) => {
          const pingUrl = s.cors
            ? `${s.pingUrl}&_=${Date.now()}`
            : `${s.pingUrl}&_=${Date.now()}`

          const t0 = performance.now()
          fetch(pingUrl, { cache: 'no-store' })
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

  // Auto-select the lowest-ping server once all pings are done
  useEffect(() => {
    const done = servers.every(s => !s.pinging)
    if (!done || servers.length === 0 || selected) return
    const best = [...servers].filter(s => s.ping !== 9999).sort((a, b) => (a.ping ?? 9999) - (b.ping ?? 9999))[0]
    if (best) onChange(best)
  }, [servers, selected, onChange])

  const currentServer: ServerWithPing | null = selected
    ? (servers.find(s => s.id === selected.id) ?? { ...selected })
    : (servers[0] ?? null)

  return (
    <div className="card p-4 mb-4">
      <button
        className="w-full flex items-center gap-3 text-left"
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
      >
        <Server className="w-4 h-4 text-cyan-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-0.5">Servidor de Teste</div>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Loader2 className="w-3 h-3 animate-spin" /> Detectando servidores...
            </div>
          ) : currentServer ? (
            <div className="flex items-center gap-2">
              <span className="text-base">{currentServer.flag}</span>
              <span className="text-sm font-semibold text-white truncate">{currentServer.name}</span>
              <span className="text-xs text-gray-500 truncate">{currentServer.location}</span>
              {currentServer.ping && currentServer.ping < 9999 && (
                <span className="text-xs mono shrink-0" style={{ color: latencyColor(currentServer.ping) }}>
                  {currentServer.ping}ms
                </span>
              )}
              {cfPop && currentServer.id === 'cloudflare' && (
                <span className="tag tag-cyan shrink-0">{cfPop}</span>
              )}
            </div>
          ) : null}
        </div>
        {!disabled && (open ? <ChevronUp className="w-4 h-4 text-gray-500 shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" />)}
      </button>

      {open && !disabled && (
        <div className="mt-3 space-y-1 border-t border-[#1a2744] pt-3">
          {servers.map(s => {
            const isSelected = selected?.id === s.id
            const pingOk = s.ping !== undefined && s.ping < 9999
            return (
              <button
                key={s.id}
                onClick={() => { onChange(s); setOpen(false) }}
                className={clsx(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all',
                  isSelected
                    ? 'bg-cyan-500/10 border border-cyan-500/30'
                    : 'hover:bg-white/5 border border-transparent'
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
    </div>
  )
}
