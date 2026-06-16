import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

export const runtime = 'nodejs'

const execAsync = promisify(exec)

// sanitiza: só permite hostnames/IPs válidos
function sanitize(host: string): string | null {
  return /^[a-zA-Z0-9.\-]+$/.test(host) ? host : null
}

async function icmpPingMulti(host: string, count: number): Promise<{ avg: number; samples: number[]; ttl: number | null }> {
  const isWin = process.platform === 'win32'
  const cmd   = isWin
    ? `ping -n ${count} ${host}`
    : `ping -c ${count} ${host}`

  try {
    const { stdout } = await execAsync(cmd, { timeout: count * 2000 + 3000 })

    const samples: number[] = []

    if (isWin) {
      // "tempo=13ms" ou "tempo<1ms"
      const matches = stdout.matchAll(/[Tt]empo[<=](\d+(?:\.\d+)?)\s*ms/gi)
      for (const m of matches) samples.push(parseFloat(m[1]))
    } else {
      // "time=13.2 ms"
      const matches = stdout.matchAll(/time[<=](\d+(?:\.\d+)?)\s*ms/gi)
      for (const m of matches) samples.push(parseFloat(m[1]))
    }

    const ttlMatch = stdout.match(/TTL[<=](\d+)/i)
    const ttl = ttlMatch ? parseInt(ttlMatch[1]) : null

    if (samples.length === 0) return { avg: -1, samples: [], ttl: null }

    const avg = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length)
    return { avg, samples: samples.map(Math.round), ttl }
  } catch {
    return { avg: -1, samples: [], ttl: null }
  }
}

export async function GET(req: NextRequest) {
  const raw   = req.nextUrl.searchParams.get('target') ?? ''
  const count = Math.min(Math.max(Number(req.nextUrl.searchParams.get('count') ?? 5), 1), 30)
  const host  = sanitize(raw)

  if (!host) return NextResponse.json({ error: 'invalid target' }, { status: 400 })

  const { avg, samples, ttl } = await icmpPingMulti(host, count)
  const ping = avg

  // jitter = média das diferenças absolutas entre amostras consecutivas
  let jitter = 0
  if (samples.length >= 2) {
    const diffs = samples.slice(1).map((v, i) => Math.abs(v - samples[i]))
    jitter = Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length)
  }

  return NextResponse.json({ ping, jitter, samples, ttl })
}
