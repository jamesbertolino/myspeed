import { NextResponse } from 'next/server'
import db from '@/lib/db'

export const runtime = 'nodejs'

export async function GET() {
  const rows = db.prepare(`
    SELECT
      CAST(strftime('%H', datetime(ts/1000, 'unixepoch', 'localtime')) AS INTEGER) AS hour,
      AVG(download) AS avgDl,
      AVG(upload)   AS avgUl,
      AVG(ping)     AS avgPing,
      COUNT(*)      AS count
    FROM speedtest_history
    WHERE ts > ?
    GROUP BY hour
    ORDER BY hour
  `).all(Date.now() - 30 * 24 * 3600 * 1000) as {
    hour: number; avgDl: number; avgUl: number; avgPing: number; count: number
  }[]

  if (rows.length < 3) {
    return NextResponse.json({ hourly: rows, throttling: null, message: 'Dados insuficientes — rode mais speedtests em horários variados.' })
  }

  // Define peak (18-23h) and off-peak (0-8h, 10-16h)
  const peak    = rows.filter(r => r.hour >= 18 && r.hour <= 23)
  const offPeak = rows.filter(r => r.hour <= 8 || (r.hour >= 10 && r.hour <= 16))

  const avgOf = (arr: typeof rows, key: 'avgDl' | 'avgUl' | 'avgPing') =>
    arr.length ? arr.reduce((s, r) => s + r[key] * r.count, 0) / arr.reduce((s, r) => s + r.count, 0) : null

  const peakDl    = avgOf(peak, 'avgDl')
  const offDl     = avgOf(offPeak, 'avgDl')
  const peakPing  = avgOf(peak, 'avgPing')
  const offPing   = avgOf(offPeak, 'avgPing')

  let throttleScore = 0
  const evidence: string[] = []

  if (peakDl && offDl && offDl > 0) {
    const dlDrop = ((offDl - peakDl) / offDl) * 100
    if (dlDrop > 40) { throttleScore += 3; evidence.push(`Download cai ${dlDrop.toFixed(0)}% no horário de pico`) }
    else if (dlDrop > 20) { throttleScore += 1; evidence.push(`Download reduz ${dlDrop.toFixed(0)}% no pico`) }
  }

  if (peakPing && offPing && offPing > 0) {
    const pingIncrease = ((peakPing - offPing) / offPing) * 100
    if (pingIncrease > 100) { throttleScore += 2; evidence.push(`Latência aumenta ${pingIncrease.toFixed(0)}% no pico`) }
    else if (pingIncrease > 50) { throttleScore += 1; evidence.push(`Latência sobe ${pingIncrease.toFixed(0)}% no pico`) }
  }

  const verdict =
    throttleScore >= 4 ? 'alto' :
    throttleScore >= 2 ? 'moderado' :
    throttleScore >= 1 ? 'baixo' : 'nenhum'

  return NextResponse.json({
    hourly: rows,
    throttling: {
      verdict,
      score: throttleScore,
      evidence,
      peakDl,
      offPeakDl: offDl,
      peakPing,
      offPeakPing: offPing,
      dlDropPct: (peakDl && offDl && offDl > 0) ? ((offDl - peakDl) / offDl) * 100 : null,
      pingIncreasePct: (peakPing && offPing && offPing > 0) ? ((peakPing - offPing) / offPing) * 100 : null,
    },
  })
}
