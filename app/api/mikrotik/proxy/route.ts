import { NextRequest, NextResponse } from 'next/server'
import https from 'https'
import http from 'http'

export const runtime = 'nodejs'

function httpsRequest(
  url: string,
  options: { method: string; headers: Record<string, string>; body?: string }
): Promise<{ statusCode: number; data: string }> {
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
        res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, data }))
      }
    )
    req.on('error', reject)
    if (options.body) req.write(options.body)
    req.end()
  })
}

async function mtRequest(
  controllerUrl: string,
  path: string,
  method: string,
  auth: string,
  body?: unknown
) {
  const url = `${controllerUrl.replace(/\/$/, '')}/rest${path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Basic ${auth}`,
  }

  const res = await httpsRequest(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  if (res.statusCode >= 400) {
    throw new Error(`HTTP ${res.statusCode}: ${res.data}`)
  }

  try { return JSON.parse(res.data) } catch { return res.data }
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { controllerUrl, username, password, action } = body

  if (!controllerUrl || !username || !password) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const auth = Buffer.from(`${username}:${password}`).toString('base64')

  try {
    let result: unknown = null

    switch (action) {
      case 'resources':
        result = await mtRequest(controllerUrl, '/system/resource', 'GET', auth)
        break
      case 'interfaces':
        result = await mtRequest(controllerUrl, '/interface', 'GET', auth)
        break
      case 'ip_address':
        result = await mtRequest(controllerUrl, '/ip/address', 'GET', auth)
        break
      case 'wireless_clients':
        result = await mtRequest(controllerUrl, '/interface/wireless/registration-table', 'GET', auth)
        break
      case 'capsman_clients':
        result = await mtRequest(controllerUrl, '/caps-man/registration-table', 'GET', auth)
        break
      case 'wireless_interfaces':
        result = await mtRequest(controllerUrl, '/interface/wireless', 'GET', auth)
        break
      case 'routes':
        result = await mtRequest(controllerUrl, '/ip/route', 'GET', auth)
        break
      case 'neighbors':
        result = await mtRequest(controllerUrl, '/ip/neighbor', 'GET', auth)
        break
      case 'log':
        result = await mtRequest(controllerUrl, '/log', 'GET', auth)
        break
      case 'identity':
        result = await mtRequest(controllerUrl, '/system/identity', 'GET', auth)
        break
      case 'health':
        result = await mtRequest(controllerUrl, '/system/health', 'GET', auth)
        break
      case 'traffic':
        result = await mtRequest(controllerUrl, '/interface', 'GET', auth)
        break
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }

    return NextResponse.json({ ok: true, data: result })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Request failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
