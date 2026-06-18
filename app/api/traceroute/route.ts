import { NextRequest } from 'next/server'
import { spawn } from 'child_process'
import * as net from 'net'
import { performance } from 'perf_hooks'

export const runtime = 'nodejs'

const isWin = process.platform === 'win32'

interface Hop {
  hop: number
  host: string
  ip: string
  latency: number | null
  timeout: boolean
}

// TCP probe com performance.now() para latência com precisão decimal real.
// Tenta várias portas típicas de roteadores — retorna o primeiro sucesso ou null.
function tcpProbeMs(ip: string, timeoutMs = 1500): Promise<number | null> {
  const PORTS = [80, 443, 53, 22, 23]
  return new Promise(resolve => {
    let settled = false
    let remaining = PORTS.length

    PORTS.forEach(port => {
      const t0 = performance.now()
      const sock = new net.Socket()
      sock.setTimeout(timeoutMs)
      const done = (ms: number | null) => {
        sock.destroy()
        if (settled) return
        if (ms !== null) { settled = true; resolve(parseFloat(ms.toFixed(2))) }
        else if (--remaining === 0) resolve(null)
      }
      sock.connect(port, ip, () => done(performance.now() - t0))
      sock.on('error', () => done(null))
      sock.on('timeout', () => done(null))
    })
  })
}

function parseWindowsLine(line: string): Hop | null {
  const m = line.match(/^\s*(\d+)\s+/)
  if (!m) return null
  const hop = parseInt(m[1])
  const rest = line.slice(m[0].length)

  if (!rest.match(/\d{1,3}\.\d{1,3}\.\d{1,3}/)) {
    return { hop, host: '*', ip: '*', latency: null, timeout: true }
  }

  const ipMatch = rest.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/)
  const ip = ipMatch ? ipMatch[1] : rest.trim().split(/\s+/).pop() ?? '*'

  // latência do tracert (inteiro no Windows) — substituída por TCP probe abaixo
  const times = Array.from(rest.matchAll(/<?\s*(\d+(?:\.\d+)?)\s*ms/gi)).map(t => parseFloat(t[1]))
  const latency = times.length ? parseFloat((times.reduce((a, b) => a + b, 0) / times.length).toFixed(2)) : null

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
    latency: timeMatch ? parseFloat(parseFloat(timeMatch[1]).toFixed(2)) : null,
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
      let closed = false

      async function processHop(hop: Hop) {
        if (closed) return
        // No Windows o tracert só dá inteiros — refinamos com TCP probe de alta res
        if (isWin && !hop.timeout && hop.ip !== '*') {
          const tcpMs = await tcpProbeMs(hop.ip)
          if (tcpMs !== null) hop = { ...hop, latency: tcpMs }
        }
        if (!closed) ctrl.enqueue(send(hop))
      }

      function handleLine(line: string) {
        const hop = isWin ? parseWindowsLine(line) : parseUnixLine(line)
        if (hop) processHop(hop)
      }

      child.stdout.on('data', (chunk: Buffer) => {
        buf += chunk.toString('latin1')
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        lines.forEach(handleLine)
      })

      child.stderr.on('data', (chunk: Buffer) => {
        buf += chunk.toString('latin1')
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        lines.forEach(handleLine)
      })

      child.on('close', () => {
        if (buf.trim()) handleLine(buf)
        // aguarda os TCP probes em flight antes de fechar o stream
        setTimeout(() => {
          if (!closed) {
            closed = true
            ctrl.enqueue(send({ done: true }))
            ctrl.close()
          }
        }, 2000)
      })

      child.on('error', (e) => {
        closed = true
        ctrl.enqueue(send({ error: e.message }))
        ctrl.close()
      })

      req.signal.addEventListener('abort', () => {
        closed = true
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
