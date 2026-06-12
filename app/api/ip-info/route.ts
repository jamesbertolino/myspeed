import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const forwarded = request.headers.get('x-forwarded-for')
  const realIp = request.headers.get('x-real-ip')
  const ip = forwarded?.split(',')[0].trim() || realIp || ''

  try {
    // ipinfo.io: free, HTTPS, no key needed for basic fields
    const target = ip && ip !== '127.0.0.1' && ip !== '::1' ? ip : ''
    const res = await fetch(`https://ipinfo.io/${target}/json`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`ipinfo ${res.status}`)
    const d = await res.json()
    if (d.bogon) throw new Error('bogon IP')

    return NextResponse.json({
      ip: d.ip,
      city: d.city,
      region: d.region,
      country: d.country,
      isp: d.org,
      asn: d.org?.split(' ')[0],
      timezone: d.timezone,
    })
  } catch {
    // fallback: return at least the raw IP
    return NextResponse.json({ ip: ip || null, city: null, region: null, country: null, isp: null })
  }
}
