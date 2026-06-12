#!/usr/bin/env node
'use strict'

const { execSync } = require('child_process')
const fs = require('fs')

// ── Native Messaging protocol ────────────────────────────────────────────────

function readStdin() {
  const lenBuf = Buffer.alloc(4)
  let n = 0
  while (n < 4) n += fs.readSync(0, lenBuf, n, 4 - n, null)
  const len = lenBuf.readUInt32LE(0)
  const body = Buffer.alloc(len)
  let m = 0
  while (m < len) m += fs.readSync(0, body, m, len - m, null)
  return JSON.parse(body.toString('utf8'))
}

function writeStdout(obj) {
  const json = JSON.stringify(obj)
  const buf = Buffer.alloc(4 + Buffer.byteLength(json))
  buf.writeUInt32LE(Buffer.byteLength(json), 0)
  buf.write(json, 4, 'utf8')
  process.stdout.write(buf)
}

// ── WiFi scanning ────────────────────────────────────────────────────────────

function extractField(lines, ...patterns) {
  for (const line of lines) {
    for (const pattern of patterns) {
      const m = line.match(pattern)
      if (m) return m[1]?.trim()
    }
  }
}

function signalPctToDbm(pct) {
  return Math.round((pct / 2) - 100)
}

function channelToBand(ch) {
  return ch > 14 ? '5' : '2.4'
}

function radioTypeToWidth(rt) {
  rt = (rt || '').toLowerCase()
  if (rt.includes('ax') || rt.includes('ac')) return 80
  if (rt.includes('n')) return 40
  return 20
}

// PowerShell script that uses the Windows Runtime WiFiAdapter API.
// This does a real active scan and returns ALL visible networks — not just the connected one.
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

function phyToWidth(phy) {
  const p = (phy || '').toLowerCase()
  if (p === 'he') return 80   // 802.11ax Wi-Fi 6
  if (p === 'vht') return 80  // 802.11ac
  if (p === 'ht') return 40   // 802.11n
  return 20
}

function scanWindowsWinRT() {
  const os = require('os')
  const path = require('path')
  const psFile = path.join(os.tmpdir(), 'myspeed-wifiscan.ps1')
  require('fs').writeFileSync(psFile, WINRT_SCAN_PS1, 'utf8')

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
  // Prefer WinRT scan (all visible networks, active scan)
  try {
    const networks = scanWindowsWinRT()
    if (networks.length > 0) return networks
  } catch (_) { /* fall through to netsh */ }

  // Fallback: netsh (may only return the connected network on some systems)
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
    const signal = rssiRaw ? parseInt(rssiRaw) : signalPctRaw ? signalPctToDbm(parseInt(signalPctRaw)) : -70
    if (ssid && channel) networks.push({ ssid, channel, signal, band: channelToBand(channel), width: radioTypeToWidth(radioType), security: auth, bssid })
  } catch (_) {}
  return networks
}

function scanLinux() {
  const out = execSync(
    "nmcli -t -f SSID,BSSID,CHAN,SIGNAL,SECURITY dev wifi list",
    { encoding: 'utf8', timeout: 5000 }
  )
  return out.trim().split('\n').filter(Boolean).map(line => {
    const parts = line.split(':')
    const ssid = parts[0] || 'Hidden'
    const bssid = parts.slice(1, 7).join(':')
    const channel = parseInt(parts[7]) || 6
    const pct = parseInt(parts[8]) || 50
    const security = parts[9] || 'Open'
    return { ssid, bssid, channel, signal: signalPctToDbm(pct),
      band: channelToBand(channel), width: channel > 14 ? 80 : 20, security }
  })
}

function scanMac() {
  const ap = '/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport'
  const out = execSync(`${ap} -s`, { encoding: 'utf8', timeout: 5000 })
  return out.trim().split('\n').slice(1).filter(Boolean).map(line => {
    const p = line.trim().split(/\s+/)
    const channel = parseInt(p[3]?.split(',')[0]) || 6
    return { ssid: p[0] || 'Hidden', bssid: p[1], signal: parseInt(p[2]) || -70,
      channel, band: channelToBand(channel), width: 20 }
  })
}

// ── Main ─────────────────────────────────────────────────────────────────────

try {
  const msg = readStdin()
  if (msg.action === 'scan') {
    let networks = []
    try {
      if (process.platform === 'win32') networks = scanWindows()
      else if (process.platform === 'darwin') networks = scanMac()
      else networks = scanLinux()
    } catch (e) {
      writeStdout({ error: e.message, networks: [] })
      process.exit(0)
    }
    writeStdout({ networks, platform: process.platform })
  } else {
    writeStdout({ error: 'unknown action', networks: [] })
  }
} catch (e) {
  writeStdout({ error: e.message, networks: [] })
}
process.exit(0)
