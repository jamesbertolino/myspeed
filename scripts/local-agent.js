#!/usr/bin/env node
/**
 * MySpeed Local Agent
 * Runs local network diagnostics (ping, traceroute, port scan, DNS)
 * directly from your machine — bypassing the cloud server.
 *
 * Usage:
 *   node scripts/local-agent.js
 *   node scripts/local-agent.js --port 3777
 *
 * The MySpeed web app auto-detects this agent and routes all
 * network tests through your local machine when connected.
 *
 * Key advantages over cloud server:
 *   ✓ Tests originate from YOUR network (accurate ISP/router diagnosis)
 *   ✓ Can scan internal IPs (192.168.x.x, 10.x.x.x)
 *   ✓ Uses YOUR local DNS resolver (not the cloud server's)
 *   ✓ Real ICMP ping (not HTTP RTT measurement)
 *   ✓ Traceroute shows YOUR actual network path
 */

'use strict'

const http = require('http')
const net  = require('net')
const dns  = require('dns').promises
const os   = require('os')
const { spawn, exec } = require('child_process')
const { promisify } = require('util')
const execAsync = promisify(exec)

const PORT    = parseInt(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] ?? '3777', 10)
const VERSION = '1.1.0'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept')
  res.setHeader('Access-Control-Allow-Private-Network', 'true')
}

function json(res, data, status = 200) {
  cors(res)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

function getQuery(req) {
  return Object.fromEntries(new URL(req.url, `http://localhost:${PORT}`).searchParams)
}

// ─── Network info ─────────────────────────────────────────────────────────────

function getInterfaces() {
  const ifaces = os.networkInterfaces()
  const result = []
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const addr of addrs) {
      if (!addr.internal) {
        result.push({ name, address: addr.address, family: addr.family, netmask: addr.netmask, mac: addr.mac })
      }
    }
  }
  return result
}

async function getDefaultGateway() {
  try {
    const platform = os.platform()
    if (platform === 'linux') {
      const { stdout } = await execAsync("ip route | grep default | head -1 | awk '{print $3}'")
      return stdout.trim() || null
    } else if (platform === 'darwin') {
      const { stdout } = await execAsync("netstat -rn | grep 'default' | awk '{print $2}' | head -1")
      return stdout.trim() || null
    } else if (platform === 'win32') {
      const { stdout } = await execAsync("powershell -command \"(Get-NetRoute -DestinationPrefix '0.0.0.0/0').NextHop | Select-Object -First 1\"")
      return stdout.trim() || null
    }
  } catch { /* ignore */ }
  return null
}

async function getLocalDNS() {
  try {
    const servers = dns.getServers()
    return servers
  } catch { return [] }
}

// ─── Port scanner ─────────────────────────────────────────────────────────────

const KNOWN_PORTS = {
  21:'FTP', 22:'SSH', 23:'Telnet', 25:'SMTP', 53:'DNS', 80:'HTTP',
  110:'POP3', 143:'IMAP', 443:'HTTPS', 445:'SMB', 587:'SMTP/TLS',
  993:'IMAPS', 995:'POP3S', 1433:'MSSQL', 1521:'Oracle', 2049:'NFS',
  3000:'HTTP/Dev', 3306:'MySQL', 3389:'RDP', 4444:'Shell/C2',
  5432:'PostgreSQL', 5900:'VNC', 6379:'Redis', 8080:'HTTP-Alt',
  8443:'HTTPS-Alt', 8888:'Jupyter', 9200:'Elasticsearch',
  11211:'Memcached', 27017:'MongoDB', 27018:'MongoDB',
}

function checkPort(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let done = false; let banner = ''; let connected = false
    const finish = (open) => {
      if (done) return; done = true
      try { socket.destroy() } catch {}
      resolve({ open, banner: banner.slice(0, 120).trim() || undefined })
    }
    socket.setTimeout(timeoutMs)
    socket.on('connect', () => { connected = true; setTimeout(() => finish(true), 500) })
    socket.on('data', (buf) => {
      banner += buf.toString('latin1', 0, 120).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
      finish(true)
    })
    socket.on('timeout', () => finish(connected))
    socket.on('error', () => finish(false))
    socket.on('close', () => { if (!done) finish(false) })
    try { socket.connect(port, host) } catch { finish(false) }
  })
}

function parsePorts(input) {
  const result = new Set()
  for (const part of input.split(/[\s,;]+/).filter(Boolean)) {
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number)
      if (!isNaN(a) && !isNaN(b) && a >= 1 && b <= 65535 && a <= b)
        for (let p = a; p <= Math.min(b, a + 999); p++) result.add(p)
    } else {
      const p = parseInt(part)
      if (!isNaN(p) && p >= 1 && p <= 65535) result.add(p)
    }
  }
  return Array.from(result).sort((a, b) => a - b)
}

// ─── DNS lookup ──────────────────────────────────────────────────────────────

