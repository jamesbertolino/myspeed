#!/usr/bin/env node
'use strict'
/**
 * MySpeed WiFi Agent — rode localmente para habilitar scan real de WiFi e
 * escaneamento de dispositivos na rede local.
 *
 * Uso:
 *   node wifi-agent.js          # porta padrão 7474
 *   node wifi-agent.js 8888     # porta personalizada
 *
 * Não precisa de npm install — usa apenas módulos nativos do Node.js.
 */

const http = require('http')
const net = require('net')
const { execSync } = require('child_process')

const PORT = parseInt(process.argv[2] || '7474', 10)

// ── Helpers (WiFi) ────────────────────────────────────────────────────────────

function signalPctToDbm(pct) {
  return Math.round((pct / 2) - 100)
}

function channelToBand(ch) {
  return ch > 14 ? '5' : '2.4'
}

function extractField(lines, ...patterns) {
  for (const line of lines) {
    for (const pattern of patterns) {
      const m = line.match(pattern)
      if (m) return m[1]?.trim()
    }
  }
}

function radioTypeToWidth(rt) {
  rt = (rt || '').toLowerCase()
  if (rt.includes('ax') || rt.includes('ac')) return 80
  if (rt.includes('n')) return 40
  return 20
}

function phyToWidth(phy) {
  const p = (phy || '').toLowerCase()
  if (p === 'he') return 80
  if (p === 'vht') return 80
  if (p === 'ht') return 40
  return 20
}

// ── Connected network detection ──────────────────────────────────────────────

function getConnectedNetwork() {
  try {
    if (isTermux()) {
      const out = execSync('termux-wifi-connectioninfo', { encoding: 'utf8', timeout: 5000 })
      const info = JSON.parse(out)
      if (info.bssid) return { ssid: info.ssid || null, bssid: info.bssid.toLowerCase() }
      return null
    }
    if (process.platform === 'win32') {
      const out = execSync('netsh wlan show interfaces', { encoding: 'utf8', timeout: 5000 })
      const lines = out.split('\n').map(l => l.trim()).filter(Boolean)
      const bssid = extractField(lines, /^(?:AP\s+)?BSSID\s*:\s*(.+)/i)
      const ssid  = extractField(lines, /^SSID\s*:\s*(?!.*BSSID)(.+)/i)
      if (bssid) return { ssid: ssid || null, bssid: bssid.toLowerCase() }
      return null
    }
    if (process.platform === 'darwin') {
      const ap = '/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport'
      const out = execSync(`${ap} -I`, { encoding: 'utf8', timeout: 5000 })
      const lines = out.split('\n').map(l => l.trim()).filter(Boolean)
      const bssid = extractField(lines, /^BSSID:\s*(.+)/i)
      const ssid  = extractField(lines, /^\s*SSID:\s*(.+)/i)
      if (bssid) return { ssid: ssid || null, bssid: bssid.toLowerCase() }
      return null
    }
    // Linux
    const out = execSync("nmcli -t -f ACTIVE,SSID,BSSID dev wifi 2>/dev/null", { encoding: 'utf8', timeout: 5000 })
    const active = out.split('\n').find(l => l.startsWith('yes:'))
    if (active) {
      const parts = active.split(':')
      const ssid  = parts[1] || null
      const bssid = parts.slice(2, 8).join(':').toLowerCase()
      if (bssid.length === 17) return { ssid, bssid }
    }
    return null
  } catch (_) { return null }
}

// ── Platform WiFi scanners ────────────────────────────────────────────────────

