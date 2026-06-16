import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

export const runtime = 'nodejs'

const execAsync = promisify(exec)

const DEFAULT_TARGET = '8.8.8.8'

async function icmpPing(target: string): Promise<{ ms: number; ttl: number | null }> {
  const isWin = process.platform === 'win32'
  // sanitiza: só permite IPs válidos ou hostnames simples
  const safe = /^[a-zA-Z0-9.\-]+$/.test(target) ? target : DEFAULT_TARGET
  const cmd  = isWin ? `ping -n 1 ${safe}` : `ping -c 1 ${safe}`

  try {
    const { stdout } = await execAsync(cmd, { timeout: 5000 })

    // Windows: "tempo=10ms TTL=113"  |  Linux: "time=10.3 ms ttl=113"
    const msMatch  = stdout.match(/[Tt]empo?[<=](\d+(?:\.\d+)?)\s*ms/i)
                  || stdout.match(/time[<=](\d+(?:\.\d+)?)\s*ms/i)
    const ttlMatch = stdout.match(/TTL[<=](\d+)/i)

    return {
      ms:  msMatch  ? Math.round(parseFloat(msMatch[1]))  : -1,
      ttl: ttlMatch ? parseInt(ttlMatch[1])               : null,
    }
  } catch {
    return { ms: -1, ttl: null }
  }
}

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get('target') ?? DEFAULT_TARGET
  const { ms, ttl } = await icmpPing(target)
  return NextResponse.json({ ts: Date.now(), ok: ms >= 0, ms, ttl })
}
