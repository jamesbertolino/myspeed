import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

export const runtime = 'nodejs'

const execAsync = promisify(exec)

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

function sanitize(ip: string): string | null {
  return /^[0-9.a-fA-F:]+$/.test(ip) ? ip : null
}

async function icmpPing(ip: string): Promise<{ avg: number; samples: number[]; timeout: boolean }> {
  const isWin = process.platform === 'win32'
  const cmd   = isWin ? `ping -n ${SAMPLES} ${ip}` : `ping -c ${SAMPLES} ${ip}`

  try {
    const { stdout } = await execAsync(cmd, { timeout: SAMPLES * 2000 + 3000 })

    const matches = isWin
      ? [...stdout.matchAll(/[Tt]empo[<=](\d+(?:\.\d+)?)\s*ms/gi)]
      : [...stdout.matchAll(/time[<=](\d+(?:\.\d+)?)\s*ms/gi)]

    const samples = matches.map(m => Math.round(parseFloat(m[1])))
    if (samples.length === 0) return { avg: -1, samples: [], timeout: true }

    const avg = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length)
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
    return NextResponse.json({ ip: safe, name: 'Personalizado', flag: '⚙️', ...result })
  }

  const results = await Promise.all(
    SERVERS.map(async srv => ({ ...srv, ...(await icmpPing(srv.ip)) }))
  )
  results.sort((a, b) => (a.timeout ? 1 : 0) - (b.timeout ? 1 : 0) || a.avg - b.avg)

  return NextResponse.json({ results, ts: Date.now() })
}
