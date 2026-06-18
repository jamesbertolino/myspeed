#!/usr/bin/env node
'use strict'
/**
 * MySpeed Android Agent — execute no Termux para testes de rede reais
 * e scan WiFi diretamente do seu dispositivo Android.
 *
 * ─── Pré-requisitos ───────────────────────────────────────────────────────────
 *
 *  1. Instale o Termux pelo F-Droid (NÃO use a Play Store — versão desatualizada)
 *     https://f-droid.org/packages/com.termux/
 *
 *  2. Instale o Termux:API pelo F-Droid (necessário para scan WiFi)
 *     https://f-droid.org/packages/com.termux.api/
 *
 *  3. No Termux, instale as dependências:
 *       pkg update -y && pkg install -y nodejs traceroute inetutils termux-api
 *
 *  4. Conceda permissão de Localização ao app "Termux:API" nas configurações
 *     do Android (obrigatório para o scan de redes WiFi próximas).
 *
 *  5. Execute o agente:
 *       node scripts/android-agent.js
 *
 *  6. Abra o MySpeed no Chrome do Android (mesma sessão Termux aberta)
 *     e todos os testes originarão do seu dispositivo automaticamente.
 *
 * ─── Portas ──────────────────────────────────────────────────────────────────
 *
 *  3777  →  Diagnósticos de rede: ping, traceroute, DNS, port scan
 *  7474  →  WiFi scan, interfaces e descoberta de dispositivos
 */

const http = require('http')
const tcp  = require('net')
const dns  = require('dns/promises')
const os   = require('os')
const fs   = require('fs')
const { exec, spawn } = require('child_process')

// ── Config ────────────────────────────────────────────────────────────────────

const NET_PORT  = parseInt(process.env.NET_PORT  || '3777', 10)
const WIFI_PORT = parseInt(process.env.WIFI_PORT || '7474', 10)
const VERSION   = '1.0.0'

const CORS = {
  'Access-Control-Allow-Origin':          '*',
  'Access-Control-Allow-Methods':         'GET, OPTIONS',
  'Access-Control-Allow-Headers':         'Content-Type',
  'Access-Control-Allow-Private-Network': 'true',  // Required: Chrome blocks https→localhost without this
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS })
  res.end(JSON.stringify(data))
}

function execCmd(cmd, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: timeoutMs }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}

// ── Android / Termux detection ────────────────────────────────────────────────

function isTermux() {
  return process.env.TERMUX_VERSION !== undefined ||
    (process.env.PREFIX || '').includes('com.termux') ||
    fs.existsSync('/data/data/com.termux')
}

async function getAndroidInfo() {
  const info = {}
  try { info.model          = (await execCmd('getprop ro.product.model',          2_000)).trim() } catch {}
  try { info.androidVersion = (await execCmd('getprop ro.build.version.release',  2_000)).trim() } catch {}
  try { info.battery        = JSON.parse(await execCmd('termux-battery-status',   5_000)) }        catch {}
  return info
}

// ── WiFi utilities ────────────────────────────────────────────────────────────

function freqToChannel(freq) {
  if (freq === 2484) return 14
  if (freq >= 2412 && freq <= 2472) return Math.round((freq - 2407) / 5)
  if (freq >= 5160 && freq <= 5885) return Math.round((freq - 5000) / 5)
  if (freq >= 5955) return Math.round((freq - 5950) / 5) + 1  // WiFi 6E
  return 0
}

function parseSecurity(caps) {
  if (!caps) return 'Open'
  if (caps.includes('WPA3')) return 'WPA3'
  if (caps.includes('WPA2')) return 'WPA2'
  if (caps.includes('WPA'))  return 'WPA'
  if (caps.includes('WEP'))  return 'WEP'
  return 'Open'
}

async function wifiScan() {
  const raw  = await execCmd('termux-wifi-scaninfo', 12_000)
  const list = JSON.parse(raw.trim())
  if (!Array.isArray(list)) throw new Error('termux-wifi-scaninfo returned unexpected data')
  return list
    .map(n => {
      const channel = freqToChannel(n.frequency || 0)
      if (!channel) return null
      const freq = n.frequency || 0
      const band = freq < 3000 ? '2.4' : freq < 5950 ? '5' : '6'
      return {
        ssid:     n.ssid   || 'Hidden',
        bssid:    n.bssid,
        signal:   n.level,
        channel,
        band,
        width:    band === '2.4' ? 20 : 80,
        security: parseSecurity(n.capabilities || ''),
      }
    })
    .filter(Boolean)
}

