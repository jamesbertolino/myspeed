import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { loadSettings } from '@/lib/settings'

export const runtime = 'nodejs'

interface Host { ip: string; mac: string | null }

export async function POST(req: NextRequest) {
  const { hosts }: { hosts: Host[] } = await req.json()
  if (!Array.isArray(hosts)) return NextResponse.json({ error: 'invalid' }, { status: 400 })

  const now = Date.now()
  const newDevices: Array<{ mac: string; ip: string }> = []

  for (const h of hosts) {
    if (!h.mac) continue
    const mac = h.mac.toLowerCase()
    const existing = db.prepare('SELECT mac, trusted FROM known_devices WHERE mac = ?').get(mac) as
      { mac: string; trusted: number } | undefined

    if (!existing) {
      // Primeiro avistamento — registra e marca como novo
      db.prepare(`
        INSERT INTO known_devices (mac, ip, first_seen, last_seen, trusted)
        VALUES (?, ?, ?, ?, 0)
      `).run(mac, h.ip, now, now)
      newDevices.push({ mac, ip: h.ip })
    } else {
      // Já conhecido — atualiza ip e last_seen
      db.prepare('UPDATE known_devices SET ip = ?, last_seen = ? WHERE mac = ?').run(h.ip, now, mac)
    }
  }

  // Dispara webhook se houver novos dispositivos e webhook configurado
  if (newDevices.length > 0) {
    try {
      const settings = loadSettings()
      const webhookUrl = (settings as unknown as Record<string, unknown>).alertThresholds
        ? (settings as unknown as { alertThresholds: { webhookUrl?: string } }).alertThresholds?.webhookUrl
        : null
      if (webhookUrl) {
        const msg = newDevices.length === 1
          ? `Novo dispositivo detectado na rede: ${newDevices[0].ip} (${newDevices[0].mac})`
          : `${newDevices.length} novos dispositivos detectados na rede: ${newDevices.map(d => d.ip).join(', ')}`
        fetch('/api/alerts/webhook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ webhookUrl, message: msg }),
        }).catch(() => {})
      }
    } catch { /* webhook é best-effort */ }
  }

  return NextResponse.json({ newDevices, total: hosts.length })
}
