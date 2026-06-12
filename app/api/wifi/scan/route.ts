import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

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

async function scanWindows(): Promise<WiFiNetwork[]> {
  const { stdout } = await execAsync('netsh wlan show networks mode=bssid', { encoding: 'utf8' })
  const networks: WiFiNetwork[] = []

  const blocks = stdout.split(/\nSSID \d+ :/).slice(1)

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim())

    const ssid = lines[0]?.trim() || 'Hidden'
    const auth = lines.find(l => l.startsWith('Authentication'))?.split(':')[1]?.trim()

    const bssidBlocks = block.split(/BSSID \d+\s*:/).slice(1)

    for (const bssidBlock of bssidBlocks) {
      const blines = bssidBlock.split('\n').map(l => l.trim())
      const bssid = blines[0]?.trim()

      const signalLine = blines.find(l => l.startsWith('Signal'))
      const signalPct = signalLine ? parseInt(signalLine.replace(/\D+/g, '')) : 50

      const channelLine = blines.find(l => l.startsWith('Channel'))
      const channel = channelLine ? parseInt(channelLine.split(':')[1]?.trim() || '6') : 6

      const radioLine = blines.find(l => l.startsWith('Radio type'))
      const radioType = radioLine ? radioLine.split(':')[1]?.trim().toLowerCase() : ''

      if (!channel || isNaN(channel)) continue

      networks.push({
        ssid,
        channel,
        signal: signalPctToDbm(signalPct),
        band: channelToBand(channel),
        width: radioTypeToWidth(radioType),
        security: auth,
        bssid,
      })
    }
  }

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
