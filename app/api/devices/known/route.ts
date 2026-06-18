import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'

export const runtime = 'nodejs'

export async function GET() {
  const rows = db.prepare('SELECT * FROM known_devices ORDER BY last_seen DESC').all()
  return NextResponse.json({ rows })
}

export async function POST(req: NextRequest) {
  const { mac, label, trusted } = await req.json()
  if (!mac) return NextResponse.json({ error: 'mac required' }, { status: 400 })
  db.prepare(`
    UPDATE known_devices SET label = COALESCE(?, label), trusted = COALESCE(?, trusted) WHERE mac = ?
  `).run(label ?? null, trusted ?? null, mac.toLowerCase())
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const mac = req.nextUrl.searchParams.get('mac')
  if (mac) {
    db.prepare('DELETE FROM known_devices WHERE mac = ?').run(mac.toLowerCase())
  } else {
    db.prepare('DELETE FROM known_devices').run()
  }
  return NextResponse.json({ ok: true })
}
