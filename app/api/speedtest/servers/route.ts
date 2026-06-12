import { NextResponse } from 'next/server'
import { SERVERS } from '@/lib/servers'

export async function GET() {
  let cfPop: string | null = null
  try {
    const trace = await fetch('https://www.cloudflare.com/cdn-cgi/trace', { cache: 'no-store' })
    const text = await trace.text()
    cfPop = text.match(/colo=([A-Z]+)/)?.[1] ?? null
  } catch { /* ignore */ }

  return NextResponse.json({ servers: SERVERS, cfPop })
}
