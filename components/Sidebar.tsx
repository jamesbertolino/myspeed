'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart3, Gauge, Activity, Wifi, Server, Zap, Radio, Settings, Menu, X, Monitor, Shield, LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'

const nav = [
  { href: '/dashboard', icon: BarChart3, label: 'Dashboard' },
  { href: '/speedtest', icon: Gauge, label: 'Teste de Velocidade' },
  { href: '/network', icon: Activity, label: 'Análise de Rede' },
  { href: '/wifi', icon: Wifi, label: 'Analisador WiFi' },
  { href: '/devices', icon: Monitor, label: 'Dispositivos' },
  { href: '/controllers', icon: Server, label: 'Controladores' },
  { href: '/security', icon: Shield, label: 'Centro de Segurança' },
]

const navBottom = [
  { href: '/settings', icon: Settings, label: 'Configurações' },
]

function NavLinks({ onLinkClick }: { onLinkClick?: () => void }) {
  const pathname = usePathname()

  return (
    <>
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {nav.map(({ href, icon: Icon, label }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              onClick={onLinkClick}
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

      <div className="px-3 pb-1">
        {navBottom.map(({ href, icon: Icon, label }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              onClick={onLinkClick}
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
      </div>
    </>
  )
}

function LogoutButton() {
  const router = useRouter()
  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }
  return (
    <div className="px-3 pb-1">
      <button onClick={logout}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-red-400 hover:bg-red-500/5 transition-all">
        <LogOut className="w-4 h-4 shrink-0" />
        <span className="truncate">Sair</span>
      </button>
    </div>
  )
}

function SidebarStatus() {
  return (
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
          <span className="text-gray-400">v2.1.0</span>
        </div>
      </div>
    </div>
  )
}

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-400 to-purple-600 flex items-center justify-center shadow-lg">
        <Zap className="w-5 h-5 text-white" />
      </div>
      <div>
        <h1 className="text-white font-bold text-base leading-none">MySpeed</h1>
        <p className="text-[11px] text-gray-500 mt-0.5">Network Analyzer</p>
      </div>
    </div>
  )
}

export default function Sidebar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  return (
    <>
      {/* ── Desktop Sidebar ── */}
      <aside className="hidden md:flex w-60 shrink-0 bg-[#080e20] border-r border-[#1a2744] flex-col h-screen">
        <div className="px-5 py-5 border-b border-[#1a2744]">
          <Logo />
        </div>
        <NavLinks />
        <LogoutButton />
        <SidebarStatus />
      </aside>

      {/* ── Mobile Top Header ── */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-40 h-14 bg-[#080e20]/95 backdrop-blur-md border-b border-[#1a2744] flex items-center px-4 gap-3">
        <button
          onClick={() => setMobileOpen(true)}
          className="p-2 -ml-1 text-gray-400 hover:text-gray-200 rounded-lg hover:bg-white/5 active:bg-white/10 transition-colors"
          aria-label="Abrir menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-400 to-purple-600 flex items-center justify-center">
            <Zap className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-white font-bold text-sm">MySpeed</span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-gray-600">Latência</span>
          <span className="text-[11px] text-[#00d4ff] mono" id="mobile-latency">—</span>
        </div>
      </header>

      {/* ── Mobile Drawer Backdrop ── */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Mobile Slide-in Drawer ── */}
      <aside
        className={clsx(
          'md:hidden fixed top-0 left-0 z-50 w-72 h-screen bg-[#080e20] border-r border-[#1a2744] flex flex-col shadow-2xl transition-transform duration-300',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="px-5 py-5 border-b border-[#1a2744]">
          <div className="flex items-center justify-between">
            <Logo />
            <button
              onClick={() => setMobileOpen(false)}
              className="p-1.5 text-gray-500 hover:text-gray-300 rounded-lg hover:bg-white/5 active:bg-white/10 transition-colors"
              aria-label="Fechar menu"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <NavLinks onLinkClick={() => setMobileOpen(false)} />
        <LogoutButton />
        <SidebarStatus />
      </aside>
    </>
  )
}