const WINRT_SCAN_PS1 = String.raw`
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Devices.WiFi.WiFiAdapter,Windows.Devices.WiFi,ContentType=WindowsRuntime]
$null = [Windows.Devices.Enumeration.DeviceInformation,Windows.Devices.Enumeration,ContentType=WindowsRuntime]

function AwaitOp($Task, $T) {
  $methods = [System.WindowsRuntimeSystemExtensions].GetMethods('Public,Static') |
    Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 }
  foreach ($m in $methods) {
    try {
      $net = $m.MakeGenericMethod($T).Invoke($null, @($Task))
      $net.Wait(-1) | Out-Null
      return $net.Result
    } catch {}
  }
}

function AwaitAction($Task) {
  $methods = [System.WindowsRuntimeSystemExtensions].GetMethods('Public,Static') |
    Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType.Name -notlike 'IAsyncOperation*' }
  foreach ($m in $methods) {
    try { $net = $m.Invoke($null, @($Task)); if ($net) { $net.Wait(-1) | Out-Null; return } } catch {}
  }
}

$sel  = [Windows.Devices.WiFi.WiFiAdapter]::GetDeviceSelector()
$devs = AwaitOp ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($sel)) ([Windows.Devices.Enumeration.DeviceInformationCollection])
if (-not $devs -or $devs.Count -eq 0) { '[]'; exit }

$adapter = AwaitOp ([Windows.Devices.WiFi.WiFiAdapter]::FromIdAsync($devs[0].Id)) ([Windows.Devices.WiFi.WiFiAdapter])
AwaitAction ($adapter.ScanAsync())

$result = $adapter.NetworkReport.AvailableNetworks | ForEach-Object {
  $f  = $_.ChannelCenterFrequencyInKilohertz / 1000
  $b  = if ($f -lt 3000) { '2.4' } else { '5' }
  $ch = if ($b -eq '2.4') { [int](($f - 2412) / 5) + 1 } else { [int](($f - 5180) / 5) + 36 }
  [PSCustomObject]@{
    ssid    = $_.Ssid
    bssid   = $_.Bssid
    signal  = [int]$_.NetworkRssiInDecibelMilliwatts
    channel = $ch
    band    = $b
    phy     = $_.PhyKind.ToString()
  }
}
$result | ConvertTo-Json -Compress
`

function scanWindowsWinRT() {
  const os = require('os')
  const path = require('path')
  const fs = require('fs')
  const psFile = path.join(os.tmpdir(), 'myspeed-wifiscan.ps1')
  fs.writeFileSync(psFile, WINRT_SCAN_PS1, 'utf8')

  const raw = execSync(
    `powershell -NoProfile -ExecutionPolicy Bypass -File "${psFile}"`,
    { encoding: 'utf8', timeout: 15000 }
  ).trim()

  if (!raw || raw === '[]') return []

  const parsed = JSON.parse(raw)
  const items = Array.isArray(parsed) ? parsed : [parsed]
  return items
    .filter(n => n.channel && n.channel > 0)
    .map(n => ({
      ssid: n.ssid || 'Hidden',
      bssid: n.bssid,
      signal: n.signal,
      channel: n.channel,
      band: n.band,
      width: phyToWidth(n.phy),
    }))
}

function scanWindows() {
  try {
    const networks = scanWindowsWinRT()
    if (networks.length > 0) return networks
  } catch (_) { /* fall through */ }

  const networks = []
  try {
    const out = execSync('netsh wlan show interfaces', { encoding: 'utf8', timeout: 5000 })
    const lines = out.split('\n').map(l => l.trim()).filter(Boolean)
    const ssid = extractField(lines, /^SSID\s*:\s*(?!.*BSSID)(.+)/i)
    const bssid = extractField(lines, /^(?:AP\s+)?BSSID\s*:\s*(.+)/i)
    const channelRaw = extractField(lines, /^(?:Channel|Canal)\s*:\s*(\d+)/i)
    const rssiRaw = extractField(lines, /^Rssi\s*:\s*(-?\d+)/i)
    const signalPctRaw = extractField(lines, /^(?:Signal|Sinal)\s*:\s*(\d+)/i)
    const radioType = extractField(lines, /^Radio type\s*:\s*(.+)/i, /^Tipo de r[áa]dio\s*:\s*(.+)/i) || ''
    const auth = extractField(lines, /^Authentication\s*:\s*(.+)/i, /^Autenti[^\s]*\s*:\s*(.+)/i)
    const channel = channelRaw ? parseInt(channelRaw) : 0
    const signal = rssiRaw
      ? parseInt(rssiRaw)
      : signalPctRaw ? signalPctToDbm(parseInt(signalPctRaw)) : -70
    if (ssid && channel) {
      networks.push({
        ssid, bssid, signal, channel,
        band: channelToBand(channel),
        width: radioTypeToWidth(radioType),
        security: auth,
      })
    }
  } catch (_) {}
  return networks
}