async function wifiConnectionInfo() {
  try {
    return JSON.parse(await execCmd('termux-wifi-connectioninfo', 4_000))
  } catch {
    return null
  }
}

// ── Network interfaces ────────────────────────────────────────────────────────

function getInterfaces() {
  const result = []
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of (addrs || [])) {
      if (a.family === 'IPv4') {
        const parts = a.address.split('.')
        result.push({
          name,
          address:  a.address,
          netmask:  a.netmask,
          mac:      a.mac,
          internal: a.internal,
          subnet:   `${parts[0]}.${parts[1]}.${parts[2]}`,
        })
      }
    }
  }
  return result
}

function guessSubnet() {
  const iface = getInterfaces().find(i => !i.internal)
  return iface?.subnet ?? null
}

// ── ARP table (best-effort MAC lookup) ────────────────────────────────────────

function readArpTable() {
  const map = new Map()
  try {
    const rows = fs.readFileSync('/proc/net/arp', 'utf8').split('\n').slice(1)
    for (const row of rows) {
      const parts = row.trim().split(/\s+/)
      if (parts.length >= 4 && parts[2] === '0x2') {
        map.set(parts[0], parts[3] !== '00:00:00:00:00:00' ? parts[3] : null)
      }
    }
  } catch { /* not available */ }
  return map
}

// ── Ping ──────────────────────────────────────────────────────────────────────

function tcpPing(host, port, timeout = 3_000) {
  return new Promise(resolve => {
    const t0   = Date.now()
    const sock = new tcp.Socket()
    sock.setTimeout(timeout)
    sock.on('connect', () => { sock.destroy(); resolve(Date.now() - t0) })
    sock.on('timeout', () => { sock.destroy(); resolve(-1) })
    sock.on('error',   () => { sock.destroy(); resolve(-1) })
    sock.connect(port, host)
  })
}

async function icmpPing(target) {
  try {
    const out = await execCmd(`ping -c 1 -W 3 ${target}`, 6_000)
    const m   = out.match(/time[<=]([\d.]+)\s*ms/i)
    return m ? Math.round(parseFloat(m[1])) : -1
  } catch {
    return -1
  }
}

async function smartPing(target) {
  // Try ICMP first (needs: pkg install inetutils)
  const icmp = await icmpPing(target)
  if (icmp >= 0) return { ms: icmp, method: 'icmp', source: 'local-icmp', success: true, latency: icmp }

  // Fallback: TCP connect on common ports
  for (const port of [443, 80, 53]) {
    const t = await tcpPing(target, port)
    if (t >= 0) return { ms: t, method: `tcp-${port}`, source: 'local-tcp', success: true, latency: t }
  }
  return { ms: -1, method: 'timeout', source: 'local', success: false, latency: -1 }
}

// ── Traceroute ────────────────────────────────────────────────────────────────

function runTraceroute(target) {
  return new Promise(resolve => {
    const hops = []
    let   buf  = ''

    const child = spawn('traceroute', ['-n', '-m', '20', '-w', '2', target])
    const timer = setTimeout(() => {
      child.kill()
      resolve({ hops, simulated: false, source: 'local' })
    }, 30_000)

    function parseLine(line) {
      const m = line.trim().match(/^(\d+)\s+(.+)/)
      if (!m) return
      const rest = m[2]
      if (/\*\s*\*\s*\*/.test(rest)) {
        hops.push({ hop: parseInt(m[1]), host: '*', ip: '*', latency: null, timeout: true })
      } else {
        const ip = rest.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/)?.[1] ?? '*'
        const ms = rest.match(/([\d.]+)\s*ms/i)
        hops.push({ hop: parseInt(m[1]), host: ip, ip, latency: ms ? Math.round(parseFloat(ms[1])) : null, timeout: false })
      }
    }

    for (const s of [child.stdout, child.stderr]) {
      s.on('data', chunk => {
        buf += chunk.toString()
        const lines = buf.split('\n'); buf = lines.pop() ?? ''
        lines.forEach(parseLine)
      })
    }

    child.on('close', () => {
      clearTimeout(timer)
      if (buf.trim()) parseLine(buf)
      resolve({ hops, simulated: false, source: 'local' })
    })

    child.on('error', () => {
      clearTimeout(timer)
      resolve({
        hops:      [],
        simulated: true,
        source:    'local',
        error:     'traceroute não encontrado — execute: pkg install traceroute',
      })
    })
  })
}

