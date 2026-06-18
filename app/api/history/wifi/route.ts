import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const limit  = Math.min(Number(req.nextUrl.searchParams.get('limit')  ?? 200), 1000)
  const offset = Number(req.nextUrl.searchParams.get('offset') ?? 0)

  const rows = db.prepare(`
    SELECT id, ts, band24_ch, band24_score, band24_rec,
           band5_ch, band5_score, band5_rec, net_count, networks_json
    FROM wifi_scan_history
    ORDER BY ts DESC LIMIT ? OFFSET ?
  `).all(limit, offset)

  const total = (db.prepare('SELECT COUNT(*) as n FROM wifi_scan_history').get() as { n: number }).n

  return NextResponse.json({ total, rows })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const {
    band24_ch, band24_score, band24_rec,
    band5_ch,  band5_score,  band5_rec,
    networks,
  } = body

  const net_count     = Array.isArray(networks) ? networks.length : 0
  const networks_json = networks ? JSON.stringify(networks) : null

  const result = db.prepare(`
    INSERT INTO wifi_scan_history
      (ts, band24_ch, band24_score, band24_rec, band5_ch, band5_score, band5_rec, net_count, networks_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    Date.now(),
    band24_ch  ?? null, band24_score ?? null, band24_rec  ?? null,
    band5_ch   ?? null, band5_score  ?? null, band5_rec   ?? null,
    net_count, networks_json,
  )

  return NextResponse.json({ id: result.lastInsertRowid })
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (id) {
    db.prepare('DELETE FROM wifi_scan_history WHERE id = ?').run(Number(id))
  } else {
    db.prepare('DELETE FROM wifi_scan_history').run()
  }
  return NextResponse.json({ ok: true })
}
