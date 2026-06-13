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

interface LoginResult {
  cookies: string
  csrfToken: string | null
  style: UnifiStyle
}

interface MfaRequired {
  requires2fa: true
  mfaCookie: string
  authenticators: Array<{ id: string; type: string; name?: string; email?: string }>
  defaultMfa: string
}

async function loginUnifi(
  controllerUrl: string,
  username: string,
  password: string,
  token2fa?: string,
  mfaCookie?: string,
): Promise<LoginResult | MfaRequired> {
  const base = controllerUrl.replace(/\/$/, '')

  // --- UniFi OS style (Dream Machine, UDM-Pro, Cloud Key Gen2+, UNVR, etc.) ---
  // If we have an mfa_cookie from a previous 400, verify it now
  if (mfaCookie && token2fa) {
    const verifyRes = await rawRequest(`${base}/api/auth/2fa-verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Cookie': `TOKEN=${mfaCookie}`,
      },
      body: JSON.stringify({ token: token2fa }),
    })
    if (verifyRes.statusCode === 200) {
      const cookies = parseCookies(verifyRes.headers)
      const csrfRaw = verifyRes.headers['x-csrf-token']
      const csrfToken = (Array.isArray(csrfRaw) ? csrfRaw[0] : csrfRaw) ?? null
      return { cookies: cookies || `TOKEN=${mfaCookie}`, csrfToken, style: 'os' }
    }
    // Some controllers accept token inline in login body
    const inlineRes = await rawRequest(`${base}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Cookie': `TOKEN=${mfaCookie}`,
      },
      body: JSON.stringify({ username, password, token: token2fa }),
    })
    if (inlineRes.statusCode === 200) {
      const cookies = parseCookies(inlineRes.headers)
      const csrfRaw = inlineRes.headers['x-csrf-token']
      const csrfToken = (Array.isArray(csrfRaw) ? csrfRaw[0] : csrfRaw) ?? null
      return { cookies, csrfToken, style: 'os' }
    }
    let detail: unknown
    try { detail = JSON.parse(inlineRes.data) } catch { detail = inlineRes.data }
    throw new Error(`2FA verification failed: ${JSON.stringify(detail)}`)
  }

  // Initial UniFi OS login attempt
  try {
    const loginBody: Record<string, string> = { username, password }
    if (token2fa) loginBody.token = token2fa

    const res = await rawRequest(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(loginBody),
    })

    if (res.statusCode === 200) {
      const cookies = parseCookies(res.headers)
      const csrfRaw = res.headers['x-csrf-token']
      const csrfToken = (Array.isArray(csrfRaw) ? csrfRaw[0] : csrfRaw) ?? null
      return { cookies, csrfToken, style: 'os' }
    }

    if (res.statusCode === 400) {
      let body: Record<string, unknown>
      try { body = JSON.parse(res.data) } catch { body = {} }
      const meta = body.meta as Record<string, string> | undefined
      if (meta?.msg === 'api.err.Ubic2faTokenRequired') {
        const data = (body.data as Array<Record<string, unknown>>)?.[0] ?? {}
        return {
          requires2fa: true,
          mfaCookie: data.mfa_cookie as string,
          authenticators: (data.authenticators as Array<Record<string, unknown>>)?.map(a => ({
            id: a.id as string,
            type: a.type as string,
            name: a.name as string | undefined,
            email: a.email as string | undefined,
          })) ?? [],
          defaultMfa: data.default_mfa as string,
        }
      }
    }
  } catch (_) {}

  // --- Classic UniFi Controller (v6 and below) ---
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
  const {
    controllerUrl, username, password,
    site = 'default', action,
    token2fa, mfaCookie,
  } = body

  if (!controllerUrl || !username || !password) {
    return NextResponse.json({ error: 'Missing controllerUrl, username or password' }, { status: 400 })
  }

  try {
    const loginResult = await loginUnifi(controllerUrl, username, password, token2fa, mfaCookie)

    // 2FA required — tell the frontend
    if ('requires2fa' in loginResult) {
      return NextResponse.json(loginResult, { status: 200 })
    }

    const { cookies, csrfToken, style } = loginResult
    const apiBase = style === 'os'
      ? `${controllerUrl.replace(/\/$/, '')}/proxy/network`
      : controllerUrl.replace(/\/$/, '')

    const get = (path: string) => apiRequest(apiBase, path, 'GET', cookies, csrfToken)

    let result: { status: number; data: unknown } | null = null

    switch (action) {
      case 'health':    result = await get(`/api/s/${site}/stat/health`);    break
      case 'devices':   result = await get(`/api/s/${site}/stat/device`);    break
      case 'clients':   result = await get(`/api/s/${site}/stat/sta`);       break
      case 'dashboard': result = await get(`/api/s/${site}/stat/dashboard`); break
      case 'alarms':    result = await get(`/api/s/${site}/list/alarm`);     break
      case 'wlan':      result = await get(`/api/s/${site}/list/wlanconf`);  break
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }

    if (result.status === 401) {
      return NextResponse.json({ error: 'Session expired or insufficient permissions' }, { status: 401 })
    }

    return NextResponse.json({
      ok: true,
      style,
      data: (result.data as { data?: unknown })?.data ?? result.data,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Request failed'
    return NextResponse.json({ error: message }, { status: 401 })
  }
}
