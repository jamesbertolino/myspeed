import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    '0.0.0.0'

  try {
    const res = await fetch(`https://ipapi.co/${ip}/json/`, {
      headers: { 'User-Agent': 'myspeed/1.0' },
    })
    if (!res.ok) throw new Error('ipapi failed')
    const data = await res.json()
    return NextResponse.json({
      ip: data.ip,
      city: data.city,
      region: data.region,
      country: data.country_name,
      country_code: data.country_code,
      isp: data.org,
      asn: data.asn,
      latitude: data.latitude,
      longitude: data.longitude,
      timezone: data.timezone,
    })
  } catch {
    return NextResponse.json({ ip, city: null, region: null, country: null, isp: null })
  }
}
