import { NextRequest, NextResponse } from 'next/server'
import https from 'https'
import http from 'http'

export const runtime = 'nodejs'

function rawRequest(
  url: string,
  options: { method: string; headers: Record<string, string>; body?: string }
): Promise<{ statusCode: number; headers: Record<string, string[]>; data: string }> {
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
        rejectUnauthorized: false,
      },
      res => {
        let data = ''
        res.on('data', chunk => { data += chunk })
        res.on('end', () => resolve({
          statusCode: res.statusCode ?? 0,
          headers: res.headers as Record<string, string[]>,
          data,
        }))
      }
    )
    req.on('error', reject)
    if (options.body) req.write(options.body)
    req.end()
  })
}

function parseCookies(headers: Record<string, string[]>): string {
  const raw = headers['set-cookie']
  if (!raw) return ''
  const arr = Array.isArray(raw) ? raw : [raw]
  return arr.map(c => c.split(';')[0]).join('; ')
}

function getCsrfFromCookies(cookieHeader: string): string | null {
  // UniFi OS stores a JWT in TOKEN cookie; extract X-Csrf-Token from response header or derive from cookie
  const match = cookieHeader.match(/csrf_token=([^;]+)/)
  return match ? match[1] : null
}

async function apiRequest(
  base: string,
  path: string,
  method: string,
  cookies: string,
  csrfToken: string | null,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  const url = `${base.replace(/\/$/, '')}${path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Cookie': cookies,
  }
  if (csrfToken) headers['X-Csrf-Token'] = csrfToken

  const res = await rawRequest(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  let parsed: unknown
  try { parsed = JSON.parse(res.data) } catch { parsed = res.data }
  return { status: res.statusCode, data: parsed }
}

type UnifiStyle = 'os' | 'classic'

async function login(controllerUrl: string, username: string, password: string): Promise<{
  cookies: string
  csrfToken: string | null
  style: UnifiStyle
}> {
  const base = controllerUrl.replace(/\/$/, '')

  // Try UniFi OS style first (Dream Machine, Cloud Key Gen2+, UDM-Pro, etc.)
  try {
    const res = await rawRequest(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (res.statusCode === 200) {
      const cookies = parseCookies(res.headers)
      const csrfRaw = res.headers['x-csrf-token']
      const csrfToken = (Array.isArray(csrfRaw) ? csrfRaw[0] : csrfRaw) ||
        getCsrfFromCookies(cookies) || null
      return { cookies, csrfToken, style: 'os' }
    }
  } catch (_) {}

  // Fall back to classic UniFi Controller style (v6 and below)
  const res = await rawRequest(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ username, password }),
  })

  if (res.statusCode !== 200) {
    let detail: unknown
    try { detail = JSON.parse(res.data) } catch { detail = res.data }
    throw new Error(`Authentication failed (HTTP ${res.statusCode}): ${JSON.stringify(detail)}`)
  }

  return { cookies: parseCookies(res.headers), csrfToken: null, style: 'classic' }
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { controllerUrl, username, password, site = 'default', action } = body

  if (!controllerUrl || !username || !password) {
    return NextResponse.json({ error: 'Missing controllerUrl, username or password' }, { status: 400 })
  }

  try {
    const { cookies, csrfToken, style } = await login(controllerUrl, username, password)

    // API prefix differs between UniFi OS and classic
    const apiBase = style === 'os'
      ? `${controllerUrl.replace(/\/$/, '')}/proxy/network`
      : controllerUrl.replace(/\/$/, '')

    const get = (path: string) => apiRequest(apiBase, path, 'GET', cookies, csrfToken)

    let result: unknown = null

    switch (action) {
      case 'health':
        result = await get(`/api/s/${site}/stat/health`)
        break
      case 'devices':
        result = await get(`/api/s/${site}/stat/device`)
        break
      case 'clients':
        result = await get(`/api/s/${site}/stat/sta`)
        break
      case 'dashboard':
        result = await get(`/api/s/${site}/stat/dashboard`)
        break
      case 'alarms':
        result = await get(`/api/s/${site}/list/alarm`)
        break
      case 'wlan':
        result = await get(`/api/s/${site}/list/wlanconf`)
        break
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }

    const r = result as { status: number; data: unknown }
    if (r.status === 401) {
      return NextResponse.json({ error: 'Session expired or insufficient permissions' }, { status: 401 })
    }

    return NextResponse.json({ ok: true, style, data: (r.data as { data?: unknown })?.data ?? r.data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Request failed'
    return NextResponse.json({ error: message }, { status: 401 })
  }
}
