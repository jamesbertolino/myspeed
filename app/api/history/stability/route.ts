import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const days = Math.min(Number(req.nextUrl.searchParams.get('days') ?? 7), 30)
  const since = Date.now() - days * 86_400_000

  // Group ping samples by hour-of-day (0–23) and by calendar day
  const rows = db.prepare(`
    SELECT ts, ms FROM ping_history WHERE ts >= ? ORDER BY ts ASC
  `).all(since) as { ts: number; ms: number }[]

  // Hourly averages (hour 0–23 across all days)
  const byHour: Record<number, number[]> = {}
  // Daily averages (date string → avg ms)
  const byDay: Record<string, number[]> = {}

  for (const r of rows) {
    const d = new Date(r.ts)
    const h = d.getHours()
    const day = d.toISOString().slice(0, 10)
    ;(byHour[h] ??= []).push(r.ms)
    ;(byDay[day] ??= []).push(r.ms)
  }

  const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null

  const hourly = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    avgMs: avg(byHour[h] ?? []),
    count: (byHour[h] ?? []).length,
  }))

  const daily = Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, arr]) => ({
      day,
      avgMs: avg(arr),
      maxMs: Math.max(...arr),
      minMs: Math.min(...arr),
      count: arr.length,
      p95Ms: arr.length ? arr.sort((a, b) => a - b)[Math.floor(arr.length * 0.95)] : null,
    }))

  return NextResponse.json({ hourly, daily, total: rows.length, days })
}
