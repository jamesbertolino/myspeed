import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? 5), 20)
  const rows = db.prepare('SELECT * FROM device_scan_snapshots ORDER BY ts DESC LIMIT ?').all(limit)
  return NextResponse.json({ rows })
}

export async function POST(req: NextRequest) {
  const { subnet, devices } = await req.json()
  if (!Array.isArray(devices)) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const result = db.prepare(`
    INSERT INTO device_scan_snapshots (ts, subnet, device_count, devices_json)
    VALUES (?, ?, ?, ?)
  `).run(Date.now(), subnet ?? null, devices.length, JSON.stringify(devices))
  // keep only last 20 snapshots
  db.prepare('DELETE FROM device_scan_snapshots WHERE id NOT IN (SELECT id FROM device_scan_snapshots ORDER BY ts DESC LIMIT 20)').run()
  return NextResponse.json({ id: result.lastInsertRowid })
}

export async function DELETE() {
  db.prepare('DELETE FROM device_scan_snapshots').run()
  return NextResponse.json({ ok: true })
}
