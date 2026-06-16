import { NextRequest } from 'next/server'
import { spawn } from 'child_process'

export const runtime = 'nodejs'

const isWin = process.platform === 'win32'

interface Hop {
  hop: number
  host: string
  ip: string
  latency: number | null
  timeout: boolean
}

function parseWindowsLine(line: string): Hop | null {
  const m = line.match(/^\s*(\d+)\s+/)
  if (!m) return null
  const hop = parseInt(m[1])
  const rest = line.slice(m[0].length)

  // timeout
  if (!rest.match(/\d{1,3}\.\d{1,3}\.\d{1,3}/)) {
    return { hop, host: '*', ip: '*', latency: null, timeout: true }
  }

  const times = [...rest.matchAll(/<?\s*(\d+)\s*ms/gi)].map(t => parseInt(t[1]))
  const latency = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null
  const ipMatch = rest.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/)
  const ip = ipMatch ? ipMatch[1] : rest.trim().split(/\s+/).pop() ?? '*'

  return { hop, host: ip, ip, latency, timeout: false }
}

function parseUnixLine(line: string): Hop | null {
  const m = line.trim().match(/^(\d+)/)
  if (!m) return null
  const hop = parseInt(m[1])

  if (/^\d+\s+\*\s+\*\s+\*/.test(line.trim())) {
    return { hop, host: '*', ip: '*', latency: null, timeout: true }
  }

  const timeMatch = line.match(/(\d+\.?\d*)\s*ms/)
  const hostMatch = line.match(/\s+(\S+)\s+\(([^)]+)\)/)
  const ipOnly    = line.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/)

  return {
    hop,
    host:    hostMatch ? hostMatch[1] : ipOnly ? ipOnly[1] : '*',
    ip:      hostMatch ? hostMatch[2] : ipOnly ? ipOnly[1] : '*',
    latency: timeMatch ? Math.round(parseFloat(timeMatch[1])) : null,
    timeout: false,
  }
}

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get('target') ?? '8.8.8.8'
  if (!/^[a-zA-Z0-9.\-]+$/.test(target)) {
    return new Response('invalid target', { status: 400 })
  }

  const enc = new TextEncoder()
  const send = (obj: object) => enc.encode(`data: ${JSON.stringify(obj)}\n\n`)

  const stream = new ReadableStream({
    start(ctrl) {
      const args = isWin
        ? ['tracert', '-d', '-h', '30', '-w', '2000', target]
        : process.platform === 'darwin'
          ? ['traceroute', '-n', '-m', '30', '-w', '2', target]
          : ['traceroute', '-n', '-m', '30', '-w', '2', '-I', target]

      const child = spawn(args[0], args.slice(1), { windowsHide: true })

      let buf = ''

      child.stdout.on('data', (chunk: Buffer) => {
        buf += chunk.toString('latin1')
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''

        for (const line of lines) {
          const hop = isWin ? parseWindowsLine(line) : parseUnixLine(line)
          if (hop) ctrl.enqueue(send(hop))
        }
      })

      child.stderr.on('data', (chunk: Buffer) => {
        buf += chunk.toString('latin1')
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          const hop = isWin ? parseWindowsLine(line) : parseUnixLine(line)
          if (hop) ctrl.enqueue(send(hop))
        }
      })

      child.on('close', () => {
        // flush remaining
        if (buf.trim()) {
          const hop = isWin ? parseWindowsLine(buf) : parseUnixLine(buf)
          if (hop) ctrl.enqueue(send(hop))
        }
        ctrl.enqueue(send({ done: true }))
        ctrl.close()
      })

      child.on('error', (e) => {
        ctrl.enqueue(send({ error: e.message }))
        ctrl.close()
      })

      // abort if client disconnects
      req.signal.addEventListener('abort', () => {
        try { child.kill() } catch { /* ignore */ }
        ctrl.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
