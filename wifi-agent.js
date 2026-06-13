#!/usr/bin/env node
'use strict'
/**
 * MySpeed WiFi Agent — rode localmente para habilitar scan real de WiFi.
 *
 * Uso:
 *   node wifi-agent.js          # porta padrão 7474
 *   node wifi-agent.js 8888     # porta personalizada
 *
 * Não precisa de npm install — usa apenas módulos nativos do Node.js.
 */

const http = require('http')
const { execSync } = require('child_process')

const PORT = parseInt(process.argv[2] || '7474', 10)

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Platform scanners ─────────────────────────────────────────────────────────

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

function scan() {
  if (process.platform === 'win32') return scanWindows()
  if (process.platform === 'darwin') return scanMac()
  return scanLinux()
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

function json(res, data, status = 200) {
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
    json(res, { ready: true, platform: process.platform, version: '1.0' })
    return
  }

  // Scan WiFi
  if (url === '/scan') {
    try {
      const networks = scan()
      json(res, { networks, platform: process.platform })
    } catch (e) {
      json(res, { error: e.message, networks: [] }, 500)
    }
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
  const platform = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[process.platform] || process.platform
  console.log(`\n╔════════════════════════════════════════════╗`)
  console.log(`║     MySpeed WiFi Agent — ${platform.padEnd(18)}║`)
  console.log(`╠════════════════════════════════════════════╣`)
  console.log(`║  Escutando em: http://localhost:${PORT}      ║`)
  console.log(`║  Pressione Ctrl+C para encerrar            ║`)
  console.log(`╚════════════════════════════════════════════╝`)
  console.log(`\n  Abra o MySpeed no navegador e vá para`)
  console.log(`  a aba WiFi — o agente será detectado\n`)
})
