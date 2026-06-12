'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart3, Gauge, Activity, Wifi, Server, Zap, Radio } from 'lucide-react'
import clsx from 'clsx'

const nav = [
  { href: '/', icon: BarChart3, label: 'Dashboard' },
  { href: '/speedtest', icon: Gauge, label: 'Teste de Velocidade' },
  { href: '/network', icon: Activity, label: 'Análise de Rede' },
  { href: '/wifi', icon: Wifi, label: 'Analisador WiFi' },
  { href: '/controllers', icon: Server, label: 'Controladores' },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-60 shrink-0 bg-[#080e20] border-r border-[#1a2744] flex flex-col h-screen">
      <div className="px-5 py-5 border-b border-[#1a2744]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-400 to-purple-600 flex items-center justify-center shadow-lg">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-white font-bold text-base leading-none">MySpeed</h1>
            <p className="text-[11px] text-gray-500 mt-0.5">Network Analyzer</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {nav.map(({ href, icon: Icon, label }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                active
                  ? 'bg-cyan-500/10 text-[#00d4ff] border border-cyan-500/20'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
              )}
            >
              <Icon className={clsx('w-4 h-4 shrink-0', active && 'text-[#00d4ff]')} />
              <span className="truncate">{label}</span>
              {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#00d4ff] shrink-0" />}
            </Link>
          )
        })}
      </nav>

      <div className="px-5 py-4 border-t border-[#1a2744]">
        <div className="flex items-center gap-2 mb-3">
          <Radio className="w-3.5 h-3.5 text-[#00ff88]" />
          <span className="text-[11px] text-gray-500 font-medium">STATUS DO SISTEMA</span>
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between text-[11px]">
            <span className="text-gray-500">Latência</span>
            <span className="text-[#00d4ff] mono" id="sidebar-latency">—</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-gray-500">Versão</span>
            <span className="text-gray-400">v1.0.0</span>
          </div>
        </div>
      </div>
    </aside>
  )
}
