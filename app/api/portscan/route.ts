import { NextRequest, NextResponse } from 'next/server'
import net from 'net'
import dns from 'dns/promises'

const PORTS: Record<number, string> = {
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

  // Resolve hostname → IP
  let ip = host
  try {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      const addrs = await dns.resolve4(host).catch(async () => {
        const v6 = await dns.resolve6(host)
        return v6
      })
      ip = addrs[0]
    }
  } catch {
    return NextResponse.json({ error: `Não foi possível resolver: ${host}` }, { status: 400 })
  }

  const portList = Object.keys(PORTS).map(Number)
  const BATCH = 10

  const open: Array<{ port: number; service: string; banner?: string }> = []

  for (let i = 0; i < portList.length; i += BATCH) {
    const batch = portList.slice(i, i + BATCH)
    const results = await Promise.all(
      batch.map(async (port) => ({
        port,
        service: PORTS[port],
        ...(await checkPort(ip, port)),
      }))
    )
    for (const r of results) {
      if (r.open) open.push({ port: r.port, service: r.service, banner: r.banner })
    }
  }

  return NextResponse.json({
    host,
    ip,
    open,
    total: portList.length,
    scanned: portList.length,
  })
}
