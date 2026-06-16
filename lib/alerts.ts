import { AlertThresholds } from './settings'

export type AlertType = 'ping' | 'packet_loss' | 'download' | 'upload'

export interface AlertEvent {
  type:    AlertType
  value:   number
  threshold: number
  message: string
}

// cooldown por tipo: guarda o timestamp do último alerta disparado
const lastFired: Partial<Record<AlertType, number>> = {}

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const result = await Notification.requestPermission()
  return result === 'granted'
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission
}

function canFire(type: AlertType, cooldownMs: number): boolean {
  const last = lastFired[type]
  if (!last) return true
  return Date.now() - last >= cooldownMs
}

function fire(event: AlertEvent, cooldownMs: number, webhookUrl?: string) {
  lastFired[event.type] = Date.now()

  // browser notification
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    const icons: Record<AlertType, string> = {
      ping:        '⚠️',
      packet_loss: '📦',
      download:    '⬇️',
      upload:      '⬆️',
    }
    new Notification(`MySpeed — ${icons[event.type]} Alerta de Rede`, {
      body: event.message,
      icon: '/favicon.ico',
      tag:  event.type, // agrupa notificações do mesmo tipo
    })
  }

  // persiste no log (fire-and-forget)
  fetch('/api/history/alerts', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ type: event.type, value: event.value, threshold: event.threshold, message: event.message }),
  }).catch(() => {})

  // webhook externo (Discord/Slack/genérico) — chega mesmo sem permissão de notificação do browser
  if (webhookUrl) {
    fetch('/api/alerts/webhook', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ webhookUrl, message: event.message }),
    }).catch(() => {})
  }
}

export function checkAlerts(
  thresholds: AlertThresholds,
  metrics: {
    pingMs?:        number | null
    packetLossPct?: number
    downloadMbps?:  number
    uploadMbps?:    number
  }
) {
  if (!thresholds.enabled) return

  const cooldownMs = thresholds.cooldownMinutes * 60_000

  if (thresholds.pingMs > 0 && metrics.pingMs != null && metrics.pingMs > thresholds.pingMs) {
    if (canFire('ping', cooldownMs)) {
      fire({
        type: 'ping', value: metrics.pingMs, threshold: thresholds.pingMs,
        message: `Latência elevada: ${metrics.pingMs}ms (limite: ${thresholds.pingMs}ms)`,
      }, cooldownMs, thresholds.webhookUrl)
    }
  }

  if (thresholds.packetLossPct > 0 && metrics.packetLossPct != null && metrics.packetLossPct > thresholds.packetLossPct) {
    if (canFire('packet_loss', cooldownMs)) {
      fire({
        type: 'packet_loss', value: metrics.packetLossPct, threshold: thresholds.packetLossPct,
        message: `Perda de pacotes: ${metrics.packetLossPct.toFixed(1)}% (limite: ${thresholds.packetLossPct}%)`,
      }, cooldownMs, thresholds.webhookUrl)
    }
  }

  if (thresholds.downloadMbps > 0 && metrics.downloadMbps != null && metrics.downloadMbps < thresholds.downloadMbps) {
    if (canFire('download', cooldownMs)) {
      fire({
        type: 'download', value: metrics.downloadMbps, threshold: thresholds.downloadMbps,
        message: `Download abaixo do mínimo: ${metrics.downloadMbps.toFixed(1)} Mbps (mínimo: ${thresholds.downloadMbps} Mbps)`,
      }, cooldownMs, thresholds.webhookUrl)
    }
  }

  if (thresholds.uploadMbps > 0 && metrics.uploadMbps != null && metrics.uploadMbps < thresholds.uploadMbps) {
    if (canFire('upload', cooldownMs)) {
      fire({
        type: 'upload', value: metrics.uploadMbps, threshold: thresholds.uploadMbps,
        message: `Upload abaixo do mínimo: ${metrics.uploadMbps.toFixed(1)} Mbps (mínimo: ${thresholds.uploadMbps} Mbps)`,
      }, cooldownMs, thresholds.webhookUrl)
    }
  }
}