// ── DNS ───────────────────────────────────────────────────────────────────────

async function runDns(domain, type) {
  const t0 = Date.now()
  try {
    let records
    switch (type) {
      case 'A':     records = await dns.resolve4(domain);    break
      case 'AAAA':  records = await dns.resolve6(domain);    break
      case 'MX':    records = await dns.resolveMx(domain);   break
      case 'TXT':   records = await dns.resolveTxt(domain);  break
      case 'NS':    records = await dns.resolveNs(domain);   break
      case 'CNAME': records = await dns.resolveCname(domain); break
      case 'SOA':   records = await dns.resolveSoa(domain);  break
      case 'ALL': {
        const [A, MX, NS, TXT] = await Promise.allSettled([
          dns.resolve4(domain), dns.resolveMx(domain),
          dns.resolveNs(domain), dns.resolveTxt(domain),
        ])
        return {
          domain, type, elapsed: Date.now() - t0,
          A:   A.status   === 'fulfilled' ? A.value   : [],
          MX:  MX.status  === 'fulfilled' ? MX.value  : [],
          NS:  NS.status  === 'fulfilled' ? NS.value  : [],
          TXT: TXT.status === 'fulfilled' ? TXT.value : [],
        }
      }
      default: records = await dns.resolve4(domain)
    }
    return { domain, type, records: Array.isArray(records) ? records : [records], elapsed: Date.now() - t0 }
  } catch (e) {
    return { domain, type, records: [], elapsed: Date.now() - t0, error: e.message }
  }
}

// ── Port scanner ──────────────────────────────────────────────────────────────

function probePort(host, port, timeout = 1_200) {
  return new Promise(resolve => {
    const sock = new tcp.Socket()
    sock.setTimeout(timeout)
    sock.on('connect', () => { sock.destroy(); resolve(true) })
    sock.on('timeout', () => { sock.destroy(); resolve(false) })
    sock.on('error',   () => { sock.destroy(); resolve(false) })
    sock.connect(port, host)
  })
}

const COMMON_PORTS = [
  { port: 21,    service: 'FTP'           },
  { port: 22,    service: 'SSH'           },
  { port: 23,    service: 'Telnet'        },
  { port: 25,    service: 'SMTP'          },
  { port: 53,    service: 'DNS'           },
  { port: 80,    service: 'HTTP'          },
  { port: 110,   service: 'POP3'          },
  { port: 143,   service: 'IMAP'          },
  { port: 443,   service: 'HTTPS'         },
  { port: 445,   service: 'SMB'           },
  { port: 587,   service: 'SMTP/TLS'      },
  { port: 993,   service: 'IMAPS'         },
  { port: 995,   service: 'POP3S'         },
  { port: 1433,  service: 'MSSQL'         },
  { port: 1521,  service: 'Oracle'        },
  { port: 2049,  service: 'NFS'           },
  { port: 3000,  service: 'HTTP/Dev'      },
  { port: 3306,  service: 'MySQL'         },
  { port: 3389,  service: 'RDP'           },
  { port: 4444,  service: 'Shell/C2'      },
  { port: 5432,  service: 'PostgreSQL'    },
  { port: 5900,  service: 'VNC'           },
  { port: 6379,  service: 'Redis'         },
  { port: 8080,  service: 'HTTP-Alt'      },
  { port: 8443,  service: 'HTTPS-Alt'     },
  { port: 8888,  service: 'Jupyter'       },
  { port: 9200,  service: 'Elasticsearch' },
  { port: 11211, service: 'Memcached'     },
  { port: 27017, service: 'MongoDB'       },
]

function parseCustomPorts(input) {
  const result = new Set()
  for (const p of input.split(/[\s,;]+/).filter(Boolean)) {
    if (p.includes('-')) {
      const [a, b] = p.split('-').map(Number)
      if (!isNaN(a) && !isNaN(b) && a >= 1 && b <= 65535)
        for (let i = a; i <= Math.min(b, a + 999); i++) result.add(i)
    } else {
      const n = parseInt(p, 10)
      if (!isNaN(n) && n >= 1 && n <= 65535) result.add(n)
    }
  }
  return [...result].slice(0, 500)
}

// ── Device discovery (ping sweep) ─────────────────────────────────────────────

const SCAN_PORTS = [80, 443, 22, 23, 8080]

