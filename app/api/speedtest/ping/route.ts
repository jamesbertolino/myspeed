import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

// HEAD request to target host to measure round-trip latency.
// Used by the server selector to show ping per server before the test.
export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get('target')
  if (!target) return NextResponse.json({ error: 'missing target' }, { status: 400 })

  const url = `https://${target}/`
  const samples: number[] = []

  for (let i = 0; i < 3; i++) {
    const t0 = Date.now()
    try {
      await fetch(url, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(3000) })
    } catch { /* timeout or unreachable */ }
    samples.push(Date.now() - t0)
  }

  const avg = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length)
  return NextResponse.json({ ping: avg, samples })
}
