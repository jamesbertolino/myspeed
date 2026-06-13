export const runtime = 'nodejs'

import os from 'os'

export interface NetworkInterface {
  name: string
  address: string
  subnet: string
  netmask: string
  mac: string
}

function getPrivateInterfaces(): NetworkInterface[] {
  const ifaces = os.networkInterfaces()
  const result: NetworkInterface[] = []

  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const iface of (addrs ?? [])) {
      if (iface.family !== 'IPv4' || iface.internal) continue
      const parts = iface.address.split('.').map(Number)
      const [a, b] = parts
      const isPrivate =
        a === 10 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168)
      if (!isPrivate) continue
      result.push({
        name,
        address: iface.address,
        subnet: `${parts[0]}.${parts[1]}.${parts[2]}`,
        netmask: iface.netmask,
        mac: iface.mac,
      })
    }
  }

  return result
}

export async function GET() {
  const interfaces = getPrivateInterfaces()
  return Response.json({ interfaces })
}