async function dnsLookup(domain, type) {
  const t0 = Date.now()
  try {
    let records
    switch (type.toUpperCase()) {
      case 'A':     records = await dns.resolve4(domain); break
      case 'AAAA':  records = await dns.resolve6(domain); break
      case 'MX':    records = await dns.resolveMx(domain); break
      case 'TXT':   records = (await dns.resolveTxt(domain)).map(r => r.join(' ')); break
      case 'NS':    records = await dns.resolveNs(domain); break
      case 'CNAME': records = await dns.resolveCname(domain); break
      case 'SOA':   records = [await dns.resolveSoa(domain)]; break
      case 'ALL': {
        const [A, MX, NS, TXT] = await Promise.allSettled([
          dns.resolve4(domain),
          dns.resolveMx(domain),
          dns.resolveNs(domain),
          dns.resolveTxt(domain),
        ])
        return { domain, type: 'ALL', elapsed: Date.now() - t0,
          A:   A.status  === 'fulfilled' ? A.value  : [],
          MX:  MX.status === 'fulfilled' ? MX.value : [],
          NS:  NS.status === 'fulfilled' ? NS.value : [],
          TXT: TXT.status === 'fulfilled' ? TXT.value.map(r => r.join(' ')) : [],
          source: 'local',
        }
      }
      default:
        records = await dns.resolve(domain)
    }
    return { domain, type, records, elapsed: Date.now() - t0, source: 'local' }
  } catch (e) {
    return { domain, type, error: e.message, elapsed: Date.now() - t0, source: 'local' }
  }
}

// ─── Traceroute ──────────────────────────────────────────────────────────────

function parseTraceLine(line, platform) {
  line = line.trim()
  if (!line) return null

  // Match hop number at start
  const hopMatch = line.match(/^(\d+)/)
  if (!hopMatch) return null
  const hop = parseInt(hopMatch[1])

  // All asterisks = timeout
  if (/^[\d\s]+(\*\s*){2,}/.test(line)) {
    return { hop, host: '*', ip: '*', latency: null, timeout: true }
  }

  // Extract first IP address
  const ipMatch = line.match(/(\d{1,3}(?:\.\d{1,3}){3})/)
  if (!ipMatch) return null
  const ip = ipMatch[1]

  // Extract hostname (might come before or after IP in parentheses)
  const hostMatch = line.match(/\((\d{1,3}(?:\.\d{1,3}){3})\)/)
  const host = hostMatch ? line.split('(')[0].trim().split(/\s+/).pop() : ip

  // Extract latency (first ms value)
  const latMatch = line.match(/(\d+\.?\d*)\s*ms/)
  const latency = latMatch ? parseFloat(latMatch[1]) : null

  return { hop, host: host || ip, ip, latency, timeout: false }
}

async function runTraceroute(target) {
  return new Promise((resolve) => {
    const platform = os.platform()
    const isWin = platform === 'win32'
    const cmd  = isWin ? 'tracert' : 'traceroute'
    const args = isWin
      ? ['-d', '-h', '30', '-w', '2000', target]
      : ['-n', '-m', '30', '-w', '2', target]

    const hops = []
    let output = ''

    const proc = spawn(cmd, args, { timeout: 60000 })

    proc.stdout.on('data', d => { output += d.toString() })
    proc.stderr.on('data', d => { output += d.toString() })

    proc.on('close', () => {
      for (const line of output.split('\n')) {
        const hop = parseTraceLine(line, platform)
        if (hop && hop.hop <= 30) {
          // Deduplicate / keep best latency per hop number
          const existing = hops.find(h => h.hop === hop.hop)
          if (!existing) hops.push(hop)
          else if (hop.latency !== null && (existing.latency === null || hop.latency < existing.latency)) {
            Object.assign(existing, hop)
          }
        }
      }
      resolve({ hops: hops.sort((a, b) => a.hop - b.hop), simulated: false, source: 'local' })
    })

    proc.on('error', () => {
      resolve({ hops: [], simulated: true, source: 'local', error: `Could not run ${cmd}` })
    })
  })
}

// ─── ICMP Ping (system command) ──────────────────────────────────────────────

async function runPingOnce(target) {
  const platform = os.platform()
  const isWin = platform === 'win32'
  const args = isWin ? ['-n', '1', '-w', '2000', target] : ['-c', '1', '-W', '2', target]
  return new Promise((resolve) => {
    const proc = spawn('ping', args, { timeout: 5000 })
    let output = ''
    proc.stdout.on('data', d => { output += d.toString() })
    proc.stderr.on('data', d => { output += d.toString() })
    proc.on('close', (code) => {
      const match = output.match(/time[=<](\d+\.?\d*)\s*ms/i)
      resolve({
        latency: match ? parseFloat(match[1]) : null,
        success: code === 0,
        source: 'local-icmp',
      })
    })
    proc.on('error', () => resolve({ latency: null, success: false, source: 'local-icmp' }))
  })
}

