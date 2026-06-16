export interface PingTarget {
  label: string
  host: string   // IP, hostname, ou 'self'
}

export interface AlertThresholds {
  enabled:          boolean
  pingMs:           number   // alerta se ping > X ms (0 = desativado)
  packetLossPct:    number   // alerta se perda > X% (0 = desativado)
  downloadMbps:     number   // alerta se download < X Mbps (0 = desativado)
  uploadMbps:       number   // alerta se upload < X Mbps (0 = desativado)
  cooldownMinutes:  number   // intervalo mínimo entre alertas do mesmo tipo
  webhookUrl:       string   // URL de webhook (Discord/Slack/genérico) — '' = desativado
}

export interface AppSettings {
  pingTargets: PingTarget[]
  pingInterval: number        // ms
  defaultServerId: string     // 'auto' | server id
  latencyChartSeconds: number // 30 | 60 | 120
  ecgPingInterval: number     // segundos entre medições do monitor ECG (padrão: 10)
  ecgPitchDev: number         // desvio de pitch do beep em % (padrão: 20)
  alerts: AlertThresholds
  autoSpeedtest: number       // intervalo em horas (0 = desativado)
}

export const DEFAULT_ALERTS: AlertThresholds = {
  enabled:         true,
  pingMs:          150,
  packetLossPct:   5,
  downloadMbps:    0,
  uploadMbps:      0,
  cooldownMinutes: 5,
  webhookUrl:      '',
}

export const DEFAULT_SETTINGS: AppSettings = {
  pingTargets: [
    { label: 'Este servidor', host: 'self' },
    { label: 'Cloudflare',    host: '1.1.1.1' },
    { label: 'Google',        host: '8.8.8.8' },
  ],
  pingInterval: 1000,
  defaultServerId: 'auto',
  latencyChartSeconds: 60,
  ecgPingInterval: 10,
  ecgPitchDev: 20,
  alerts: DEFAULT_ALERTS,
  autoSpeedtest: 0,
}

const KEY = 'myspeed_settings'

export function loadSettings(): AppSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      alerts: { ...DEFAULT_ALERTS, ...(parsed.alerts ?? {}) },
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(s: AppSettings) {
  localStorage.setItem(KEY, JSON.stringify(s))
  window.dispatchEvent(new CustomEvent('myspeed-settings-changed'))
}
