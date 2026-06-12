import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const start = Date.now()
  let bytes = 0

  const reader = request.body?.getReader()
  if (!reader) {
    return NextResponse.json({ error: 'No body' }, { status: 400 })
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value?.byteLength ?? 0
  }

  const elapsed = (Date.now() - start) / 1000
  const mbps = (bytes * 8) / (elapsed * 1e6)

  return NextResponse.json({ bytes, elapsed, mbps })
}
