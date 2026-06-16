import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const limit  = Math.min(Number(req.nextUrl.searchParams.get('limit')  ?? 100), 500)
  const offset = Number(req.nextUrl.searchParams.get('offset') ?? 0)

  const rows = db.prepare(`
    SELECT * FROM speedtest_history ORDER BY ts DESC LIMIT ? OFFSET ?
  `).all(limit, offset)

  const total = (db.prepare('SELECT COUNT(*) as n FROM speedtest_history').get() as { n: number }).n

  return NextResponse.json({ total, rows })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { ping, jitter, download, upload, server, isp, ip } = body

  if (!ping || !download || !upload) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 })
  }

  const { auto } = body
  const result = db.prepare(`
    INSERT INTO speedtest_history (ts, ping, jitter, download, upload, server, isp, ip, auto)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(Date.now(), ping, jitter ?? 0, download, upload, server ?? null, isp ?? null, ip ?? null, auto ? 1 : 0)

  return NextResponse.json({ id: result.lastInsertRowid })
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (id) {
    db.prepare('DELETE FROM speedtest_history WHERE id = ?').run(Number(id))
  } else {
    db.prepare('DELETE FROM speedtest_history').run()
  }
  return NextResponse.json({ ok: true })
}
