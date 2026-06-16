import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? 100), 500)
  const rows  = db.prepare('SELECT * FROM alert_log ORDER BY ts DESC LIMIT ?').all(limit)
  const total = (db.prepare('SELECT COUNT(*) as n FROM alert_log').get() as { n: number }).n
  return NextResponse.json({ total, rows })
}

export async function POST(req: NextRequest) {
  const { type, value, threshold, message } = await req.json()
  db.prepare('INSERT INTO alert_log (ts, type, value, threshold, message) VALUES (?, ?, ?, ?, ?)')
    .run(Date.now(), type, value, threshold, message)
  // manter só últimos 30 dias
  db.prepare('DELETE FROM alert_log WHERE ts < ?').run(Date.now() - 30 * 86_400_000)
  return NextResponse.json({ ok: true })
}

export async function DELETE() {
  db.prepare('DELETE FROM alert_log').run()
  return NextResponse.json({ ok: true })
}