async function discoverDevices(subnet) {
  const arp    = readArpTable()
  const found  = new Map()

  // Seed with ARP entries (already-seen devices)
  for (const [ip, mac] of arp) {
    if (ip.startsWith(subnet)) found.set(ip, mac)
  }

  // Add gateway as a seed
  const gwIp = `${subnet}.1`
  if (!found.has(gwIp)) found.set(gwIp, null)

  // ICMP sweep
  const pings = []
  for (let i = 1; i <= 254; i++) {
    const ip = `${subnet}.${i}`
    pings.push(
      icmpPing(ip).then(ms => { if (ms >= 0 && !found.has(ip)) found.set(ip, null) }).catch(() => {})
    )
  }
  await Promise.all(pings)

  // Re-read ARP after sweep
  const arp2 = readArpTable()
  for (const [ip, mac] of arp2) {
    if (ip.startsWith(subnet)) found.set(ip, mac ?? found.get(ip) ?? null)
  }

  const devices = await Promise.all(
    [...found].map(async ([ip, mac]) => {
      const [latency, ...portResults] = await Promise.all([
        icmpPing(ip),
        ...SCAN_PORTS.map(port => probePort(ip, port, 600)),
      ])
      const openPorts = SCAN_PORTS.filter((_, i) => portResults[i])
      return { ip, mac: mac ?? null, vendor: null, hostname: null, openPorts, alive: latency >= 0 }
    })
  )

  return devices
    .filter(d => d.alive)
    .sort((a, b) => {
      const last = ip => parseInt(ip.split('.')[3], 10)
      return last(a.ip) - last(b.ip)
    })
}

// ── CORS preflight helper ─────────────────────────────────────────────────────

function handleOptions(req, res) {
  if (req.method !== 'OPTIONS') return false
  res.writeHead(204, CORS)
  res.end()
  return true
}

// ── Net Agent server (port 3777) ──────────────────────────────────────────────

const netServer = http.createServer(async (req, res) => {
  if (handleOptions(req, res)) return

  const url    = new URL(req.url, `http://localhost:${NET_PORT}`)
  const path   = url.pathname
  const params = url.searchParams

  try {
    // ── /health ────────────────────────────────────────────────────────────────
    if (path === '/health') {
      const android = await getAndroidInfo()
      return sendJson(res, {
        ok:       true,
        version:  VERSION,
        hostname: os.hostname(),
        platform: 'android',
        source:   'android-agent',
        ...android,
      })
    }

    // ── /ping ──────────────────────────────────────────────────────────────────
    if (path === '/ping') {
      const target = params.get('target') || '8.8.8.8'
      return sendJson(res, await smartPing(target))
    }

    // ── /dns ───────────────────────────────────────────────────────────────────
    if (path === '/dns') {
      const domain = params.get('domain') || 'google.com'
      const type   = (params.get('type') || 'A').toUpperCase()
      return sendJson(res, await runDns(domain, type))
    }

    // ── /traceroute ────────────────────────────────────────────────────────────
    if (path === '/traceroute') {
      return sendJson(res, await runTraceroute(params.get('target') || '8.8.8.8'))
    }

    // ── /portscan ──────────────────────────────────────────────────────────────
    if (path === '/portscan') {
      const host      = params.get('host') || '127.0.0.1'
      const portsRaw  = params.get('ports')
      const portList  = portsRaw
        ? parseCustomPorts(portsRaw).map(p => ({ port: p, service: `Port ${p}` }))
        : COMMON_PORTS

      const scan = await Promise.all(
        portList.map(async ({ port, service }) => ({ port, service, open: await probePort(host, port) }))
      )

      const open   = scan.filter(r => r.open).map(r =>  ({ port: r.port, service: r.service, state: 'open'   }))
      const closed = scan.filter(r => !r.open).map(r => ({ port: r.port, service: r.service, state: 'closed' }))
      let ip = host
      try { [ip] = await dns.resolve4(host) } catch {}
      return sendJson(res, { host, ip, open, closed, source: 'local' })
    }

    // ── /netinfo ───────────────────────────────────────────────────────────────
    if (path === '/netinfo') {
      const wifi = await wifiConnectionInfo()
      return sendJson(res, { interfaces: getInterfaces(), wifi, source: 'local' })
    }

    // ── /android ───────────────────────────────────────────────────────────────
    if (path === '/android') {
      const info = await getAndroidInfo()
      return sendJson(res, { ...info, wifi: await wifiConnectionInfo(), platform: 'android' })
    }

    sendJson(res, { error: 'Not found' }, 404)
  } catch (e) {
    sendJson(res, { error: e.message }, 500)
  }
})

