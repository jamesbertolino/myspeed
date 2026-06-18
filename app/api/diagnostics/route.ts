import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'

export const runtime = 'nodejs'

interface DiagRow {
  id: number; ts: number; trigger_why: string
  ping_avg: number | null; dl_mbps: number | null
  conclusion: string | null; details_json: string | null
}

export async function GET(req: NextRequest) {
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? 10), 50)
  const rows = db.prepare(`SELECT * FROM diagnostics ORDER BY ts DESC LIMIT ?`).all(limit) as DiagRow[]
  return NextResponse.json({ rows })
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { trigger?: string; ping_avg?: number; dl_mbps?: number; details?: unknown }
  const { trigger = 'manual', ping_avg, dl_mbps, details } = body

  // Determine conclusion
  const issues: string[] = []
  if (ping_avg && ping_avg > 200) issues.push(`Latência alta: ${ping_avg.toFixed(0)}ms`)
  if (ping_avg && ping_avg > 100 && ping_avg <= 200) issues.push(`Latência elevada: ${ping_avg.toFixed(0)}ms`)
  if (dl_mbps !== undefined && dl_mbps !== null && dl_mbps < 5) issues.push(`Download muito baixo: ${dl_mbps.toFixed(1)}Mbps`)

  const conclusion = issues.length > 0
    ? `Problemas detectados: ${issues.join('; ')}`
    : 'Rede estável no momento do diagnóstico'

  const result = db.prepare(`
    INSERT INTO diagnostics (ts, trigger_why, ping_avg, dl_mbps, conclusion, details_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(Date.now(), trigger, ping_avg ?? null, dl_mbps ?? null, conclusion, details ? JSON.stringify(details) : null)

  // Keep last 30
  db.prepare(`DELETE FROM diagnostics WHERE id NOT IN (SELECT id FROM diagnostics ORDER BY ts DESC LIMIT 30)`).run()

  return NextResponse.json({ id: result.lastInsertRowid, conclusion })
}

export async function DELETE() {
  db.prepare(`DELETE FROM diagnostics`).run()
  return NextResponse.json({ ok: true })
}
