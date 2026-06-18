import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'

export const runtime = 'nodejs'

interface AndroidReport {
  device_id: string
  device_name?: string
  model?: string
  android_ver?: string
  wifi?: {
    ssid?: string
    bssid?: string
    rssi?: number
    frequency?: number
    link_speed?: number
  }
  ip_address?: string
  ping_ms?: number
  battery?: {
    percentage?: number
    is_charging?: boolean
  }
  extra?: Record<string, unknown>
}

const upsertDevice = db.prepare(`
  INSERT INTO android_devices (device_id, device_name, model, android_ver, last_seen)
  VALUES (@device_id, @device_name, @model, @android_ver, @last_seen)
  ON CONFLICT(device_id) DO UPDATE SET
    device_name = excluded.device_name,
    model       = excluded.model,
    android_ver = excluded.android_ver,
    last_seen   = excluded.last_seen
`)

const insertReport = db.prepare(`
  INSERT INTO android_reports
    (ts, device_id, wifi_ssid, wifi_bssid, wifi_rssi, wifi_freq, wifi_speed,
     ip_address, ping_ms, battery_pct, battery_chg, extra)
  VALUES
    (@ts, @device_id, @wifi_ssid, @wifi_bssid, @wifi_rssi, @wifi_freq, @wifi_speed,
     @ip_address, @ping_ms, @battery_pct, @battery_chg, @extra)
`)

export async function POST(req: NextRequest) {
  let body: AndroidReport
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.device_id) {
    return NextResponse.json({ error: 'device_id required' }, { status: 400 })
  }

  const now = Math.floor(Date.now() / 1000)

  db.transaction(() => {
    upsertDevice.run({
      device_id:   body.device_id,
      device_name: body.device_name ?? null,
      model:       body.model ?? null,
      android_ver: body.android_ver ?? null,
      last_seen:   now,
    })
    insertReport.run({
      ts:          now,
      device_id:   body.device_id,
      wifi_ssid:   body.wifi?.ssid   ?? null,
      wifi_bssid:  body.wifi?.bssid  ?? null,
      wifi_rssi:   body.wifi?.rssi   ?? null,
      wifi_freq:   body.wifi?.frequency  ?? null,
      wifi_speed:  body.wifi?.link_speed ?? null,
      ip_address:  body.ip_address ?? null,
      ping_ms:     body.ping_ms    ?? null,
      battery_pct: body.battery?.percentage  ?? null,
      battery_chg: body.battery?.is_charging ? 1 : 0,
      extra:       body.extra ? JSON.stringify(body.extra) : null,
    })
  })()

  return NextResponse.json({ ok: true, ts: now })
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const deviceId = searchParams.get('device_id')
  const limit    = Math.min(parseInt(searchParams.get('limit') ?? '100', 10), 1000)

  if (deviceId) {
    const device  = db.prepare('SELECT * FROM android_devices WHERE device_id = ?').get(deviceId)
    const reports = db.prepare(
      'SELECT * FROM android_reports WHERE device_id = ? ORDER BY ts DESC LIMIT ?'
    ).all(deviceId, limit)
    return NextResponse.json({ device, reports })
  }

  const devices = db.prepare(
    'SELECT * FROM android_devices ORDER BY last_seen DESC'
  ).all()
  return NextResponse.json({ devices })
}
