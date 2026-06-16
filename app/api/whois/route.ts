import { NextRequest, NextResponse } from 'next/server'
import net from 'net'

export const runtime = 'nodejs'

function sanitize(d: string): string | null {
  return /^[a-zA-Z0-9.\-]+$/.test(d) ? d.toLowerCase() : null
}

function whoisQuery(host: string, query: string, timeout = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const sock = net.createConnection({ host, port: 43 })
    const timer = setTimeout(() => { sock.destroy(); reject(new Error(`Timeout conectando em ${host}:43`)) }, timeout)

    sock.once('connect', () => sock.write(`${query}\r\n`))
    sock.on('data', d => chunks.push(d))
    sock.once('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks).toString('utf8')) })
    sock.once('error', e => { clearTimeout(timer); reject(e) })
  })
}

function extractReferral(raw: string): string | null {
  const m = raw.match(/refer:\s*(\S+)/i)
    ?? raw.match(/Registrar WHOIS Server:\s*(\S+)/i)
    ?? raw.match(/whois:\s*(\S+)/i)
  return m ? m[1].trim().toLowerCase() : null
}

function parse(raw: string) {
  const get = (...keys: string[]): string => {
    for (const key of keys) {
      const m = raw.match(new RegExp(`^${key}[^:]*:\\s*(.+)`, 'im'))
      if (m) return m[1].trim()
    }
    return ''
  }
  const getAll = (...keys: string[]): string[] => {
    const results: string[] = []
    for (const key of keys) {
      const re = new RegExp(`^${key}[^:]*:\\s*(.+)`, 'gim')
      for (const m of raw.matchAll(re)) results.push(m[1].trim())
    }
    return [...new Set(results)]
  }

  return {
    domainName:    get('Domain Name', 'domain'),
    registrar:     get('Registrar', 'registrar name', 'sponsoring registrar'),
    registrarUrl:  get('Registrar URL'),
    createdDate:   get('Creation Date', 'Created On', 'created', 'Registered'),
    updatedDate:   get('Updated Date', 'Last Updated On', 'changed', 'Last Modified'),
    expiresDate:   get('Expiry Date', 'Registry Expiry Date', 'Expiration Date', 'Registrar Registration Expiration Date', 'paid-till'),
    status:        getAll('Domain Status', 'Status'),
    nameServers:   getAll('Name Server', 'nserver'),
    dnssec:        get('DNSSEC'),
    country:       get('Registrant Country', 'country'),
    organization:  get('Registrant Organization', 'org', 'Organisation Name'),
    abuse:         get('Registrar Abuse Contact Email', 'abuse-mailbox'),
  }
}

export async function GET(req: NextRequest) {
  const raw    = req.nextUrl.searchParams.get('domain') ?? ''
  const domain = sanitize(raw.replace(/^https?:\/\//, '').split('/')[0])

  if (!domain) return NextResponse.json({ error: 'Domínio inválido' }, { status: 400 })

  const t0 = Date.now()

  try {
    // 1) consulta IANA para obter o servidor WHOIS da TLD
    const tld  = domain.split('.').slice(-1)[0]
    let server = 'whois.iana.org'
    let raw1   = ''

    try {
      raw1   = await whoisQuery('whois.iana.org', tld)
      server = extractReferral(raw1) ?? 'whois.iana.org'
    } catch { /* prossegue com iana */ }

    // 2) consulta o servidor da TLD / registrar
    let raw2 = ''
    if (server !== 'whois.iana.org') {
      try { raw2 = await whoisQuery(server, domain) } catch { raw2 = raw1 }
    } else {
      raw2 = raw1.length > 0 ? raw1 : await whoisQuery('whois.iana.org', domain)
    }

    // 3) segunda referência (registrar WHOIS)
    const ref2 = extractReferral(raw2)
    let raw3 = raw2
    if (ref2 && ref2 !== server) {
      try { raw3 = await whoisQuery(ref2, domain) } catch { /* usa raw2 */ }
    }

    const data   = parse(raw3.length > raw2.length ? raw3 : raw2)
    const elapsed = Date.now() - t0

    return NextResponse.json({ domain, elapsed, server, ...data, raw: raw3 || raw2 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'WHOIS falhou'
    return NextResponse.json({ error: message, domain }, { status: 422 })
  }
}
