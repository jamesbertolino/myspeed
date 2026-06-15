import { NextRequest, NextResponse } from 'next/server'
import net from 'net'
import dns from 'dns/promises'

const KNOWN_PORTS: Record<number, string> = {
  21: 'FTP',
  22: 'SSH',
  23: 'Telnet',
  25: 'SMTP',
  53: 'DNS',
  80: 'HTTP',
  110: 'POP3',
  143: 'IMAP',
  443: 'HTTPS',
  445: 'SMB',
  587: 'SMTP/TLS',
  993: 'IMAPS',
  995: 'POP3S',
  1433: 'MSSQL',
  1521: 'Oracle',
  2049: 'NFS',
  3000: 'HTTP/Dev',
  3306: 'MySQL',
  3389: 'RDP',
  4444: 'Shell/C2',
  5432: 'PostgreSQL',
  5900: 'VNC',
  6379: 'Redis',
  8080: 'HTTP-Alt',
  8443: 'HTTPS-Alt',
  8888: 'Jupyter',
  9200: 'Elasticsearch',
  11211: 'Memcached',
  27017: 'MongoDB',
  27018: 'MongoDB',
}

const DEFAULT_PORTS = Object.keys(KNOWN_PORTS).map(Number)

function parsePorts(input: string): number[] {
  const result = new Set<number>()
  const parts = input.split(/[\s,;]+/).filter(Boolean)
  for (const part of parts) {
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(s => parseInt(s, 10))
      if (!isNaN(a) && !isNaN(b) && a >= 1 && b <= 65535 && a <= b) {
        const limit = Math.min(b, a + 999) // max 1000 ports per range
        for (let p = a; p <= limit; p++) result.add(p)
      }
    } else {
      const p = parseInt(part, 10)
      if (!isNaN(p) && p >= 1 && p <= 65535) result.add(p)
    }
  }
  return Array.from(result).sort((a, b) => a - b)
}

async function checkPort(host: string, port: number, timeoutMs = 1500): Promise<{ open: boolean; banner?: string }> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let done = false
    let banner = ''
    let connected = false

    const finish = (open: boolean) => {
      if (done) return
      done = true
      try { socket.destroy() } catch { /* ignore */ }
      resolve({ open, banner: banner.slice(0, 120).trim() || undefined })
    }

    socket.setTimeout(timeoutMs)

    socket.on('connect', () => {
      connected = true
      setTimeout(() => finish(true), 600)
    })

    socket.on('data', (buf) => {
      banner += buf.toString('latin1', 0, 120)
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
      finish(true)
    })

    socket.on('timeout', () => finish(connected))
    socket.on('error', () => finish(false))
    socket.on('close', () => { if (!done) finish(false) })

    try {
      socket.connect(port, host)
    } catch {
      finish(false)
    }
  })
}

export async function GET(req: NextRequest) {
  const host = req.nextUrl.searchParams.get('host')?.trim()
  if (!host) return NextResponse.json({ error: 'Host obrigatório' }, { status: 400 })
  if (host.length > 253) return NextResponse.json({ error: 'Host inválido' }, { status: 400 })

  // Parse custom port list or use defaults
  const portsParam = req.nextUrl.searchParams.get('ports')?.trim()
  let portList: number[]
  if (portsParam) {
    portList = parsePorts(portsParam)
    if (portList.length === 0)
      return NextResponse.json({ error: 'Nenhuma porta válida. Use: 80,443 ou 80-90' }, { status: 400 })
    if (portList.length > 500)
      return NextResponse.json({ error: 'Máximo de 500 portas por scan' }, { status: 400 })
  } else {
    portList = DEFAULT_PORTS
  }

  // Resolve hostname → IP
  let ip = host
  try {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      const addrs = await dns.resolve4(host).catch(async () => dns.resolve6(host))
      ip = addrs[0]
    }
  } catch {
    return NextResponse.json({ error: `Não foi possível resolver: ${host}` }, { status: 400 })
  }

  const BATCH = 10
  const open: Array<{ port: number; service: string; banner?: string }> = []

  for (let i = 0; i < portList.length; i += BATCH) {
    const batch = portList.slice(i, i + BATCH)
    const results = await Promise.all(
      batch.map(async (port) => ({
        port,
        service: KNOWN_PORTS[port] ?? `${port}/tcp`,
        ...(await checkPort(ip, port)),
      }))
    )
    for (const r of results) {
      if (r.open) open.push({ port: r.port, service: r.service, banner: r.banner })
    }
  }

  return NextResponse.json({ host, ip, open, total: portList.length, scanned: portList.length })
}
