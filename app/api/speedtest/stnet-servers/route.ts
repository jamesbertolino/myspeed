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

function parseXml(xml: string): StnetServer[] {
  const servers: StnetServer[] = []
  const re = /<Server\s([^/]*)\/?>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const attr = (name: string) => {
      const a = new RegExp(`${name}="([^"]*)"`, 'i').exec(m![1])
      return a ? a[1] : ''
    }
    servers.push({
      id:       attr('id'),
      name:     attr('name'),
      sponsor:  attr('sponsor'),
      country:  attr('country'),
      cc:       attr('cc'),
      host:     attr('host'),
      lat:      attr('lat'),
      lon:      attr('lon'),
      distance: parseFloat(attr('d') || '0'),
      url:      attr('url'),
    })
  }
  return servers
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const lat = parseFloat(searchParams.get('lat') ?? 'NaN')
  const lon = parseFloat(searchParams.get('lon') ?? 'NaN')
  const limit = parseInt(searchParams.get('limit') ?? '30')

  const endpoints = [
    lat && lon
      ? `https://www.speedtest.net/speedtest-servers.php?lat=${lat}&lon=${lon}&limit=${limit}&https=true`
      : `https://www.speedtest.net/speedtest-servers-static.php`,
    `https://c.speedtest.net/speedtest-servers-static.php`,
  ]

  let xml = ''
  let lastErr = ''

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/xml, text/xml, */*',
          'Referer': 'https://www.speedtest.net/',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      })
      if (res.ok) { xml = await res.text(); break }
      lastErr = `HTTP ${res.status} from ${url}`
    } catch (e) {
      lastErr = String(e)
    }
  }

  if (!xml) {
    return NextResponse.json({ error: lastErr, servers: [] }, { status: 502 })
  }

  let servers = parseXml(xml)

  // Compute distance if we have coords
  if (!isNaN(lat) && !isNaN(lon)) {
    servers = servers
      .map(s => ({ ...s, distance: haversineKm(lat, lon, parseFloat(s.lat), parseFloat(s.lon)) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit)
  } else {
    servers = servers.slice(0, limit)
  }

  return NextResponse.json({ servers })
}
