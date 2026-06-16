import { NextRequest, NextResponse } from 'next/server'
import { Resolver } from 'dns/promises'

export const runtime = 'nodejs'

// Usado SOMENTE para IPs personalizados (ex: gateway local) que não têm DoH.
// Os servidores conhecidos são medidos client-side via DoH.
export async function GET(req: NextRequest) {
  const ip = req.nextUrl.searchParams.get('ip') ?? ''
  if (!/^[0-9.a-fA-F:]+$/.test(ip)) {
    return NextResponse.json({ error: 'invalid ip' }, { status: 400 })
  }

  const resolver = new Resolver()
  resolver.setServers([ip])
  const domains  = ['google.com', 'cloudflare.com', 'github.com']
  const samples: number[] = []

  for (const domain of domains) {
    const t0 = Date.now()
    try {
      await Promise.race([
        resolver.resolve4(domain),
        new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 3000)),
      ])
      samples.push(Date.now() - t0)
    } catch {
      samples.push(3000)
    }
  }

  const avg     = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length)
  const timeout = samples.every(s => s >= 3000)
  return NextResponse.json({ ip, avg, samples, timeout })
}
