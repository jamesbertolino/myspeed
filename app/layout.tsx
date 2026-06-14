import type { Metadata, Viewport } from 'next'
import './globals.css'
import Sidebar from '@/components/Sidebar'
import EcgMonitor from '@/components/EcgMonitor'

export const metadata: Metadata = {
  title: 'MySpeed – Network Analyzer',
  description: 'Testes de rede completos: velocidade, latência, jitter, WiFi, UniFi e MikroTik',
  icons: { icon: '/favicon.ico' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#080e20',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <div className="flex-1 flex flex-col min-h-0">
            <EcgMonitor />
            <main className="flex-1 overflow-y-auto grid-bg pt-14 md:pt-0">
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  )
}
