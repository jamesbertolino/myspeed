import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

export const runtime = 'nodejs'

const execAsync = promisify(exec)
const isWin = process.platform === 'win32'

function sanitizeDomain(d: string): string | null {
  return /^[a-zA-Z0-9.\-_]+$/.test(d) ? d : null
}

type DnsType = 'A' | 'AAAA' | 'MX' | 'TXT' | 'NS' | 'CNAME' | 'SOA' | 'PTR' | 'ALL'

async function nslookupQuery(domain: string, type: string): Promise<{ records: string[]; elapsed: number }> {
  const t0 = Date.now()
  let cmd: string

  if (isWin) {
    cmd = type === 'ALL'
      ? `nslookup -type=ANY ${domain}`
      : `nslookup -type=${type} ${domain}`
  } else {
    cmd = `dig +short ${type === 'ALL' ? 'ANY' : type} ${domain}`
  }

  const { stdout, stderr } = await execAsync(cmd, { timeout: 8000 })
  const out = stdout + (stderr ?? '')
  const elapsed = Date.now() - t0

  return { records: parseNslookup(out, type as DnsType, isWin), elapsed }
}

function parseNslookup(out: string, type: DnsType, win: boolean): string[] {
  if (!win) {
    // dig +short — linhas diretas
    return out.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith(';'))
  }

  const lines = out.split('\n').map(l => l.trim())
  const records: string[] = []
  // pula cabeçalho do servidor (antes de "Name:" ou "Addresses:")
  let past = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!past && (line.startsWith('Name:') || line.startsWith('Addresses:') || line.startsWith('Address:'))) {
      past = true
    }
    if (!past) continue
    if (!line || line.startsWith('Server:') || line.startsWith('Default Server:')) continue

    if (type === 'A' || type === 'AAAA' || type === 'ALL') {
      const m = line.match(/^(?:Address(?:es)?:|internet address =)\s*([\d.a-fA-F:]+)/)
        ?? line.match(/^([\d]{1,3}\.[\d]{1,3}\.[\d]{1,3}\.[\d]{1,3})$/)
      if (m) records.push(m[1])
    }
    if (type === 'MX' || type === 'ALL') {
      const m = line.match(/MX preference\s*=\s*(\d+),\s*mail exchanger\s*=\s*(\S+)/i)
        ?? line.match(/mail exchanger = (.+)/i)
      if (m) records.push(m[0])
    }
    if (type === 'NS' || type === 'ALL') {
      const m = line.match(/nameserver = (.+)/i) ?? line.match(/primary name server = (.+)/i)
      if (m) records.push(m[1].trim())
    }
    if (type === 'TXT' || type === 'ALL') {
      const m = line.match(/text = "(.+)"/i)
      if (m) records.push(m[1])
    }
    if (type === 'CNAME') {
      const m = line.match(/canonical name = (.+)/i) ?? line.match(/Aliases:\s*(.+)/i)
        ?? line.match(/^Name:\s*(.+)/)
      if (m) records.push(m[1].trim())
    }
    if (type === 'SOA') {
      if (line.match(/primary name server|responsible mail|serial|refresh|retry|expire|ttl/i)) {
        records.push(line)
      }
    }
    if (type === 'PTR') {
      const m = line.match(/name = (.+)/i)
      if (m) records.push(m[1].trim())
    }
  }

  // fallback: se não parseou nada, devolve as linhas brutas relevantes
  if (records.length === 0) {
    return lines.filter(l =>
      l && !l.startsWith('Server:') && !l.startsWith('Default') &&
      !l.startsWith('Non-authoritative') && !l.startsWith('DNS request')
    ).slice(0, 20)
  }

  return Array.from(new Set(records))
}

export async function GET(request: NextRequest) {
  const raw    = request.nextUrl.searchParams.get('domain') || 'google.com'
  const type   = (request.nextUrl.searchParams.get('type') || 'A').toUpperCase() as DnsType
  const domain = sanitizeDomain(raw)

  if (!domain) return NextResponse.json({ error: 'Domínio inválido' }, { status: 400 })

  const validTypes: DnsType[] = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'PTR', 'ALL']
  if (!validTypes.includes(type)) return NextResponse.json({ error: 'Tipo desconhecido' }, { status: 400 })

  try {
    if (type === 'ALL') {
      const types: DnsType[] = ['A', 'MX', 'NS', 'TXT']
      const results = await Promise.allSettled(types.map(t => nslookupQuery(domain, t)))
      const elapsed = Math.max(...results.map(r => r.status === 'fulfilled' ? r.value.elapsed : 0))
      const out: Record<string, unknown> = { domain, type, elapsed }
      types.forEach((t, i) => {
        out[t] = results[i].status === 'fulfilled' ? (results[i] as PromiseFulfilledResult<{ records: string[] }>).value.records : []
      })
      return NextResponse.json(out)
    }

    const { records, elapsed } = await nslookupQuery(domain, type)
    return NextResponse.json({ domain, type, records, elapsed })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'DNS lookup failed'
    return NextResponse.json({ error: message, domain, type }, { status: 422 })
  }
}
