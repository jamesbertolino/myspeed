import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const limit  = Math.min(Number(req.nextUrl.searchParams.get('limit')  ?? 200), 1000)
  const since  = Number(req.nextUrl.searchParams.get('since') ?? 0)

  const rows = db.prepare(`
    SELECT * FROM ping_history WHERE ts > ? ORDER BY ts DESC LIMIT ?
  `).all(since, limit)

  return NextResponse.json({ rows })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { ms, ttl } = body

  if (ms == null || ms < 0) return NextResponse.json({ ok: false })

  db.prepare('INSERT INTO ping_history (ts, ms, ttl) VALUES (?, ?, ?)').run(Date.now(), ms, ttl ?? null)

  // manter só últimas 24h
  db.prepare('DELETE FROM ping_history WHERE ts < ?').run(Date.now() - 86_400_000)

  return NextResponse.json({ ok: true })
}
