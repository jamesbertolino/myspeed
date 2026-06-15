export const runtime = 'nodejs'

import { NextRequest } from 'next/server'
import net from 'net'
import os from 'os'
import { execSync } from 'child_process'

interface PortDef { port: number; service: string; risk: string }

const SCAN_PORTS: PortDef[] = [
  { port: 21,    service: 'FTP',           risk: 'high' },
  { port: 22,    service: 'SSH',           risk: 'low' },
  { port: 23,    service: 'Telnet',        risk: 'critical' },
  { port: 25,    service: 'SMTP',          risk: 'medium' },
  { port: 53,    service: 'DNS',           risk: 'low' },
  { port: 80,    service: 'HTTP',          risk: 'low' },
  { port: 110,   service: 'POP3',          risk: 'medium' },
  { port: 135,   service: 'RPC',           risk: 'high' },
  { port: 139,   service: 'NetBIOS',       risk: 'high' },
  { port: 143,   service: 'IMAP',          risk: 'medium' },
  { port: 443,   service: 'HTTPS',         risk: 'low' },
  { port: 445,   service: 'SMB',           risk: 'high' },
  { port: 1723,  service: 'PPTP VPN',      risk: 'high' },
  { port: 2222,  service: 'SSH-Alt',       risk: 'low' },
  { port: 3306,  service: 'MySQL',         risk: 'critical' },
  { port: 3389,  service: 'RDP',           risk: 'high' },
  { port: 5432,  service: 'PostgreSQL',    risk: 'critical' },
  { port: 5900,  service: 'VNC',           risk: 'high' },
  { port: 5985,  service: 'WinRM',         risk: 'high' },
  { port: 6379,  service: 'Redis',         risk: 'critical' },
  { port: 8080,  service: 'HTTP-Alt',      risk: 'medium' },
  { port: 8443,  service: 'HTTPS-Alt',     risk: 'low' },
  { port: 9200,  service: 'Elasticsearch', risk: 'critical' },
  { port: 27017, service: 'MongoDB',       risk: 'critical' },
  { port: 161,   service: 'SNMP',          risk: 'high' },
]

function tcpProbe(host: string, port: number, timeout = 600): Promise<boolean> {
  return new Promise(resolve => {
    const sock = new net.Socket()
    let done = false
    const finish = (open: boolean) => {
      if (done) return
      done = true
      try { sock.destroy() } catch (_) {}
      resolve(open)
    }
    sock.setTimeout(timeout)
    sock.on('connect', () => finish(true))
    sock.on('error', () => finish(false))
    sock.on('timeout', () => finish(false))
    try { sock.connect(port, host) } catch (_) { finish(false) }
  })
}

async function parallelBatch<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency: number): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency)
    results.push(...await Promise.all(batch.map(fn)))
  }
  return results
}

function deviceRiskLevel(openPorts: PortDef[]): string {
  if (!openPorts.length) return 'none'
  if (openPorts.some(p => p.risk === 'critical')) return 'critical'
  if (openPorts.some(p => p.risk === 'high')) return 'high'
  if (openPorts.some(p => p.risk === 'medium')) return 'medium'
  return 'low'
}

function isPrivateIp(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number)
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

function getArpHosts(): Map<string, string | null> {
  const ips = new Map<string, string | null>()
  try {
    let out: string
    if (process.platform === 'win32') {
      out = execSync('arp -a', { encoding: 'utf8', timeout: 5000 })
      for (const line of out.split('\n')) {
        const m = line.match(/\s+([\d.]+)\s+([\da-f]{2}[-][\da-f]{2}[-][\da-f]{2}[-][\da-f]{2}[-][\da-f]{2}[-][\da-f]{2})\s+/i)
        if (m && isPrivateIp(m[1])) ips.set(m[1], m[2].replace(/-/g, ':').toLowerCase())
      }
    } else if (process.platform === 'darwin') {
      out = execSync('arp -a 2>/dev/null', { encoding: 'utf8', timeout: 5000 })
      for (const line of out.split('\n')) {
        const m = line.match(/\(([^)]+)\)\s+at\s+([\da-f:]{17})/i)
        if (m && m[2] !== 'ff:ff:ff:ff:ff:ff' && isPrivateIp(m[1])) ips.set(m[1], m[2].toLowerCase())
      }
    } else {
      try {
        out = execSync('ip neigh show 2>/dev/null', { encoding: 'utf8', timeout: 5000 })
        for (const line of out.split('\n')) {
          const m = line.match(/^([\d.]+)\s+\S+\s+\S+\s+([\da-f:]{17})/i)
          if (m && isPrivateIp(m[1])) ips.set(m[1], m[2].toLowerCase())
        }
      } catch {
        out = execSync('arp -n 2>/dev/null || true', { encoding: 'utf8', timeout: 5000 })
        for (const line of out.split('\n').slice(1)) {
          const p = line.trim().split(/\s+/)
          if (p.length >= 3 && p[2] && p[2].includes(':') && p[2] !== '(incomplete)' && isPrivateIp(p[0])) {
            ips.set(p[0], p[2].toLowerCase())
          }
        }
      }
    }
  } catch (_) {}
  return ips
}

