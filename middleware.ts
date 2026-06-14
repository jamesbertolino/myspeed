import { NextRequest, NextResponse } from 'next/server'

const PUBLIC = ['/', '/login']
const PUBLIC_PREFIX = ['/api/', '/_next/', '/favicon']

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  const isPublic = PUBLIC.includes(pathname) || PUBLIC_PREFIX.some(p => pathname.startsWith(p))
  if (isPublic) return NextResponse.next()

  const session = req.cookies.get('ms_session')?.value
  if (session !== 'ok') {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
