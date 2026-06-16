import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

export const runtime = 'nodejs'

const execAsync = promisify(exec)

const PUBLIC_SERVERS = [
  { name: 'Cloudflare',    ip: '1.1.1.1',        flag: '🌐', isp: false },
  { name: 'Cloudflare 2',  ip: '1.0.0.1',        flag: '🌐', isp: false },
  { name: 'Google',        ip: '8.8.8.8',        flag: '🇺🇸', isp: false },
  { name: 'Google 2',      ip: '8.8.4.4',        flag: '🇺🇸', isp: false },
  { name: 'Quad9',         ip: '9.9.9.9',        flag: '🇨🇭', isp: false },
  { name: 'OpenDNS',       ip: '208.67.222.222', flag: '🇺🇸', isp: false },
  { name: 'AdGuard',       ip: '94.140.14.14',   flag: '🛡️',  isp: false },
  { name: 'CleanBrowsing', ip: '185.228.168.9',  flag: '🧹',  isp: false },
  { name: 'Neustar',       ip: '156.154.70.1',   flag: '🇺🇸', isp: false },
  { name: 'Comodo',        ip: '8.26.56.26',     flag: '🇺🇸', isp: false },
]

const SAMPLES = 5

function sanitize(ip: string): string | null {
  return /^[0-9.a-fA-F:]+$/.test(ip) ? ip : null
}

async function getIspDns(): Promise<{ name: string; ip: string; flag: string; isp: true }[]> {
  try {
    const isWin = process.platform === 'win32'
    let ips: string[] = []

    if (isWin) {
      const { stdout } = await execAsync('ipconfig /all', { timeout: 5000 })
      const matches = Array.from(stdout.matchAll(/DNS Servers[^:]*:\s*([\d.]+)/gi))
      for (const m of matches) {
        const ip = m[1].trim()
        if (ip && !ips.includes(ip)) ips.push(ip)
      }
      // também pega linhas de continuação (IPs adicionais indentados após o primeiro)
      const lines = stdout.split('\n')
      let inDns = false
      for (const line of lines) {
        if (/DNS Servers/i.test(line)) { inDns = true; continue }
        if (inDns) {
          const cont = line.match(/^\s{30,}([\d.]+)\s*$/)
          if (cont) { const ip = cont[1].trim(); if (!ips.includes(ip)) ips.push(ip) }
          else if (/^\s{3,}\S/.test(line)) inDns = false
        }
      }
    } else {
      const { stdout } = await execAsync('cat /etc/resolv.conf', { timeout: 3000 })
      const matches = Array.from(stdout.matchAll(/^nameserver\s+([\d.]+)/gm))
      ips = matches.map(m => m[1]).filter((v, i, a) => a.indexOf(v) === i)
    }

    // filtra IPs privados/loopback e que já estão na lista pública
    const publicIps = new Set(PUBLIC_SERVERS.map(s => s.ip))
    ips = ips.filter(ip =>
      !publicIps.has(ip) &&
      !ip.startsWith('127.') &&
      !ip.startsWith('::1') &&
      ip !== '0.0.0.0'
    )

    return ips.slice(0, 4).map((ip, i) => ({
      name: `DNS do Provedor${ips.length > 1 ? ` ${i + 1}` : ''}`,
      ip,
      flag: '🏠',
      isp: true as const,
    }))
  } catch {
    return []
  }
}

async function icmpPing(ip: string): Promise<{ avg: number; samples: number[]; timeout: boolean }> {
  const isWin = process.platform === 'win32'
  const cmd   = isWin ? `ping -n ${SAMPLES} ${ip}` : `ping -c ${SAMPLES} ${ip}`

  try {
    const { stdout } = await execAsync(cmd, { timeout: SAMPLES * 2000 + 3000 })

    const matches = isWin
      ? Array.from(stdout.matchAll(/[Tt]empo[<=](\d+(?:\.\d+)?)\s*ms/gi))
      : Array.from(stdout.matchAll(/time[<=](\d+(?:\.\d+)?)\s*ms/gi))

    const samples = matches.map(m => Math.round(parseFloat(m[1])))
    if (samples.length === 0) return { avg: -1, samples: [], timeout: true }

    const avg = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length * 10) / 10
    return { avg, samples, timeout: false }
  } catch {
    return { avg: -1, samples: [], timeout: true }
  }
}

export async function GET(req: NextRequest) {
  const customIp = req.nextUrl.searchParams.get('ip')

  if (customIp) {
    const safe = sanitize(customIp)
    if (!safe) return NextResponse.json({ error: 'invalid ip' }, { status: 400 })
    const result = await icmpPing(safe)
    return NextResponse.json({ ip: safe, name: 'Personalizado', flag: '⚙️', isp: false, ...result })
  }

  const ispServers = await getIspDns()
  const allServers = [...ispServers, ...PUBLIC_SERVERS]

  const results = await Promise.all(
    allServers.map(async srv => ({ ...srv, ...(await icmpPing(srv.ip)) }))
  )
  results.sort((a, b) => (a.timeout ? 1 : 0) - (b.timeout ? 1 : 0) || a.avg - b.avg)

  return NextResponse.json({ results, ispFound: ispServers.length > 0, ts: Date.now() })
}
