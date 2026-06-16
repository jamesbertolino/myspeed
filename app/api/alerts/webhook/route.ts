import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const webhookUrl = body?.webhookUrl
  const message    = body?.message

  if (typeof webhookUrl !== 'string' || typeof message !== 'string') {
    return NextResponse.json({ error: 'webhookUrl e message são obrigatórios' }, { status: 400 })
  }

  let url: URL
  try {
    url = new URL(webhookUrl)
  } catch {
    return NextResponse.json({ error: 'webhookUrl inválida' }, { status: 400 })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return NextResponse.json({ error: 'webhookUrl deve ser http(s)' }, { status: 400 })
  }

  const isDiscordOrSlack = /discord\.com\/api\/webhooks/.test(url.hostname + url.pathname) ||
                            /hooks\.slack\.com/.test(url.hostname)

  const payload = isDiscordOrSlack
    ? { content: `**MySpeed** — ${message}` }
    : { source: 'myspeed', message, ts: Date.now() }

  try {
    const res = await fetch(url.toString(), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
      signal:  AbortSignal.timeout(8000),
    })
    return NextResponse.json({ ok: res.ok, status: res.status })
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 502 })
  }
}
