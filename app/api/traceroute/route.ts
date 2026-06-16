import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

export const runtime = 'nodejs'
const execAsync = promisify(exec)

const isWin = process.platform === 'win32'

interface Hop {
  hop: number
  host: string
  ip: string
  latency: number | null
  timeout: boolean
}

function parseWindows(output: string): Hop[] {
  const hops: Hop[] = []
  // cada linha: "  1    <1 ms    <1 ms    <1 ms  192.168.1.1"
  // ou:         "  2     *        *        *     Esgotado o tempo limite do pedido."
  const lineRe = /^\s*(\d+)\s+(.*)/
  for (const line of output.split('\n')) {
    const m = line.match(lineRe)
    if (!m) continue
    const hop = parseInt(m[1])
    const rest = m[2]

    if (rest.includes('*') && !rest.match(/[\d.]{7,}/)) {
      hops.push({ hop, host: '*', ip: '*', latency: null, timeout: true })
      continue
    }

    // extrai todos os tempos: "<1 ms" ou "12 ms"
    const times = [...rest.matchAll(/<?\s*(\d+)\s*ms/gi)].map(t => parseInt(t[1]))
    const latency = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null

    // último token = host/IP
    const tokens = rest.trim().split(/\s+/)
    const lastToken = tokens[tokens.length - 1]
    const ipMatch = lastToken.match(/^(\d{1,3}\.){3}\d{1,3}$/)
    const host = lastToken
    const ip   = ipMatch ? lastToken : lastToken

    hops.push({ hop, host, ip, latency, timeout: false })
  }
  return hops.filter(h => h.hop > 0)
}

function parseUnix(output: string): Hop[] {
  const hops: Hop[] = []
  for (const line of output.split('\n').slice(1)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const hopMatch = trimmed.match(/^(\d+)/)
    if (!hopMatch) continue
    const hop = parseInt(hopMatch[1])

    if (/^\d+\s+\*\s+\*\s+\*/.test(trimmed)) {
      hops.push({ hop, host: '*', ip: '*', latency: null, timeout: true })
      continue
    }

    const timeMatch = trimmed.match(/(\d+\.?\d*)\s*ms/)
    const hostMatch = trimmed.match(/\s+(\S+)\s+\(([^)]+)\)/)
    const ipOnly    = trimmed.match(/\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/)

    hops.push({
      hop,
      host:    hostMatch ? hostMatch[1] : ipOnly ? ipOnly[1] : '*',
      ip:      hostMatch ? hostMatch[2] : ipOnly ? ipOnly[1] : '*',
      latency: timeMatch ? parseFloat(timeMatch[1]) : null,
      timeout: false,
    })
  }
  return hops
}

export async function GET(request: NextRequest) {
  const target = request.nextUrl.searchParams.get('target') || '8.8.8.8'

  if (!/^[a-zA-Z0-9.\-]+$/.test(target)) {
    return NextResponse.json({ error: 'Destino inválido' }, { status: 400 })
  }

  try {
    let stdout = ''
    let stderr = ''

    if (isWin) {
      // tracert -d (sem resolver DNS reverso, mais rápido) -h 30 (max hops) -w 2000 (timeout ms)
      ;({ stdout, stderr } = await execAsync(`tracert -d -h 30 -w 2000 ${target}`, { timeout: 90000 }))
    } else if (process.platform === 'darwin') {
      ;({ stdout, stderr } = await execAsync(`traceroute -n -m 30 -w 2 ${target}`, { timeout: 90000 }))
    } else {
      // Linux: tenta ICMP primeiro (requer raw socket / cap), fallback UDP
      try {
        ;({ stdout, stderr } = await execAsync(`traceroute -n -m 30 -w 2 -I ${target}`, { timeout: 90000 }))
      } catch {
        ;({ stdout, stderr } = await execAsync(`traceroute -n -m 30 -w 2 ${target}`, { timeout: 90000 }))
      }
    }

    const raw  = stdout || stderr
    const hops = isWin ? parseWindows(raw) : parseUnix(raw)

    if (hops.length === 0) throw new Error('Nenhum salto retornado')

    return NextResponse.json({ target, hops })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ target, hops: [], error: message, simulated: false }, { status: 500 })
  }
}
