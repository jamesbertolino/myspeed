import { NextRequest, NextResponse } from 'next/server'
import dns from 'dns/promises'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const domain = request.nextUrl.searchParams.get('domain') || 'google.com'
  const type = request.nextUrl.searchParams.get('type') || 'A'

  if (!/^[a-zA-Z0-9.\-]+$/.test(domain)) {
    return NextResponse.json({ error: 'Invalid domain' }, { status: 400 })
  }

  const start = Date.now()
  const results: Record<string, unknown> = { domain, type, elapsed: 0 }

  try {
    switch (type.toUpperCase()) {
      case 'A': {
        const addrs = await dns.resolve4(domain)
        results.records = addrs
        break
      }
      case 'AAAA': {
        const addrs = await dns.resolve6(domain)
        results.records = addrs
        break
      }
      case 'MX': {
        const records = await dns.resolveMx(domain)
        results.records = records
        break
      }
      case 'TXT': {
        const records = await dns.resolveTxt(domain)
        results.records = records.map(r => r.join(' '))
        break
      }
      case 'NS': {
        const records = await dns.resolveNs(domain)
        results.records = records
        break
      }
      case 'CNAME': {
        const records = await dns.resolveCname(domain)
        results.records = records
        break
      }
      case 'PTR': {
        const records = await dns.resolvePtr(domain)
        results.records = records
        break
      }
      case 'SOA': {
        const record = await dns.resolveSoa(domain)
        results.records = [record]
        break
      }
      case 'ALL': {
        const [a, mx, ns, txt] = await Promise.allSettled([
          dns.resolve4(domain),
          dns.resolveMx(domain),
          dns.resolveNs(domain),
          dns.resolveTxt(domain),
        ])
        results.A = a.status === 'fulfilled' ? a.value : []
        results.MX = mx.status === 'fulfilled' ? mx.value : []
        results.NS = ns.status === 'fulfilled' ? ns.value : []
        results.TXT = txt.status === 'fulfilled' ? txt.value.map(r => r.join(' ')) : []
        break
      }
      default:
        return NextResponse.json({ error: 'Unknown type' }, { status: 400 })
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'DNS lookup failed'
    return NextResponse.json({ error: message, domain, type }, { status: 422 })
  }

  results.elapsed = Date.now() - start
  return NextResponse.json(results)
}
