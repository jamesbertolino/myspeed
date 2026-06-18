import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { device_id, subnet, hosts, duration_ms } = body

    if (!device_id || !Array.isArray(hosts)) {
      return NextResponse.json({ error: 'device_id and hosts required' }, { status: 400 })
    }

    const now = Math.floor(Date.now() / 1000)

    const insertScan = db.prepare(`
      INSERT INTO android_lan_scans (ts, device_id, subnet, host_count, duration_ms)
      VALUES (@ts, @device_id, @subnet, @host_count, @duration_ms)
    `)
    const insertHost = db.prepare(`
      INSERT INTO android_lan_hosts (scan_id, ip, mac, hostname, latency_ms)
      VALUES (@scan_id, @ip, @mac, @hostname, @latency_ms)
    `)

    let scanId: number | bigint = 0
    db.transaction(() => {
      const r = insertScan.run({
        ts: now, device_id, subnet: subnet ?? null,
        host_count: hosts.length, duration_ms: duration_ms ?? null
      })
      scanId = r.lastInsertRowid
      for (const h of hosts) {
        insertHost.run({
          scan_id: scanId, ip: h.ip,
          mac: h.mac ?? null, hostname: h.hostname ?? null,
          latency_ms: h.latency_ms ?? null
        })
      }
    })()

    return NextResponse.json({ ok: true, scan_id: Number(scanId), ts: now })
  } catch (err) {
    console.error('[android/scan POST]', err)
    return NextResponse.json(
      { error: String(err), detail: err instanceof Error ? err.stack : undefined },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const deviceId = searchParams.get('device_id')
    const scanId   = searchParams.get('scan_id')

    if (scanId) {
      const hosts = db.prepare(
        'SELECT * FROM android_lan_hosts WHERE scan_id = ? ORDER BY ip'
      ).all(scanId)
      return NextResponse.json({ hosts })
    }

    if (deviceId) {
      const scans = db.prepare(
        'SELECT * FROM android_lan_scans WHERE device_id = ? ORDER BY ts DESC LIMIT 10'
      ).all(deviceId) as { id: number }[]
      if (scans.length === 0) return NextResponse.json({ scans: [], hosts: [] })
      const hosts = db.prepare(
        'SELECT * FROM android_lan_hosts WHERE scan_id = ? ORDER BY ip'
      ).all((scans[0] as { id: number }).id)
      return NextResponse.json({ scans, hosts })
    }

    const scans = db.prepare(
      'SELECT * FROM android_lan_scans ORDER BY ts DESC LIMIT 20'
    ).all()
    return NextResponse.json({ scans })
  } catch (err) {
    console.error('[android/scan GET]', err)
    return NextResponse.json(
      { error: String(err), detail: err instanceof Error ? err.stack : undefined },
      { status: 500 }
    )
  }
}
