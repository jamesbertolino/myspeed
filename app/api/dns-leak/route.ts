import { NextRequest, NextResponse } from 'next/server'
import dns from 'dns'
import { promisify } from 'util'

export const runtime = 'nodejs'

const RESOLVERS = [
  { name: 'Cloudflare',   ip: '1.1.1.1'       },
  { name: 'Google',       ip: '8.8.8.8'        },
  { name: 'OpenDNS',      ip: '208.67.222.222' },
  { name: 'Quad9',        ip: '9.9.9.9'        },
]

const TEST_DOMAIN = 'example.com'

async function resolveWith(resolverIp: string, domain: string): Promise<string[]> {
  return new Promise(resolve => {
    const resolver = new dns.Resolver()
    resolver.setServers([resolverIp])
    resolver.resolve4(domain, (err, addrs) => {
      resolve(err ? [] : addrs)
    })
  })
}

async function getSystemDns(): Promise<string[]> {
  try {
    const servers = dns.getServers()
    return servers
  } catch {
    return []
  }
}

export async function GET(req: NextRequest) {
  const domain = req.nextUrl.searchParams.get('domain') || TEST_DOMAIN

  const [systemServers, ...resolverResults] = await Promise.all([
    getSystemDns(),
    ...RESOLVERS.map(r => resolveWith(r.ip, domain).then(addrs => ({ ...r, addrs, ok: addrs.length > 0 }))),
  ])

  // Resolve using system DNS
  const systemAddrs = await promisify(dns.resolve4)(domain).catch(() => [] as string[])

  // Check if system DNS server is a known public resolver
  const knownPublic = ['1.1.1.1', '1.0.0.1', '8.8.8.8', '8.8.4.4', '208.67.222.222', '208.67.220.220', '9.9.9.9', '149.112.112.112']
  const systemIsPublic = systemServers.some(s => knownPublic.includes(s.replace(/:\d+$/, '')))
  const systemName = systemIsPublic
    ? systemServers[0]?.includes('1.1.1') ? 'Cloudflare'
    : systemServers[0]?.includes('8.8') ? 'Google'
    : systemServers[0]?.includes('208.67') ? 'OpenDNS'
    : systemServers[0]?.includes('9.9.9') ? 'Quad9'
    : 'Público'
    : 'ISP / Provedor'

  // Check for potential hijacking: compare system result vs public resolvers
  const publicAddrs = resolverResults.find(r => r.ok)?.addrs ?? []
  const hijackSuspect = publicAddrs.length > 0 && systemAddrs.length > 0
    && !systemAddrs.some(a => publicAddrs.includes(a))

  return NextResponse.json({
    domain,
    systemServers,
    systemName,
    systemAddrs,
    systemIsPublic,
    resolvers: resolverResults,
    hijackSuspect,
    leakRisk: !systemIsPublic,
  })
}