// ── WiFi Agent server (port 7474) ─────────────────────────────────────────────

const wifiServer = http.createServer(async (req, res) => {
  if (handleOptions(req, res)) return

  const url    = new URL(req.url, `http://localhost:${WIFI_PORT}`)
  const path   = url.pathname
  const params = url.searchParams

  try {
    // ── /ping (health check — same contract as wifi-agent.js) ─────────────────
    if (path === '/ping') {
      return sendJson(res, {
        ready:    true,
        platform: 'android',
        version:  VERSION,
        source:   'android-agent',
      })
    }

    // ── /scan — real WiFi scan via termux-wifi-scaninfo ───────────────────────
    if (path === '/scan') {
      try {
        const networks = await wifiScan()
        return sendJson(res, networks)
      } catch (e) {
        return sendJson(res, {
          error: e.message,
          help:  'Instale o Termux:API e conceda permissão de Localização ao app Termux:API.',
          setup: 'pkg install termux-api',
        }, 503)
      }
    }

    // ── /interfaces ───────────────────────────────────────────────────────────
    if (path === '/interfaces') {
      const wifi = await wifiConnectionInfo()
      return sendJson(res, { interfaces: getInterfaces(), wifi })
    }

    // ── /devices — ARP + ICMP sweep ───────────────────────────────────────────
    if (path === '/devices') {
      const subnet  = params.get('subnet') || guessSubnet()
      if (!subnet) return sendJson(res, { error: 'Subnet não detectada' }, 400)
      const devices = await discoverDevices(subnet)
      return sendJson(res, { devices, subnet, source: 'local' })
    }

    sendJson(res, { error: 'Not found' }, 404)
  } catch (e) {
    sendJson(res, { error: e.message }, 500)
  }
})

// ── Start ─────────────────────────────────────────────────────────────────────

function startBanner(androidInfo) {
  const ifaces = getInterfaces().filter(i => !i.internal)
  const model  = androidInfo.model || 'Android'
  const ver    = androidInfo.androidVersion ? `(Android ${androidInfo.androidVersion})` : ''

  console.log('')
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log(`║  MySpeed Android Agent v${VERSION}                          ║`)
  console.log('╠══════════════════════════════════════════════════════════╣')
  console.log(`║  Dispositivo: ${(model + ' ' + ver).slice(0, 42).padEnd(42)} ║`)
  console.log(`║  Diagnósticos: http://localhost:${NET_PORT}                  ║`)
  console.log(`║  WiFi scan:    http://localhost:${WIFI_PORT}                  ║`)
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log('')
  if (ifaces.length) {
    console.log('  Interfaces:')
    ifaces.forEach(i => console.log(`    ${i.name.padEnd(10)} ${i.address}`))
    console.log('')
  }
  console.log('  → Abra o MySpeed no Chrome do Android.')
  console.log('    Os testes originarão do seu dispositivo automaticamente.')
  console.log('')
  console.log('  Dica: se o scan WiFi não funcionar, conceda a permissão')
  console.log('  de Localização ao app "Termux:API" nas configurações do Android.')
  console.log('')
  console.log('  Pressione Ctrl+C para encerrar.')
  console.log('')
}

if (!isTermux()) {
  console.warn('\n⚠  Este agente é otimizado para Android/Termux.')
  console.warn('   Para desktop use: node scripts/local-agent.js  (porta 3777)')
  console.warn('                e:   node wifi-agent.js            (porta 7474)\n')
}

netServer.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`✗ Porta ${NET_PORT} já em uso — outro agente está rodando?`)
  else console.error('✗ Erro no servidor de rede:', e.message)
})

wifiServer.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`✗ Porta ${WIFI_PORT} já em uso — wifi-agent.js já está rodando?`)
  else console.error('✗ Erro no servidor WiFi:', e.message)
})

netServer.listen(NET_PORT, '127.0.0.1', () => {
  wifiServer.listen(WIFI_PORT, '127.0.0.1', async () => {
    const androidInfo = await getAndroidInfo()
    startBanner(androidInfo)
  })
})

process.on('SIGINT',  () => { netServer.close(); wifiServer.close(); process.exit(0) })
process.on('SIGTERM', () => { netServer.close(); wifiServer.close(); process.exit(0) })
