import { NextRequest, NextResponse } from 'next/server'
import https from 'https'
import http from 'http'

export const runtime = 'nodejs'

function httpsRequest(
  url: string,
  options: { method: string; headers: Record<string, string>; body?: string }
): Promise<{ statusCode: number; headers: Record<string, string>; data: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const isHttps = parsed.protocol === 'https:'
    const lib = isHttps ? https : http

    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: options.method,
        headers: options.headers,
        rejectUnauthorized: false, // allow self-signed certs (UniFi default)
      },
      res => {
        let data = ''
        res.on('data', chunk => { data += chunk })
        res.on('end', () => resolve({
          statusCode: res.statusCode ?? 0,
          headers: res.headers as Record<string, string>,
          data,
        }))
      }
    )
    req.on('error', reject)
    if (options.body) req.write(options.body)
    req.end()
  })
}

async function unifiRequest(
  controllerUrl: string,
  path: string,
  method: string,
  body?: unknown,
  cookies?: string
) {
  const url = `${controllerUrl.replace(/\/$/, '')}${path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  }
  if (cookies) headers['Cookie'] = cookies

  const res = await httpsRequest(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  let parsed: unknown
  try { parsed = JSON.parse(res.data) } catch { parsed = res.data }

  return { data: parsed, cookies: res.headers['set-cookie'] || '', status: res.statusCode }
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { controllerUrl, username, password, site = 'default', action } = body

  if (!controllerUrl || !username || !password) {
    return NextResponse.json({ error: 'Missing controllerUrl, username or password' }, { status: 400 })
  }

  try {
    const loginRes = await unifiRequest(controllerUrl, '/api/login', 'POST', { username, password })

    if (loginRes.status !== 200) {
      return NextResponse.json({ error: 'Authentication failed', detail: loginRes.data }, { status: 401 })
    }

    const sessionCookies = loginRes.cookies

    let result: unknown = null

    switch (action) {
      case 'health':
        result = await unifiRequest(controllerUrl, `/api/s/${site}/stat/health`, 'GET', undefined, sessionCookies)
        break
      case 'devices':
        result = await unifiRequest(controllerUrl, `/api/s/${site}/stat/device`, 'GET', undefined, sessionCookies)
        break
      case 'clients':
        result = await unifiRequest(controllerUrl, `/api/s/${site}/stat/sta`, 'GET', undefined, sessionCookies)
        break
      case 'dashboard':
        result = await unifiRequest(controllerUrl, `/api/s/${site}/stat/dashboard`, 'GET', undefined, sessionCookies)
        break
      case 'alarms':
        result = await unifiRequest(controllerUrl, `/api/s/${site}/list/alarm`, 'GET', undefined, sessionCookies)
        break
      case 'wlan':
        result = await unifiRequest(controllerUrl, `/api/s/${site}/list/wlanconf`, 'GET', undefined, sessionCookies)
        break
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }

    return NextResponse.json({ ok: true, data: (result as { data: unknown }).data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Request failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
