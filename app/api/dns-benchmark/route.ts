import { NextRequest, NextResponse } from 'next/server'
import { Resolver } from 'dns/promises'

export const runtime = 'nodejs'

const SERVERS = [
  { name: 'Google',          ip: '8.8.8.8',         flag: '🇺🇸' },
  { name: 'Google 2',        ip: '8.8.4.4',         flag: '🇺🇸' },
  { name: 'Cloudflare',      ip: '1.1.1.1',         flag: '🌐' },
  { name: 'Cloudflare 2',    ip: '1.0.0.1',         flag: '🌐' },
  { name: 'OpenDNS',         ip: '208.67.222.222',  flag: '🇺🇸' },
  { name: 'Quad9',           ip: '9.9.9.9',         flag: '🇨🇭' },
  { name: 'AdGuard',         ip: '94.140.14.14',    flag: '🇷🇺' },
  { name: 'Neustar',         ip: '156.154.70.1',    flag: '🇺🇸' },
  { name: 'Comodo',          ip: '8.26.56.26',      flag: '🇺🇸' },
  { name: 'CleanBrowsing',   ip: '185.228.168.9',   flag: '🇩🇪' },
]

const DOMAINS = ['google.com', 'cloudflare.com', 'github.com']
const SAMPLES = 3
const TIMEOUT = 3000

async function measureServer(ip: string): Promise<{ avg: number; samples: number[]; timeout: boolean }> {
  const resolver = new Resolver()
  resolver.setServers([ip])

  const results: number[] = []

  for (const domain of DOMAINS.slice(0, SAMPLES)) {
    const t0 = Date.now()
    try {
      await Promise.race([
        resolver.resolve4(domain),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT)),
      ])
      results.push(Date.now() - t0)
    } catch {
      results.push(TIMEOUT) // conta como penalidade
    }
  }

  const timedOut = results.every(r => r >= TIMEOUT)
  const avg      = Math.round(results.reduce((a, b) => a + b, 0) / results.length)
  return { avg, samples: results, timeout: timedOut }
}

export async function GET(req: NextRequest) {
  const single = req.nextUrl.searchParams.get('ip')

  if (single) {
    // benchmark de um servidor específico (ex: gateway local)
    const safe = /^[0-9.]+$/.test(single) ? single : null
    if (!safe) return NextResponse.json({ error: 'invalid ip' }, { status: 400 })
    const result = await measureServer(safe)
    return NextResponse.json({ ip: safe, ...result })
  }

  // benchmark de todos os servidores em paralelo
  const results = await Promise.all(
    SERVERS.map(async srv => {
      const { avg, samples, timeout } = await measureServer(srv.ip)
      return { ...srv, avg, samples, timeout }
    })
  )

  // ordena pelo menor avg (servidores com timeout vão para o fim)
  results.sort((a, b) => (a.timeout ? 1 : 0) - (b.timeout ? 1 : 0) || a.avg - b.avg)

  return NextResponse.json({ results, domains: DOMAINS.slice(0, SAMPLES), ts: Date.now() })
}