// ─── HTTP Server ─────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return }

  const url    = new URL(req.url, `http://localhost:${PORT}`)
  const path   = url.pathname
  const q      = Object.fromEntries(url.searchParams)

  // ── /health ──────────────────────────────────────────────────────────────
  if (path === '/health') {
    return json(res, {
      ok: true,
      version: VERSION,
      hostname: os.hostname(),
      platform: os.platform(),
      uptime: process.uptime(),
    })
  }

  // ── /netinfo ─────────────────────────────────────────────────────────────
  if (path === '/netinfo') {
    const [gateway, dnsServers] = await Promise.all([getDefaultGateway(), getLocalDNS()])
    return json(res, {
      hostname: os.hostname(),
      platform: os.platform(),
      interfaces: getInterfaces(),
      gateway,
      dns: dnsServers,
      source: 'local',
    })
  }

  // ── /dns ─────────────────────────────────────────────────────────────────
  if (path === '/dns') {
    const { domain, type = 'A' } = q
    if (!domain) return json(res, { error: 'domain required' }, 400)
    return json(res, await dnsLookup(domain, type))
  }

  // ── /portscan ─────────────────────────────────────────────────────────────
  if (path === '/portscan') {
    const { host, ports } = q
    if (!host) return json(res, { error: 'host required' }, 400)

    const portList = ports ? parsePorts(ports) : Object.keys(KNOWN_PORTS).map(Number)
    if (portList.length === 0) return json(res, { error: 'No valid ports' }, 400)
    if (portList.length > 500) return json(res, { error: 'Max 500 ports' }, 400)

    let ip = host
    try {
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
        const addrs = await dns.resolve4(host).catch(() => dns.resolve6(host))
        ip = addrs[0]
      }
    } catch {
      return json(res, { error: `Could not resolve: ${host}` }, 400)
    }

    const BATCH = 20
    const open = []
    for (let i = 0; i < portList.length; i += BATCH) {
      const batch = portList.slice(i, i + BATCH)
      const results = await Promise.all(batch.map(async port => ({
        port, service: KNOWN_PORTS[port] ?? `${port}/tcp`, ...(await checkPort(ip, port))
      })))
      for (const r of results) if (r.open) open.push({ port: r.port, service: r.service, banner: r.banner })
    }

    return json(res, { host, ip, open, total: portList.length, scanned: portList.length, source: 'local' })
  }

  // ── /traceroute ───────────────────────────────────────────────────────────
  if (path === '/traceroute') {
    const { target = '8.8.8.8' } = q
    return json(res, await runTraceroute(target))
  }

  // ── /ping ─────────────────────────────────────────────────────────────────
  if (path === '/ping') {
    const { target = '1.1.1.1' } = q
    return json(res, await runPingOnce(target))
  }

  json(res, { error: 'Not found' }, 404)
})

server.listen(PORT, '127.0.0.1', () => {
  const line = '─'.repeat(52)
  console.log(`\n╔${line}╗`)
  console.log(`║  🚀 MySpeed Local Agent v${VERSION}${' '.repeat(52 - 28 - VERSION.length)}║`)
  console.log(`╠${line}╣`)
  console.log(`║  Listening on  http://localhost:${PORT}${' '.repeat(52 - 20 - String(PORT).length)}║`)
  console.log(`║  Hostname      ${os.hostname().slice(0, 36).padEnd(36)}║`)
  console.log(`║  Platform      ${os.platform().padEnd(36)}║`)
  console.log(`╠${line}╣`)
  console.log(`║  Abra o MySpeed — o agente será detectado           ║`)
  console.log(`║  automaticamente e todos os testes de rede           ║`)
  console.log(`║  passarão a originar do seu dispositivo.             ║`)
  console.log(`╠${line}╣`)
  console.log(`║  Endpoints disponíveis:                              ║`)
  console.log(`║    GET /health      — status do agente               ║`)
  console.log(`║    GET /netinfo     — interfaces e gateway local      ║`)
  console.log(`║    GET /ping        — ping ICMP (comando do sistema)  ║`)
  console.log(`║    GET /traceroute  — rota real a partir daqui        ║`)
  console.log(`║    GET /dns         — resolve via seu DNS local       ║`)
  console.log(`║    GET /portscan    — scan TCP (alcança IPs internos) ║`)
  console.log(`╠${line}╣`)
  console.log(`║  Pressione Ctrl+C para encerrar o agente.            ║`)
  console.log(`╚${line}╝\n`)

  // Show local interfaces
  const ifaces = getInterfaces()
  if (ifaces.length > 0) {
    console.log('  Interfaces detectadas:')
    for (const i of ifaces) {
      console.log(`    ${i.name.padEnd(12)} ${i.address} (${i.family})`)
    }
    console.log()
  }
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Porta ${PORT} já está em uso. O agente já está rodando?\n`)
  } else {
    console.error('Erro no servidor:', err.message)
  }
  process.exit(1)
})

process.on('SIGINT',  () => { console.log('\n\n  Agente encerrado.\n'); process.exit(0) })
process.on('SIGTERM', () => process.exit(0))
