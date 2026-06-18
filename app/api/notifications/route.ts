import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const since = Number(req.nextUrl.searchParams.get('since') ?? 0)
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? 20), 50)

  const alerts = db.prepare(`
    SELECT ts, type, message FROM alert_log WHERE ts > ? ORDER BY ts DESC LIMIT ?
  `).all(since, limit) as { ts: number; type: string; message: string }[]

  const newDevices = db.prepare(`
    SELECT mac, ip, vendor, first_seen as ts FROM known_devices WHERE first_seen > ? ORDER BY first_seen DESC LIMIT ?
  `).all(since, limit) as { mac: string; ip: string | null; vendor: string | null; ts: number }[]

  const notifications = [
    ...alerts.map(a => ({ ts: a.ts, kind: 'alert' as const, title: a.type.replace('_', ' '), message: a.message })),
    ...newDevices.map(d => ({ ts: d.ts, kind: 'device' as const, title: 'Novo dispositivo', message: `${d.ip ?? d.mac}${d.vendor ? ` — ${d.vendor}` : ''}` })),
  ].sort((a, b) => b.ts - a.ts).slice(0, limit)

  return NextResponse.json({ notifications, total: notifications.length })
}
