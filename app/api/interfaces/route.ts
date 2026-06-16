import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import os from 'os'

export const runtime = 'nodejs'

const execAsync = promisify(exec)

interface IfaceStats {
  name: string
  rxBytes: number
  txBytes: number
  mac?: string
  ipv4?: string
}

async function getWindowsStats(): Promise<IfaceStats[]> {
  const { stdout } = await execAsync(
    'powershell -NoProfile -Command "Get-NetAdapterStatistics | Select-Object Name,ReceivedBytes,SentBytes | ConvertTo-Json"',
    { timeout: 5000 }
  )
  const raw = JSON.parse(stdout.trim())
  const arr = Array.isArray(raw) ? raw : [raw]
  return arr.map((r: Record<string, unknown>) => ({
    name:    String(r.Name ?? ''),
    rxBytes: Number(r.ReceivedBytes ?? 0),
    txBytes: Number(r.SentBytes ?? 0),
  }))
}

async function getLinuxStats(): Promise<IfaceStats[]> {
  const { stdout } = await execAsync('cat /proc/net/dev', { timeout: 3000 })
  return stdout
    .split('\n')
    .slice(2)
    .filter(Boolean)
    .map(line => {
      const [iface, ...cols] = line.trim().split(/\s+/)
      return {
        name:    iface.replace(':', ''),
        rxBytes: Number(cols[0] ?? 0),
        txBytes: Number(cols[8] ?? 0),
      }
    })
    .filter(i => i.name && i.name !== 'lo')
}

function enrichWithOsInfo(ifaces: IfaceStats[]): IfaceStats[] {
  const nets = os.networkInterfaces()
  return ifaces.map(iface => {
    const match = Object.entries(nets).find(([name]) =>
      name.toLowerCase() === iface.name.toLowerCase()
    )
    const v4 = match?.[1]?.find(a => a.family === 'IPv4' && !a.internal)
    return {
      ...iface,
      mac:  v4 ? match![1]?.find(a => a.mac !== '00:00:00:00:00:00')?.mac : undefined,
      ipv4: v4?.address,
    }
  })
}

export async function GET() {
  try {
    const isWin = process.platform === 'win32'
    const raw   = isWin ? await getWindowsStats() : await getLinuxStats()
    const ifaces = enrichWithOsInfo(raw)
    return NextResponse.json({ ts: Date.now(), ifaces })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
