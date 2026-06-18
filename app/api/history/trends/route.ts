import { NextResponse } from 'next/server'
import db from '@/lib/db'

export const runtime = 'nodejs'

interface Insight {
  type: 'warning' | 'info' | 'good'
  title: string
  detail: string
}

function avg(arr: number[]) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
}

export async function GET() {
  const now = Date.now()
  const day7  = now - 7  * 86_400_000
  const day14 = now - 14 * 86_400_000
  const day30 = now - 30 * 86_400_000

  const insights: Insight[] = []

  // ── Ping trend ────────────────────────────────────────────────────────────────
  const pingRecent = (db.prepare('SELECT ms FROM ping_history WHERE ts >= ? ORDER BY ts DESC').all(day7)  as { ms: number }[]).map(r => r.ms)
  const pingOld    = (db.prepare('SELECT ms FROM ping_history WHERE ts >= ? AND ts < ?').all(day14, day7) as { ms: number }[]).map(r => r.ms)

  if (pingRecent.length >= 20 && pingOld.length >= 20) {
    const rAvg = avg(pingRecent); const oAvg = avg(pingOld)
    const delta = ((rAvg - oAvg) / oAvg) * 100
    if (delta > 25) {
      insights.push({ type: 'warning', title: 'Latência aumentou', detail: `Ping médio subiu ${Math.round(delta)}% nos últimos 7 dias (${Math.round(oAvg)} → ${Math.round(rAvg)} ms).` })
    } else if (delta < -20) {
      insights.push({ type: 'good', title: 'Latência melhorou', detail: `Ping médio caiu ${Math.round(-delta)}% nos últimos 7 dias (${Math.round(oAvg)} → ${Math.round(rAvg)} ms).` })
    }
  }

  // ── Peak-hour degradation ────────────────────────────────────────────────────
  if (pingRecent.length >= 50) {
    const byHour = db.prepare(`
      SELECT strftime('%H', ts/1000, 'unixepoch', 'localtime') as h, AVG(ms) as avg
      FROM ping_history WHERE ts >= ? GROUP BY h
    `).all(day30) as { h: string; avg: number }[]

    if (byHour.length >= 12) {
      const evening = byHour.filter(r => Number(r.h) >= 18 && Number(r.h) <= 23)
      const morning = byHour.filter(r => Number(r.h) >= 6  && Number(r.h) <= 11)
      const avgEvening = avg(evening.map(r => r.avg))
      const avgMorning = avg(morning.map(r => r.avg))
      if (avgEvening > avgMorning * 1.5 && avgEvening > 60) {
        insights.push({ type: 'warning', title: 'Congestionamento noturno', detail: `Latência à noite (18h–23h) é ${Math.round(((avgEvening/avgMorning)-1)*100)}% maior que de manhã (${Math.round(avgMorning)}ms → ${Math.round(avgEvening)}ms).` })
      }
    }
  }

  // ── Download trend ───────────────────────────────────────────────────────────
  const spRecent = (db.prepare('SELECT download, upload, ping FROM speedtest_history WHERE ts >= ?').all(day7)  as { download:number; upload:number; ping:number }[])
  const spOld    = (db.prepare('SELECT download, upload, ping FROM speedtest_history WHERE ts >= ? AND ts < ?').all(day14, day7) as { download:number; upload:number; ping:number }[])

  if (spRecent.length >= 3 && spOld.length >= 3) {
    const dlNew = avg(spRecent.map(r => r.download)); const dlOld = avg(spOld.map(r => r.download))
    const delta = ((dlNew - dlOld) / dlOld) * 100
    if (delta < -20) {
      insights.push({ type: 'warning', title: 'Download caindo', detail: `Velocidade de download caiu ${Math.round(-delta)}% nos últimos 7 dias (${Math.round(dlOld)} → ${Math.round(dlNew)} Mbps).` })
    } else if (delta > 15) {
      insights.push({ type: 'good', title: 'Download melhorou', detail: `Velocidade de download subiu ${Math.round(delta)}% nos últimos 7 dias (${Math.round(dlOld)} → ${Math.round(dlNew)} Mbps).` })
    }
  }

  // ── New devices ──────────────────────────────────────────────────────────────
  const newDevs = (db.prepare('SELECT COUNT(*) as n FROM known_devices WHERE first_seen >= ?').get(day7) as { n: number }).n
  if (newDevs > 0) {
    insights.push({ type: 'info', title: `${newDevs} dispositivo${newDevs > 1 ? 's' : ''} novo${newDevs > 1 ? 's' : ''} na semana`, detail: `${newDevs} novo${newDevs > 1 ? 's' : ''} MAC${newDevs > 1 ? 's' : ''} detectado${newDevs > 1 ? 's' : ''} na rede nos últimos 7 dias.` })
  }

  // ── WiFi score trend ─────────────────────────────────────────────────────────
  const wifiRecent = (db.prepare('SELECT band24_score FROM wifi_scan_history WHERE ts >= ? AND band24_score IS NOT NULL').all(day7)  as { band24_score: number }[]).map(r => r.band24_score)
  const wifiOld    = (db.prepare('SELECT band24_score FROM wifi_scan_history WHERE ts >= ? AND ts < ? AND band24_score IS NOT NULL').all(day14, day7) as { band24_score: number }[]).map(r => r.band24_score)

  if (wifiRecent.length >= 3 && wifiOld.length >= 3) {
    const wNew = avg(wifiRecent); const wOld = avg(wifiOld)
    const delta = wNew - wOld
    if (delta < -15) {
      insights.push({ type: 'warning', title: 'Score WiFi degradando', detail: `Score médio do canal 2.4GHz caiu ${Math.round(-delta)} pontos na última semana (${Math.round(wOld)} → ${Math.round(wNew)}/100).` })
    }
  }

  // ── Packet loss ──────────────────────────────────────────────────────────────
  const totalPing = (db.prepare('SELECT COUNT(*) as n FROM ping_history WHERE ts >= ?').get(day7) as { n: number }).n
  const alertLoss = (db.prepare("SELECT COUNT(*) as n FROM alert_log WHERE ts >= ? AND type = 'packet_loss'").get(day7) as { n: number }).n
  if (alertLoss >= 3) {
    insights.push({ type: 'warning', title: 'Perda de pacotes frequente', detail: `${alertLoss} alertas de packet loss registrados nos últimos 7 dias.` })
  } else if (totalPing > 100 && alertLoss === 0) {
    insights.push({ type: 'good', title: 'Sem perda de pacotes', detail: `Nenhum alerta de packet loss nos últimos 7 dias com ${totalPing} amostras.` })
  }

  return NextResponse.json({ insights, generatedAt: now })
}
