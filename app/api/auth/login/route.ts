import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const { username, password } = await req.json()

  const validUser = process.env.APP_USERNAME || 'admin'
  const validPass = process.env.APP_PASSWORD || 'myspeed2024'

  if (username === validUser && password === validPass) {
    const res = NextResponse.json({ ok: true })
    res.cookies.set('ms_session', 'ok', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
      path: '/',
    })
    return res
  }

  return NextResponse.json({ error: 'Usuário ou senha incorretos' }, { status: 401 })
}