function scanMac() {
  const ap = '/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport'
  const out = execSync(`${ap} -s`, { encoding: 'utf8', timeout: 8000 })
  return out.trim().split('\n').slice(1).filter(Boolean).map(line => {
    const p = line.trim().split(/\s+/)
    const channel = parseInt(p[3]?.split(',')[0]) || 6
    return {
      ssid: p[0] || 'Hidden',
      bssid: p[1],
      signal: parseInt(p[2]) || -70,
      channel,
      band: channelToBand(channel),
      width: 20,
    }
  })
}

function scanLinux() {
  const out = execSync(
    'nmcli -t -f SSID,BSSID,CHAN,SIGNAL,SECURITY,FREQ dev wifi list',
    { encoding: 'utf8', timeout: 8000 }
  )
  return out.trim().split('\n').filter(Boolean).map(line => {
    const parts = line.split(':')
    const ssid = parts[0] || 'Hidden'
    const bssid = parts.slice(1, 7).join(':')
    const channel = parseInt(parts[7]) || 6
    const pct = parseInt(parts[8]) || 50
    const security = parts[9] || 'Open'
    const freq = parts[10] || ''
    return {
      ssid, bssid, channel,
      signal: signalPctToDbm(pct),
      band: freq.includes('5') ? '5' : channelToBand(channel),
      width: channel > 14 ? 80 : 20,
      security,
    }
  })
}

// Android via Termux + Termux:API app
// https://wiki.termux.com/wiki/Termux:API  →  pkg install termux-api

function isTermux() {
  return process.env.TERMUX_VERSION !== undefined ||
    (process.env.PREFIX || '').includes('com.termux') ||
    require('fs').existsSync('/data/data/com.termux')
}

function freqToChannel(freq) {
  if (freq === 2484) return 14
  if (freq >= 2412 && freq <= 2472) return Math.round((freq - 2407) / 5)
  if (freq >= 5160 && freq <= 5885) return Math.round((freq - 5000) / 5)
  if (freq >= 5955) return Math.round((freq - 5950) / 5) + 1  // 6 GHz band
  return 0
}

function scanAndroid() {
  const raw = execSync('termux-wifi-scaninfo', { encoding: 'utf8', timeout: 12000 })
  const nets = JSON.parse(raw)
  if (!Array.isArray(nets)) throw new Error('termux-wifi-scaninfo returned unexpected data')
  return nets
    .map(n => {
      const channel = freqToChannel(n.frequency || 0)
      if (!channel) return null
      const band = n.frequency < 3000 ? '2.4' : n.frequency < 5950 ? '5' : '6'
      const caps = (n.capabilities || '')
      const security = caps.includes('WPA3') ? 'WPA3' :
                       caps.includes('WPA2') ? 'WPA2' :
                       caps.includes('WPA')  ? 'WPA'  : 'Open'
      return {
        ssid: n.ssid || 'Hidden',
        bssid: n.bssid,
        signal: n.level,
        channel,
        band,
        width: band === '2.4' ? 20 : 80,
        security,
      }
    })
    .filter(Boolean)
}

function scan() {
  if (isTermux()) return scanAndroid()
  if (process.platform === 'win32') return scanWindows()
  if (process.platform === 'darwin') return scanMac()
  return scanLinux()
}

// ── Device scanner ────────────────────────────────────────────────────────────

