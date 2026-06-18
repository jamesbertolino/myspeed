import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const days = Math.min(Number(req.nextUrl.searchParams.get('days') ?? 30), 90)
  const contractedDl = Number(req.nextUrl.searchParams.get('dl') ?? 0)
  const contractedUl = Number(req.nextUrl.searchParams.get('ul') ?? 0)
  const since = Date.now() - days * 86_400_000

  const rows = db.prepare(`
    SELECT ts, download, upload, ping FROM speedtest_history WHERE ts >= ? ORDER BY ts ASC
  `).all(since) as { ts: number; download: number; upload: number; ping: number }[]

  if (rows.length === 0) {
    return NextResponse.json({ rows: 0, days, sla: null })
  }

  const total = rows.length
  const threshold = 0.8 // 80% do contratado

  const aboveDl  = contractedDl > 0 ? rows.filter(r => r.download >= contractedDl * threshold).length : total
  const aboveUl  = contractedUl > 0 ? rows.filter(r => r.upload   >= contractedUl * threshold).length : total
  const dlPct    = Math.round((aboveDl / total) * 100)
  const ulPct    = Math.round((aboveUl / total) * 100)

  const avgDl    = rows.reduce((s, r) => s + r.download, 0) / total
  const avgUl    = rows.reduce((s, r) => s + r.upload,   0) / total
  const avgPing  = rows.reduce((s, r) => s + r.ping,     0) / total
  const minDl    = Math.min(...rows.map(r => r.download))
  const minUl    = Math.min(...rows.map(r => r.upload))
  const maxPing  = Math.max(...rows.map(r => r.ping))

  // Group by calendar day
  const byDay: Record<string, { dl: number[]; ul: number[]; ping: number[] }> = {}
  for (const r of rows) {
    const day = new Date(r.ts).toISOString().slice(0, 10)
    const d = (byDay[day] ??= { dl: [], ul: [], ping: [] })
    d.dl.push(r.download); d.ul.push(r.upload); d.ping.push(r.ping)
  }

  const daily = Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).map(([day, d]) => {
    const avgD  = d.dl.reduce((s, v) => s + v, 0) / d.dl.length
    const avgU  = d.ul.reduce((s, v) => s + v, 0) / d.ul.length
    const avgP  = d.ping.reduce((s, v) => s + v, 0) / d.ping.length
    const okDl  = contractedDl > 0 ? d.dl.every(v => v >= contractedDl * threshold) : true
    const okUl  = contractedUl > 0 ? d.ul.every(v => v >= contractedUl * threshold) : true
    return { day, avgDl: Math.round(avgD * 10) / 10, avgUl: Math.round(avgU * 10) / 10, avgPing: Math.round(avgP), ok: okDl && okUl }
  })

  const daysOk   = daily.filter(d => d.ok).length
  const daysBad  = daily.length - daysOk
  const overallSla = Math.min(dlPct, ulPct)

  return NextResponse.json({
    rows: total, days,
    sla: {
      overallPct:      overallSla,
      dlPct, ulPct,
      avgDl:   Math.round(avgDl  * 10) / 10,
      avgUl:   Math.round(avgUl  * 10) / 10,
      avgPing: Math.round(avgPing),
      minDl:   Math.round(minDl  * 10) / 10,
      minUl:   Math.round(minUl  * 10) / 10,
      maxPing,
      daysOk, daysBad,
      daily,
    },
  })
}
