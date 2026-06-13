import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export interface StnetServer {
  id: string
  name: string
  sponsor: string
  country: string
  cc: string
  host: string
  lat: string
  lon: string
  distance: number
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const lat = searchParams.get('lat') ?? ''
  const lon = searchParams.get('lon') ?? ''
  const limit = searchParams.get('limit') ?? '20'

  const params = new URLSearchParams({
    engine: 'js',
    https_functional: 'true',
    limit,
    ...(lat && lon ? { lat, lon } : {}),
  })

  try {
    const res = await fetch(`https://www.speedtest.net/api/js/servers?${params}`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://www.speedtest.net/',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) throw new Error(`Speedtest.net responded ${res.status}`)
    const data: StnetServer[] = await res.json()

    return NextResponse.json({ servers: data })
  } catch (e) {
    return NextResponse.json({ error: String(e), servers: [] }, { status: 502 })
  }
}