const SCAN_PORTS = [
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

const OUI = {
  '00:50:56': 'VMware', '00:0c:29': 'VMware', '00:05:69': 'VMware',
  'b8:27:eb': 'Raspberry Pi', 'dc:a6:32': 'Raspberry Pi', 'e4:5f:01': 'Raspberry Pi', '28:cd:c1': 'Raspberry Pi',
  '00:1a:11': 'Google', 'f4:f5:d8': 'Google', 'a4:77:33': 'Google',
  '00:03:93': 'Apple', '00:1b:63': 'Apple', '00:1c:b3': 'Apple', '00:1d:4f': 'Apple',
  'c8:69:cd': 'Apple', 'd4:61:9d': 'Apple', 'f0:18:98': 'Apple', '00:26:bb': 'Apple',
  'a4:5e:60': 'Apple', '40:d3:2d': 'Apple', 'ac:bc:32': 'Apple', 'a8:51:ab': 'Apple',
  '00:17:c4': 'D-Link', '00:1b:11': 'D-Link', '00:22:b0': 'D-Link', '00:24:01': 'D-Link',
  '00:14:d1': 'TP-Link', 'e8:de:27': 'TP-Link', '50:c7:bf': 'TP-Link', 'ac:15:a2': 'TP-Link',
  'c8:3a:35': 'TP-Link', '54:a7:03': 'TP-Link',
  '20:0c:c8': 'Netgear', '00:14:6c': 'Netgear', 'c4:3d:c7': 'Netgear', '9c:d3:6d': 'Netgear',
  '1c:1b:0d': 'Netgear', 'a0:21:b7': 'Netgear',
  '00:1a:70': 'Cisco', '00:0d:ec': 'Cisco', '00:0f:23': 'Cisco', '00:60:70': 'Cisco',
  '00:90:ab': 'Cisco', 'fc:fb:fb': 'Cisco', 'b0:aa:77': 'Cisco', '70:ca:9b': 'Cisco',
  '00:23:ae': 'Ubiquiti', '04:18:d6': 'Ubiquiti', '24:a4:3c': 'Ubiquiti', '44:d9:e7': 'Ubiquiti',
  '68:72:51': 'Ubiquiti', '78:8a:20': 'Ubiquiti', '80:2a:a8': 'Ubiquiti', 'b4:fb:e4': 'Ubiquiti',
  'dc:9f:db': 'Ubiquiti', 'f0:9f:c2': 'Ubiquiti', '18:e8:29': 'Ubiquiti',
  '00:23:24': 'Huawei', '00:e0:fc': 'Huawei', '00:18:82': 'Huawei', '48:00:31': 'Huawei',
  '54:89:98': 'Huawei', '4c:1f:cc': 'Huawei', '70:72:cf': 'Huawei',
  '00:1d:0f': 'Samsung', '50:01:bb': 'Samsung', '60:a1:0a': 'Samsung', '90:18:7c': 'Samsung',
  'b4:3a:28': 'Samsung', 'f4:7b:5e': 'Samsung', '8c:71:f8': 'Samsung',
  '28:6c:07': 'Xiaomi', '34:ce:00': 'Xiaomi', '64:09:80': 'Xiaomi',
  '78:02:f8': 'Xiaomi', 'ac:f7:f3': 'Xiaomi', 'f8:a4:5f': 'Xiaomi', '58:44:98': 'Xiaomi',
  '44:65:0d': 'Amazon', '68:37:e9': 'Amazon', '74:c2:46': 'Amazon',
  'a0:02:dc': 'Amazon', 'fc:a6:67': 'Amazon', '84:d6:d0': 'Amazon', '34:d2:70': 'Amazon',
  '00:1e:c9': 'Dell', '00:21:9b': 'Dell', 'f8:db:88': 'Dell',
  '3c:d9:2b': 'HP', '00:1e:0b': 'HP', 'b4:99:ba': 'HP',
  '00:1a:4b': 'Intel', '8c:8d:28': 'Intel', 'ac:fd:ce': 'Intel',
  '00:1e:8c': 'ASUSTeK', '10:bf:48': 'ASUSTeK', '2c:56:dc': 'ASUSTeK',
  '00:90:a9': 'Western Digital', '00:26:b9': 'Western Digital',
  '00:30:48': 'Supermicro', '0c:c4:7a': 'Supermicro',
  '00:04:96': 'Extreme Networks',
  '00:1e:2a': 'Netgear',
}

function lookupVendor(mac) {
  if (!mac) return null
  const prefix = mac.toLowerCase().slice(0, 8)
  return OUI[prefix] || null
}

function tcpProbe(host, port, timeout) {
  timeout = timeout || 600
  return new Promise(resolve => {
    const sock = new net.Socket()
    let done = false
    const finish = (open) => {
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

async function parallelBatch(items, fn, concurrency) {
  const results = []
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency)
    const batchRes = await Promise.all(batch.map(fn))
    results.push(...batchRes)
  }
  return results
}

function deviceRiskLevel(openPorts) {
  if (!openPorts.length) return 'none'
  if (openPorts.some(p => p.risk === 'critical')) return 'critical'
  if (openPorts.some(p => p.risk === 'high')) return 'high'
  if (openPorts.some(p => p.risk === 'medium')) return 'medium'
  return 'low'
}

function isPrivateIp(ip) {
  const parts = ip.split('.').map(Number)
  const [a, b] = parts
  if (parts.length !== 4 || parts.some(isNaN)) return false
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

function getArpHosts(rangeCheck) {
  const inRange = (ip) => !rangeCheck || rangeCheck(ip)
  const ips = new Map()
  try {
    let out
    if (process.platform === 'win32') {
      out = execSync('arp -a', { encoding: 'utf8', timeout: 5000 })
      for (const line of out.split('\n')) {
        const m = line.match(/\s+([\d.]+)\s+([\da-f]{2}[-][\da-f]{2}[-][\da-f]{2}[-][\da-f]{2}[-][\da-f]{2}[-][\da-f]{2})\s+/i)
        if (m && isPrivateIp(m[1]) && inRange(m[1]))
          ips.set(m[1], m[2].replace(/-/g, ':').toLowerCase())
      }
    } else if (process.platform === 'darwin') {
      out = execSync('arp -a 2>/dev/null', { encoding: 'utf8', timeout: 5000 })
      for (const line of out.split('\n')) {
        const m = line.match(/\(([^)]+)\)\s+at\s+([\da-f:]{17})/i)
        if (m && m[2] !== 'ff:ff:ff:ff:ff:ff' && isPrivateIp(m[1]) && inRange(m[1]))
          ips.set(m[1], m[2].toLowerCase())
      }
    } else {
      try {
        out = execSync('ip neigh show 2>/dev/null', { encoding: 'utf8', timeout: 5000 })
        for (const line of out.split('\n')) {
          const m = line.match(/^([\d.]+)\s+\S+\s+\S+\s+([\da-f:]{17})/i)
          if (m && isPrivateIp(m[1]) && inRange(m[1]))
            ips.set(m[1], m[2].toLowerCase())
        }
      } catch (_) {
        try {
          out = execSync('arp -n 2>/dev/null', { encoding: 'utf8', timeout: 5000 })
          for (const line of out.split('\n').slice(1)) {
            const p = line.trim().split(/\s+/)
            if (p.length >= 3 && p[2] && p[2].includes(':') && p[2] !== '(incomplete)' && isPrivateIp(p[0]) && inRange(p[0]))
              ips.set(p[0], p[2].toLowerCase())
          }
        } catch (_2) {}
      }
    }
  } catch (_) {}
  return ips
}

function ipToInt(ip) {
  const [a, b, c, d] = ip.split('.').map(Number)
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0
}

function intToIp(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
}

function netmaskToPrefixLen(netmask) {
  return netmask.split('.').map(Number).reduce((acc, octet) => acc + octet.toString(2).split('1').length - 1, 0)
}

function getLocalSubnet(preferSubnet) {
  const os = require('os')
  const ifaces = os.networkInterfaces()
  const candidates = []
  for (const name of Object.keys(ifaces)) {
    for (const iface of (ifaces[name] || [])) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const parts = iface.address.split('.').map(Number)
        const [a, b] = parts
        if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
          const prefixLen = netmaskToPrefixLen(iface.netmask)
          const ipInt = ipToInt(iface.address)
          const maskInt = prefixLen === 0 ? 0 : (0xffffffff << (32 - prefixLen)) >>> 0
          const network = (ipInt & maskInt) >>> 0
          const broadcast = (network | (~maskInt >>> 0)) >>> 0
          candidates.push({ subnet: `${parts[0]}.${parts[1]}.${parts[2]}`, localIp: iface.address, network, broadcast, prefixLen })
        }
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

async function isHostOnline(ip) {
  // Portas comuns em dispositivos + roteadores (inclui 53, 8888, 7547 que roteadores usam)
  const PROBE_PORTS = [80, 443, 22, 8080, 8443, 21, 23, 3389, 53, 8888, 7547, 8181, 8000]
  const results = await Promise.all(PROBE_PORTS.map(port => tcpProbe(ip, port, 500)))
  return results.some(Boolean)
}

async function discoverSubnet(info, arpHosts, onFound, onProbing) {
  // hosts utilizáveis: entre rede+1 e broadcast-1 (cobre /24, /25, /26... corretamente)
  const firstHost = info.network + 1
  const lastHost = info.broadcast - 1
  const allIps = []
  for (let n = firstHost; n <= lastHost; n++) allIps.push(intToIp(n))

  const gateway = intToIp(firstHost)
  if (!arpHosts.has(gateway)) arpHosts.set(gateway, null)

  let probed = 0
  await parallelBatch(allIps, async (ip) => {
    onProbing && onProbing(ip, ++probed, allIps.length)
    if (arpHosts.has(ip)) return
    if (await isHostOnline(ip)) onFound(ip)
  }, 30)
}

async function scanDevicePorts(host) {
  const open = []
  await parallelBatch(SCAN_PORTS, async (portDef) => {
    if (await tcpProbe(host, portDef.port, 700)) {
      open.push({ port: portDef.port, service: portDef.service, risk: portDef.risk })
    }
  }, 10)
  open.sort((a, b) => a.port - b.port)
  return open
}

async function handleDevices(req, res) {
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson',
    'Transfer-Encoding': 'chunked',
    'Cache-Control': 'no-cache, no-store',
  })

  const ndjson = (obj) => {
    try { res.write(JSON.stringify(obj) + '\n') } catch (_) {}
  }
  const t0 = Date.now()

  ndjson({ type: 'start' })

  // Respeita ?subnet= enviado pela UI (ex: 192.168.100)
  const reqUrl = new URL(req.url, 'http://localhost')
  const preferSubnet = reqUrl.searchParams.get('subnet') || undefined
  const subnetInfo = getLocalSubnet(preferSubnet)
  // checa pelo range real da rede (network..broadcast) — necessario p/ /23 ou maiores,
  // onde a rede cobre mais de um terceiro octeto (ex: 10.10.0.x e 10.10.1.x)
  const inSubnetRange = subnetInfo
    ? (ip) => { const n = ipToInt(ip); return n >= subnetInfo.network && n <= subnetInfo.broadcast }
    : null
  const arpHosts = getArpHosts(inSubnetRange)

  if (subnetInfo) {
    const totalHosts = subnetInfo.broadcast - subnetInfo.network - 1
    ndjson({
      type: 'progress',
      message: `Varrendo ${intToIp(subnetInfo.network)}/${subnetInfo.prefixLen} (isso pode levar alguns segundos)...`,
      subnet: subnetInfo.subnet,
      total: totalHosts,
    })
    await discoverSubnet(
      subnetInfo,
      arpHosts,
      (ip) => { if (!arpHosts.has(ip)) arpHosts.set(ip, null) },
      (ip, index, total) => { ndjson({ type: 'scanning', ip, index, total }) },
    )
  }

  // Filtro final: apenas IPs do range real da rede, sem broadcast nem multicast
  const hosts = [...arpHosts.entries()].filter(([ip]) => {
    if (!inSubnetRange || !inSubnetRange(ip)) return false
    const last = parseInt(ip.split('.')[3])
    if (last === 0 || last === 255) return false
    const first = parseInt(ip.split('.')[0])
    if (first >= 224) return false
    return true
  })
  ndjson({ type: 'hosts', count: hosts.length })

  let count = 0
  await parallelBatch(hosts, async ([ip, mac]) => {
    const openPorts = await scanDevicePorts(ip)
    const vendor = lookupVendor(mac)
    const riskLevel = deviceRiskLevel(openPorts)
    count++
    ndjson({ type: 'device', device: { ip, mac, vendor, hostname: null, openPorts, riskLevel } })
  }, 5)

  ndjson({ type: 'done', count, elapsed: Date.now() - t0 })
  try { res.end() } catch (_) {}
}

// ── HTTP Server ───────────────────────────────────────────────────────────────

function cors(req, res) {
  const origin = req.headers.origin || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  // Chrome Private Network Access — permite que páginas HTTPS acessem localhost
  res.setHeader('Access-Control-Allow-Private-Network', 'true')
}

function json(res, data, status) {
  status = status || 200
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

const server = http.createServer((req, res) => {
  cors(req, res)

  // Preflight CORS
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = (req.url || '').split('?')[0]

  // Verificação de disponibilidade
  if (url === '/ping') {
    json(res, { ready: true, platform: process.platform, version: '1.1' })
    return
  }

  // Scan WiFi
  if (url === '/scan') {
    try {
      const networks = scan()
      const connected = getConnectedNetwork()
      json(res, { networks, connectedBssid: connected?.bssid ?? null, platform: process.platform })
    } catch (e) {
      json(res, { error: e.message, networks: [] }, 500)
    }
    return
  }

  // Network interfaces
  if (url === '/interfaces') {
    const os = require('os')
    const ifaces = os.networkInterfaces()
    const result = []
    for (const [name, addrs] of Object.entries(ifaces)) {
      for (const iface of (addrs ?? [])) {
        if (iface.family !== 'IPv4' || iface.internal) continue
        const parts = iface.address.split('.').map(Number)
        const [a, b] = parts
        const isPrivate = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
        if (!isPrivate) continue
        result.push({ name, address: iface.address, subnet: `${parts[0]}.${parts[1]}.${parts[2]}`, netmask: iface.netmask, mac: iface.mac })
      }
    }
    json(res, { interfaces: result })
    return
  }

  // ARP rápido — só tabela ARP, sem port scan (para monitoramento contínuo)
  if (url === '/arp') {
    try {
      const reqUrl = new URL(req.url, 'http://localhost')
      const preferSubnet = reqUrl.searchParams.get('subnet') || undefined
      const subnetInfo = getLocalSubnet(preferSubnet)
      const inSubnetRange = subnetInfo
        ? (ip) => { const n = ipToInt(ip); return n >= subnetInfo.network && n <= subnetInfo.broadcast }
        : null
      const arpHosts = getArpHosts(inSubnetRange)
      const hosts = [...arpHosts.entries()]
        .filter(([ip]) => {
          if (!inSubnetRange || !inSubnetRange(ip)) return false
          const last = parseInt(ip.split('.')[3])
          return last !== 0 && last !== 255
        })
        .map(([ip, mac]) => ({ ip, mac }))
      json(res, { hosts, ts: Date.now() })
    } catch (e) {
      json(res, { error: e.message, hosts: [] }, 500)
    }
    return
  }

  // Scan de dispositivos (NDJSON streaming)
  if (url === '/devices') {
    handleDevices(req, res)
    return
  }

  res.writeHead(404)
  res.end('Not found')
})

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n✗ Porta ${PORT} já está em uso.`)
    console.error(`  Tente: node wifi-agent.js ${PORT + 1}\n`)
  } else {
    console.error('\n✗ Erro ao iniciar agente:', e.message, '\n')
  }
  process.exit(1)
})

server.listen(PORT, '127.0.0.1', () => {
  const termux = isTermux()
  const platform = termux ? 'Android (Termux)'
    : { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[process.platform] || process.platform
  console.log(`\n╔════════════════════════════════════════════╗`)
  console.log(`║  MySpeed WiFi Agent — ${platform.padEnd(20)}║`)
  console.log(`╠════════════════════════════════════════════╣`)
  console.log(`║  Escutando em: http://localhost:${PORT}      ║`)
  console.log(`║  Pressione Ctrl+C para encerrar            ║`)
  console.log(`╚════════════════════════════════════════════╝`)
  if (termux) {
    console.log(`\n  Abra o Chrome no mesmo celular e acesse`)
    console.log(`  o MySpeed — o agente será detectado`)
    console.log(`\n  Certifique-se que o Termux:API está instalado`)
    console.log(`  e as permissões de localização concedidas\n`)
  } else {
    console.log(`\n  Abra o MySpeed no navegador e vá para`)
    console.log(`  a aba WiFi ou Dispositivos — o agente será detectado\n`)
  }
})
