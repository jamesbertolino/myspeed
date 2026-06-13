import { NextRequest, NextResponse } from 'next/server'
import dns from 'dns/promises'

export const runtime = 'nodejs'

const DNSBL_LISTS = [
  { name: 'Spamhaus ZEN', host: 'zen.spamhaus.org', description: 'IPs conhecidos por spam e malware' },
  { name: 'SpamCop', host: 'bl.spamcop.net', description: 'Reportado por usuários como spam' },
  { name: 'SORBS', host: 'dnsbl.sorbs.net', description: 'IPs com comportamento abusivo' },
  { name: 'Barracuda', host: 'b.barracudacentral.org', description: 'Base de reputação anti-spam' },
  { name: 'UCEPROTECT', host: 'dnsbl-1.uceprotect.net', description: 'Proteção contra spam' },
]

async function checkDNSBL(ip: string) {
  const reversed = ip.split('.').reverse().join('.')
  return Promise.all(DNSBL_LISTS.map(async list => {
    try {
      const addrs = await dns.resolve4(`${reversed}.${list.host}`)
      return { ...list, listed: true, returnCode: addrs[0] }
    } catch {
      return { ...list, listed: false, returnCode: null }
    }
  }))
}

async function checkTor(ip: string): Promise<boolean> {
  try {
    const reversed = ip.split('.').reverse().join('.')
    await dns.resolve4(`${reversed}.dnsel.torproject.org`)
    return true
  } catch { return false }
}

async function getIPInfo(ip: string) {
  try {
    const res = await fetch(`https://ipinfo.io/${ip}/json`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const d = await res.json()
    if (d.bogon) return null
    return {
      ip: d.ip,
      city: d.city,
      region: d.region,
      country: d.country,
      org: d.org,
      asn: d.org?.split(' ')[0],
      isp: d.org?.split(' ').slice(1).join(' '),
      timezone: d.timezone,
      loc: d.loc,
      hostname: d.hostname,
    }
  } catch { return null }
}

function classifyASN(org: string): { type: string; label: string } {
  const o = (org ?? '').toLowerCase()
  if (/google|amazon|microsoft|cloudflare|akamai|fastly|aws|azure|gcp/.test(o)) return { type: 'cloud', label: 'Provedor Cloud/CDN' }
  if (/tor|vpn|proxy|mullvad|nordvpn|expressvpn|protonvpn|surfshark/.test(o)) return { type: 'vpn', label: 'VPN / Anonimizador' }
  if (/telecom|vivo|claro|tim|oi|alares|net combo|copel|sercomtel/.test(o)) return { type: 'isp', label: 'ISP Residencial/Corporativo' }
  if (/hosting|server|datacenter|colocation|hetzner|ovh|vultr|linode|digitalocean/.test(o)) return { type: 'hosting', label: 'Hosting / Datacenter' }
  return { type: 'unknown', label: 'Desconhecido' }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const ip = searchParams.get('ip') ?? ''

  if (!ip || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    return NextResponse.json({ error: 'IP IPv4 válido obrigatório' }, { status: 400 })
  }

  // Private ranges — no point checking
  const parts = ip.split('.').map(Number)
  const isPrivate = parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || parts[0] === 127
  if (isPrivate) return NextResponse.json({ ip, isPrivate: true, message: 'IP privado — sem dados de reputação pública' })

  const [dnsbl, isTor, ipInfo] = await Promise.all([
    checkDNSBL(ip),
    checkTor(ip),
    getIPInfo(ip),
  ])

  const listedCount = dnsbl.filter(d => d.listed).length
  const asnClass = classifyASN(ipInfo?.org ?? '')

  const riskScore = Math.min(100,
    listedCount * 20
    + (isTor ? 30 : 0)
    + (asnClass.type === 'vpn' ? 15 : 0)
    + (asnClass.type === 'hosting' ? 5 : 0)
  )

  const riskLevel = riskScore >= 60 ? 'critical' : riskScore >= 40 ? 'high' : riskScore >= 20 ? 'medium' : listedCount > 0 ? 'low' : 'clean'
  const riskLabel = riskLevel === 'critical' ? 'Crítico' : riskLevel === 'high' ? 'Alto' : riskLevel === 'medium' ? 'Médio' : riskLevel === 'low' ? 'Suspeito' : 'Limpo'

  const flags: string[] = []
  if (isTor) flags.push('Nó de saída Tor')
  if (asnClass.type === 'vpn') flags.push('Serviço VPN')
  if (asnClass.type === 'hosting') flags.push('Servidor / Hosting')
  dnsbl.filter(d => d.listed).forEach(d => flags.push(`Listado: ${d.name}`))

  return NextResponse.json({
    ip,
    ipInfo,
    asnClass,
    dnsbl,
    isTor,
    listedCount,
    riskScore,
    riskLevel,
    riskLabel,
    flags,
  })
}
