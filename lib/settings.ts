export interface PingTarget {
  label: string
  host: string   // IP, hostname, ou 'self'
}

export interface AppSettings {
  pingTargets: PingTarget[]
  pingInterval: number        // ms
  defaultServerId: string     // 'auto' | server id
  latencyChartSeconds: number // 30 | 60 | 120
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
}

const KEY = 'myspeed_settings'

export function loadSettings(): AppSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_SETTINGS
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(s: AppSettings) {
  localStorage.setItem(KEY, JSON.stringify(s))
}
