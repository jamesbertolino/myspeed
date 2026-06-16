import { NextRequest, NextResponse } from 'next/server'
import { Resolver } from 'dns/promises'

export const runtime = 'nodejs'

// Mede latência DNS via UDP puro — equivalente ao nslookup no CMD.
// Roda server-side: quando a app é local, o servidor É a máquina do usuário.

const SERVERS = [
  { name: 'Cloudflare',    ip: '1.1.1.1',        flag: '🌐' },
  { name: 'Cloudflare 2',  ip: '1.0.0.1',        flag: '🌐' },
  { name: 'Google',        ip: '8.8.8.8',        flag: '🇺🇸' },
  { name: 'Google 2',      ip: '8.8.4.4',        flag: '🇺🇸' },
  { name: 'Quad9',         ip: '9.9.9.9',        flag: '🇨🇭' },
  { name: 'OpenDNS',       ip: '208.67.222.222', flag: '🇺🇸' },
  { name: 'AdGuard',       ip: '94.140.14.14',   flag: '🛡️'  },
  { name: 'CleanBrowsing', ip: '185.228.168.9',  flag: '🧹' },
  { name: 'Neustar',       ip: '156.154.70.1',   flag: '🇺🇸' },
  { name: 'Comodo',        ip: '8.26.56.26',     flag: '🇺🇸' },
]

const DOMAINS  = ['google.com', 'cloudflare.com', 'github.com']
const TIMEOUT  = 3000

async function measureServer(ip: string): Promise<{ avg: number; samples: number[]; timeout: boolean }> {
  const resolver = new Resolver()
  resolver.setServers([ip])
  const samples: number[] = []

  for (const domain of DOMAINS) {
    const t0 = Date.now()
    try {
      await Promise.race([
        resolver.resolve4(domain),
        new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), TIMEOUT)),
      ])
      samples.push(Date.now() - t0)
    } catch {
      samples.push(TIMEOUT)
    }
  }

  const timeout = samples.every(s => s >= TIMEOUT)
  const avg     = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length)
  return { avg, samples, timeout }
}

export async function GET(req: NextRequest) {
  const customIp = req.nextUrl.searchParams.get('ip')

  if (customIp) {
    if (!/^[0-9.a-fA-F:]+$/.test(customIp)) {
      return NextResponse.json({ error: 'invalid ip' }, { status: 400 })
    }
    const result = await measureServer(customIp)
    return NextResponse.json({ ip: customIp, name: 'Personalizado', flag: '⚙️', ...result })
  }

  // todos os servidores em paralelo
  const results = await Promise.all(
    SERVERS.map(async srv => ({ ...srv, ...(await measureServer(srv.ip)) }))
  )
  results.sort((a, b) => (a.timeout ? 1 : 0) - (b.timeout ? 1 : 0) || a.avg - b.avg)

  return NextResponse.json({ results, domains: DOMAINS, ts: Date.now() })
}