function getLocalSubnet(preferSubnet?: string): { subnet: string; localIp: string } | null {
  const ifaces = os.networkInterfaces()
  const candidates: { subnet: string; localIp: string }[] = []

  for (const addrs of Object.values(ifaces)) {
    for (const iface of (addrs ?? [])) {
      if (iface.family !== 'IPv4' || iface.internal) continue
      const parts = iface.address.split('.').map(Number)
      const [a, b] = parts
      if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
        candidates.push({ subnet: `${parts[0]}.${parts[1]}.${parts[2]}`, localIp: iface.address })
      }
    }
  }

  if (!candidates.length) return null
  if (preferSubnet) {
    const match = candidates.find(c => c.subnet === preferSubnet)
    if (match) return match
  }
  return candidates[0]
}

async function isHostOnline(ip: string): Promise<boolean> {
  const PROBE_PORTS = [80, 443, 22, 8080, 8443, 21, 23, 3389, 53, 139, 445, 3306, 5900, 8888, 7547, 8181, 8000]
  for (const port of PROBE_PORTS) {
    if (await tcpProbe(ip, port, 500)) return true
  }
  return false
}

function ipMatchesSubnet(ip: string, subnet: string): boolean {
  return ip.startsWith(subnet + '.')
}

async function discoverSubnet(
  subnet: string,
  arpHosts: Map<string, string | null>,
  onFound: (ip: string) => void
): Promise<void> {
  // Sempre inclui o gateway
  const gateway = `${subnet}.1`
  if (!arpHosts.has(gateway)) arpHosts.set(gateway, null)

  const allIps: string[] = []
  for (let i = 1; i <= 254; i++) allIps.push(`${subnet}.${i}`)

  await parallelBatch(allIps, async (ip) => {
    if (!ipMatchesSubnet(ip, subnet)) return
    if (await isHostOnline(ip)) onFound(ip)
  }, 30)
}

async function scanDevicePorts(host: string): Promise<PortDef[]> {
  const open: PortDef[] = []
  await parallelBatch(SCAN_PORTS, async (portDef) => {
    if (await tcpProbe(host, portDef.port, 700)) open.push(portDef)
  }, 10)
  return open.sort((a, b) => a.port - b.port)
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const preferSubnet = searchParams.get('subnet') ?? undefined

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
        } catch (_) {}
      }

      const t0 = Date.now()
      send({ type: 'start' })

      const arpHosts = getArpHosts()
      const subnetInfo = getLocalSubnet(preferSubnet)
      const subnetPrefix = subnetInfo?.subnet

      // Discover all online hosts via TCP probe on the selected subnet only
      const onlineHosts = new Map<string, string | null>()
      if (subnetInfo) {
        const targetSubnet = subnetInfo.subnet
        send({ type: 'progress', message: `Varrendo ${targetSubnet}.0/24 (apenas online)...` })
        await discoverSubnet(targetSubnet, new Map(), (ip) => {
          // Strict subnet match — reject any IP outside the /24
          if (!ipMatchesSubnet(ip, targetSubnet)) return
          const last = parseInt(ip.split('.')[3])
          if (last === 0 || last === 255) return
          // Reject multicast, broadcast and non-private ranges
          const first = parseInt(ip.split('.')[0])
          if (first >= 224) return
          onlineHosts.set(ip, arpHosts.get(ip) ?? null)
        })
      }

      const hosts = Array.from(onlineHosts.entries())
      send({ type: 'hosts', count: hosts.length })

      let count = 0
      await parallelBatch(hosts, async ([ip, mac]) => {
        const openPorts = await scanDevicePorts(ip)
        const riskLevel = deviceRiskLevel(openPorts)
        count++
        send({ type: 'device', device: { ip, mac, vendor: null, hostname: null, openPorts, riskLevel } })
      }, 5)

      send({ type: 'done', count, elapsed: Date.now() - t0 })
      controller.close()
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache, no-store',
      'X-Content-Type-Options': 'nosniff',
    }
  })
}
