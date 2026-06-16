import { NextRequest, NextResponse } from 'next/server'
import dgram from 'dgram'

export const runtime = 'nodejs'

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

const SAMPLES = 5
const TIMEOUT = 3000
const DELAY   = 100  // ms entre amostras

// Monta pacote DNS mínimo: query A para 'google.com'
function buildDnsQuery(id: number): Buffer {
  const buf = Buffer.alloc(29)
  buf.writeUInt16BE(id & 0xffff, 0)
  buf.writeUInt16BE(0x0100, 2)   // standard query
  buf.writeUInt16BE(1, 4)        // 1 question
  buf.writeUInt16BE(0, 6); buf.writeUInt16BE(0, 8); buf.writeUInt16BE(0, 10)
  let off = 12
  for (const part of 'google.com'.split('.')) {
    buf[off++] = part.length
    Buffer.from(part).copy(buf, off); off += part.length
  }
  buf[off++] = 0
  buf.writeUInt16BE(1, off); off += 2  // type A
  buf.writeUInt16BE(1, off)            // class IN
  return buf
}

function udpPing(ip: string): Promise<number> {
  return new Promise(resolve => {
    const sock = dgram.createSocket('udp4')
    const pkt  = buildDnsQuery(Math.floor(Math.random() * 0xffff))
    let done   = false
    const t0   = Date.now()

    const finish = (ms: number) => {
      if (done) return
      done = true
      try { sock.close() } catch {}
      resolve(ms)
    }

    sock.on('message', () => finish(Date.now() - t0))
    sock.on('error',   () => finish(TIMEOUT))
    setTimeout(() => finish(TIMEOUT), TIMEOUT)
    sock.send(pkt, 53, ip)
  })
}

async function measureServer(ip: string): Promise<{ avg: number; samples: number[]; timeout: boolean }> {
  const samples: number[] = []
  for (let i = 0; i < SAMPLES; i++) {
    samples.push(await udpPing(ip))
    if (i < SAMPLES - 1) await new Promise(r => setTimeout(r, DELAY))
  }
  const valid   = samples.filter(s => s < TIMEOUT)
  const timeout = valid.length === 0
  const avg     = timeout
    ? TIMEOUT
    : Math.round(valid.reduce((a, b) => a + b, 0) / valid.length)
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

  const results = await Promise.all(
    SERVERS.map(async srv => ({ ...srv, ...(await measureServer(srv.ip)) }))
  )
  results.sort((a, b) => (a.timeout ? 1 : 0) - (b.timeout ? 1 : 0) || a.avg - b.avg)

  return NextResponse.json({ results, ts: Date.now() })
}
