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

function scanWindows() {
  const networks = []

  // 1. Currently connected network (has real RSSI)
  try {
    const out = execSync('netsh wlan show interfaces', { encoding: 'utf8', timeout: 5000 })
    const lines = out.split('\n').map(l => l.trim()).filter(Boolean)

    const ssid = extractField(lines, /^SSID\s*:\s*(?!.*BSSID)(.+)/i)
    const bssid = extractField(lines, /^(?:AP\s+)?BSSID\s*:\s*(.+)/i)
    const channelRaw = extractField(lines, /^(?:Channel|Canal)\s*:\s*(\d+)/i)
    const rssiRaw = extractField(lines, /^Rssi\s*:\s*(-?\d+)/i)
    const signalPctRaw = extractField(lines, /^(?:Signal|Sinal)\s*:\s*(\d+)/i)
    const radioType = extractField(lines,
      /^Radio type\s*:\s*(.+)/i,
      /^Tipo de r[áa]dio\s*:\s*(.+)/i,
    ) || ''
    const auth = extractField(lines,
      /^Authentication\s*:\s*(.+)/i,
      /^Autenti[^\s]*\s*:\s*(.+)/i,
    )

    const channel = channelRaw ? parseInt(channelRaw) : 0
    const signal = rssiRaw ? parseInt(rssiRaw)
      : signalPctRaw ? signalPctToDbm(parseInt(signalPctRaw)) : -70

    if (ssid && channel) {
      networks.push({ ssid, channel, signal, band: channelToBand(channel),
        width: radioTypeToWidth(radioType), security: auth, bssid })
    }
  } catch (_) { /* interface unavailable */ }

  // 2. All visible networks
  try {
    const out = execSync('netsh wlan show networks mode=bssid', { encoding: 'utf8', timeout: 5000 })
    const ssidBlocks = out.split(/\nSSID \d+\s*:/).slice(1)

    for (const block of ssidBlocks) {
      const lines = block.split('\n').map(l => l.trim()).filter(Boolean)
      const ssid = lines[0] || 'Hidden'
      if (networks.some(n => n.ssid === ssid)) continue

      const auth = extractField(lines,
        /^Authentication\s*:\s*(.+)/i,
        /^Autenti[^\s]*\s*:\s*(.+)/i,
      )

      const bssidBlocks = block.split(/BSSID \d+\s*:/).slice(1)
      for (const bb of bssidBlocks) {
        const blines = bb.split('\n').map(l => l.trim()).filter(Boolean)
        const bssid = blines[0]
        const signalRaw = extractField(blines, /^(?:Signal|Sinal)\s*:\s*(\d+)/i)
        const channelRaw = extractField(blines, /^(?:Channel|Canal)\s*:\s*(\d+)/i)
        const radioType = extractField(blines,
          /^Radio type\s*:\s*(.+)/i,
          /^Tipo de r[áa]dio\s*:\s*(.+)/i,
        ) || ''
        const channel = channelRaw ? parseInt(channelRaw) : 0
        if (!channel || isNaN(channel)) continue
        networks.push({ ssid, channel,
          signal: signalRaw ? signalPctToDbm(parseInt(signalRaw)) : -70,
          band: channelToBand(channel), width: radioTypeToWidth(radioType),
          security: auth, bssid })
      }
    }
  } catch (_) { /* scan unavailable */ }

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
