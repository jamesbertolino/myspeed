import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    ''

  try {
    const target = ip && ip !== '127.0.0.1' && ip !== '::1' ? ip : ''
    const url = `http://ip-api.com/json/${target}?fields=status,message,country,regionName,city,isp,org,as,query,timezone,lat,lon`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) throw new Error('ip-api failed')
    const d = await res.json()
    if (d.status !== 'success') throw new Error(d.message || 'lookup failed')
    return NextResponse.json({
      ip: d.query,
      city: d.city,
      region: d.regionName,
      country: d.country,
      isp: d.org || d.isp,
      asn: d.as,
      latitude: d.lat,
      longitude: d.lon,
      timezone: d.timezone,
    })
  } catch {
    return NextResponse.json({ ip: ip || null, city: null, region: null, country: null, isp: null })
  }
}
