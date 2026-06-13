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

async function getClientLatLon(req: NextRequest): Promise<{ lat: number; lon: number } | null> {
  const forwarded = req.headers.get('x-forwarded-for')
  const realIp = req.headers.get('x-real-ip')
  const ip = forwarded?.split(',')[0].trim() || realIp || ''

  if (!ip || ip === '127.0.0.1' || ip === '::1') return null

  try {
    const res = await fetch(`https://ipinfo.io/${ip}/json`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const d = await res.json()
    if (d.bogon || !d.loc) return null
    const [lat, lon] = d.loc.split(',').map(Number)
    return { lat, lon }
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const limit = searchParams.get('limit') ?? '30'

  // Prefer explicit coords (passed by client), otherwise geolocate client IP server-side
  let lat = searchParams.get('lat') ? Number(searchParams.get('lat')) : null
  let lon = searchParams.get('lon') ? Number(searchParams.get('lon')) : null

  if (lat === null || lon === null) {
    const coords = await getClientLatLon(req)
    if (coords) { lat = coords.lat; lon = coords.lon }
  }

  const params = new URLSearchParams({
    engine: 'js',
    https_functional: 'true',
    limit,
    ...(lat != null && lon != null ? { lat: String(lat), lon: String(lon) } : {}),
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

    const servers: StnetServer[] = Array.isArray(data) ? data : (data.value ?? [])

    return NextResponse.json({ servers, resolvedLat: lat, resolvedLon: lon })
  } catch (e) {
    return NextResponse.json({ error: String(e), servers: [] }, { status: 502 })
  }
}
