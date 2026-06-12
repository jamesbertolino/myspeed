import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import { writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const execAsync = promisify(exec)

interface WiFiNetwork {
  ssid: string
  channel: number
  signal: number
  band: '2.4' | '5'
  width: 20 | 40 | 80 | 160
  security?: string
  bssid?: string
}

function signalPctToDbm(pct: number): number {
  return Math.round((pct / 2) - 100)
}

function channelToBand(channel: number): '2.4' | '5' {
  return channel > 14 ? '5' : '2.4'
}

function radioTypeToWidth(radioType: string): 20 | 40 | 80 | 160 {
  if (radioType.includes('ac') || radioType.includes('ax')) return 80
  if (radioType.includes('n')) return 40
  return 20
}

function phyToWidth(phy: string): 20 | 40 | 80 | 160 {
  const p = phy.toLowerCase()
  if (p === 'he') return 80
  if (p === 'vht') return 80
  if (p === 'ht') return 40
  return 20
}

const WINRT_SCAN_PS1 = String.raw`
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Devices.WiFi.WiFiAdapter,Windows.Devices.WiFi,ContentType=WindowsRuntime]
$null = [Windows.Devices.Enumeration.DeviceInformation,Windows.Devices.Enumeration,ContentType=WindowsRuntime]

function AwaitOp($Task, $T) {
  $methods = [System.WindowsRuntimeSystemExtensions].GetMethods('Public,Static') |
    Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 }
  foreach ($m in $methods) {
    try { $net = $m.MakeGenericMethod($T).Invoke($null, @($Task)); $net.Wait(-1)|Out-Null; return $net.Result } catch {}
  }
}
function AwaitAction($Task) {
  $methods = [System.WindowsRuntimeSystemExtensions].GetMethods('Public,Static') |
    Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType.Name -notlike 'IAsyncOperation*' }
  foreach ($m in $methods) {
    try { $net = $m.Invoke($null, @($Task)); if ($net) { $net.Wait(-1)|Out-Null; return } } catch {}
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
  $ch = if ($b -eq '2.4') { [int](($f-2412)/5)+1 } else { [int](($f-5180)/5)+36 }
  [PSCustomObject]@{ ssid=$_.Ssid; bssid=$_.Bssid; signal=[int]$_.NetworkRssiInDecibelMilliwatts; channel=$ch; band=$b; phy=$_.PhyKind.ToString() }
}
$result | ConvertTo-Json -Compress
`

async function scanWindowsWinRT(): Promise<WiFiNetwork[]> {
  const psFile = join(tmpdir(), 'myspeed-wifiscan.ps1')
  writeFileSync(psFile, WINRT_SCAN_PS1, 'utf8')
  const { stdout } = await execAsync(
    `powershell -NoProfile -ExecutionPolicy Bypass -File "${psFile}"`,
    { encoding: 'utf8', timeout: 15000 }
  )
  const raw = stdout.trim()
  if (!raw || raw === '[]') return []
  const parsed = JSON.parse(raw)
  const items: Array<{ ssid: string; bssid: string; signal: number; channel: number; band: '2.4' | '5'; phy: string }> =
    Array.isArray(parsed) ? parsed : [parsed]
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

function extractField(lines: string[], ...patterns: RegExp[]): string | undefined {
  for (const line of lines) {
    for (const pattern of patterns) {
      const m = line.match(pattern)
      if (m) return m[1]?.trim()
    }
  }
}

async function scanWindows(): Promise<WiFiNetwork[]> {
  // Prefer WinRT (active scan, all visible networks)
  try {
    const networks = await scanWindowsWinRT()
    if (networks.length > 0) return networks
  } catch { /* fall through */ }

  // Fallback: netsh (may only return the connected network on some systems)
  const networks: WiFiNetwork[] = []

  // Connected network via "show interfaces" — has real RSSI + channel
  try {
    const { stdout: ifOut } = await execAsync('netsh wlan show interfaces', { encoding: 'utf8' })
    const lines = ifOut.split('\n').map(l => l.trim()).filter(Boolean)

    // EN: SSID / PT: SSID
    const ssid = extractField(lines, /^SSID\s*:\s*(?!.*\bBSSID\b)(.+)/i)
    const bssid = extractField(lines, /^(?:AP\s+)?BSSID\s*:\s*(.+)/i)
    // EN: Channel / PT: Canal
    const channelRaw = extractField(lines, /^(?:Channel|Canal)\s*:\s*(\d+)/i)
    // Prefer Rssi (dBm) over Signal (%) when available
    const rssiRaw = extractField(lines, /^Rssi\s*:\s*(-?\d+)/i)
    const signalPctRaw = extractField(lines, /^(?:Signal|Sinal)\s*:\s*(\d+)/i)
    const radioType = extractField(lines,
      /^Radio type\s*:\s*(.+)/i,
      /^Tipo de r[áa]dio\s*:\s*(.+)/i,
    )?.toLowerCase() ?? ''
    const auth = extractField(lines,
      /^Authentication\s*:\s*(.+)/i,
      /^Autenti(?:cação|cacion)\s*:\s*(.+)/i,
    )

    const channel = channelRaw ? parseInt(channelRaw) : 0
    const signal = rssiRaw
      ? parseInt(rssiRaw)
      : signalPctRaw ? signalPctToDbm(parseInt(signalPctRaw)) : -70

    if (ssid && channel) {
      networks.push({
        ssid,
        channel,
        signal,
        band: channelToBand(channel),
        width: radioTypeToWidth(radioType),
        security: auth,
        bssid,
      })
    }
  } catch { /* interface info unavailable */ }

  // 2. All visible networks via "show networks mode=bssid"
  try {
    const { stdout } = await execAsync('netsh wlan show networks mode=bssid', { encoding: 'utf8' })
    const ssidBlocks = stdout.split(/\nSSID \d+\s*:/).slice(1)

    for (const block of ssidBlocks) {
      const lines = block.split('\n').map(l => l.trim()).filter(Boolean)
      const ssid = lines[0] || 'Hidden'

      // Skip if already captured from interfaces
      if (networks.some(n => n.ssid === ssid)) continue

      const auth = extractField(lines,
        /^Authentication\s*:\s*(.+)/i,
        /^Autenti(?:cação|cacion)\s*:\s*(.+)/i,
      )

      // BSSID sub-blocks
      const bssidBlocks = block.split(/BSSID \d+\s*:/).slice(1)

      if (bssidBlocks.length > 0) {
        for (const bssidBlock of bssidBlocks) {
          const blines = bssidBlock.split('\n').map(l => l.trim()).filter(Boolean)
          const bssid = blines[0]

          const signalRaw = extractField(blines, /^(?:Signal|Sinal)\s*:\s*(\d+)/i)
          const channelRaw = extractField(blines, /^(?:Channel|Canal)\s*:\s*(\d+)/i)
          const radioType = extractField(blines,
            /^Radio type\s*:\s*(.+)/i,
            /^Tipo de r[áa]dio\s*:\s*(.+)/i,
          )?.toLowerCase() ?? ''

          const channel = channelRaw ? parseInt(channelRaw) : 0
          if (!channel || isNaN(channel)) continue

          networks.push({
            ssid,
            channel,
            signal: signalRaw ? signalPctToDbm(parseInt(signalRaw)) : -70,
            band: channelToBand(channel),
            width: radioTypeToWidth(radioType),
            security: auth,
            bssid,
          })
        }
      } else {
        // No BSSID block — add SSID-only entry with unknown channel/signal
        // Skip: not enough data to plot on channel map
      }
    }
  } catch { /* scan unavailable */ }

  return networks
}

async function scanLinux(): Promise<WiFiNetwork[]> {
  const { stdout } = await execAsync(
    "nmcli -t -f SSID,BSSID,CHAN,SIGNAL,SECURITY,FREQ dev wifi list",
    { encoding: 'utf8' }
  )

  return stdout.trim().split('\n').filter(Boolean).map(line => {
    const parts = line.split(':')
    const ssid = parts[0] || 'Hidden'
    const bssid = parts.slice(1, 7).join(':')
    const channel = parseInt(parts[7]) || 6
    const signalPct = parseInt(parts[8]) || 50
    const security = parts[9] || 'Open'
    const freq = parts[10] || ''

    const band: '2.4' | '5' = freq.includes('5') ? '5' : '2.4'
    const width: 20 | 40 | 80 | 160 = band === '5' ? 80 : 20

    return {
      ssid,
      bssid,
      channel,
      signal: signalPctToDbm(signalPct),
      band,
      width,
      security,
    }
  })
}

async function scanMac(): Promise<WiFiNetwork[]> {
  const airportPath = '/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport'
  const { stdout } = await execAsync(`${airportPath} -s`, { encoding: 'utf8' })

  const lines = stdout.trim().split('\n').slice(1)

  return lines.filter(Boolean).map(line => {
    const parts = line.trim().split(/\s+/)
    const ssid = parts[0] || 'Hidden'
    const bssid = parts[1] || ''
    const signal = parseInt(parts[2]) || -70
    const channel = parseInt(parts[3]?.split(',')[0]) || 6

    return {
      ssid,
      bssid,
      channel,
      signal,
      band: channelToBand(channel),
      width: 20,
    }
  })
}

export async function GET() {
  const platform = process.platform

  try {
    let networks: WiFiNetwork[]

    if (platform === 'win32') {
      networks = await scanWindows()
    } else if (platform === 'darwin') {
      networks = await scanMac()
    } else {
      networks = await scanLinux()
    }

    return NextResponse.json({ networks, platform })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { error: 'Scan não disponível neste ambiente', detail: msg, networks: [] },
      { status: 503 }
    )
  }
}
