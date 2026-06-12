import type { Metadata } from 'next'
import './globals.css'
import Sidebar from '@/components/Sidebar'

export const metadata: Metadata = {
  title: 'MySpeed – Network Analyzer',
  description: 'Testes de rede completos: velocidade, latência, jitter, WiFi, UniFi e MikroTik',
  icons: { icon: '/favicon.ico' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-y-auto grid-bg">
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}
