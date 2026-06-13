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
  url: string
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const lat = searchParams.get('lat') ?? ''
  const lon = searchParams.get('lon') ?? ''
  const limit = searchParams.get('limit') ?? '30'

  const params = new URLSearchParams({
    engine: 'js',
    https_functional: 'true',
    limit,
    ...(lat && lon ? { lat, lon } : {}),
  })

  try {
    const res = await fetch(`https://www.speedtest.net/api/js/servers?${params}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        'Referer': 'https://www.speedtest.net/',
        'Origin': 'https://www.speedtest.net',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) throw new Error(`Speedtest.net responded ${res.status}`)
    const data = await res.json()

    // Response is { value: [...], Count: N } or just an array
    const servers: StnetServer[] = Array.isArray(data) ? data : (data.value ?? [])

    return NextResponse.json({ servers })
  } catch (e) {
    return NextResponse.json({ error: String(e), servers: [] }, { status: 502 })
  }
}
