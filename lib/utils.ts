export function formatSpeed(mbps: number): { value: string; unit: string } {
  if (mbps >= 1000) {
    return { value: (mbps / 1000).toFixed(2), unit: 'Gbps' }
  }
  if (mbps >= 1) {
    return { value: mbps.toFixed(1), unit: 'Mbps' }
  }
  return { value: (mbps * 1000).toFixed(0), unit: 'Kbps' }
}

export function formatLatency(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
  return `${ms.toFixed(1)}ms`
}

export function latencyColor(ms: number): string {
  if (ms <= 20) return '#00ff88'
  if (ms <= 50) return '#00d4ff'
  if (ms <= 100) return '#ffd700'
  if (ms <= 200) return '#ff8c00'
  return '#ff4d4d'
}

export function latencyLabel(ms: number): string {
  if (ms <= 20) return 'Excelente'
  if (ms <= 50) return 'Ótimo'
  if (ms <= 100) return 'Bom'
  if (ms <= 200) return 'Regular'
  return 'Ruim'
}

export function speedColor(mbps: number, type: 'download' | 'upload'): string {
  const thresholds = type === 'download'
    ? [100, 50, 25, 10]
    : [50, 20, 10, 5]
  if (mbps >= thresholds[0]) return '#00ff88'
  if (mbps >= thresholds[1]) return '#00d4ff'
  if (mbps >= thresholds[2]) return '#ffd700'
  if (mbps >= thresholds[3]) return '#ff8c00'
  return '#ff4d4d'
}

export function jitterLabel(ms: number): string {
  if (ms <= 5) return 'Excelente'
  if (ms <= 15) return 'Ótimo'
  if (ms <= 30) return 'Aceitável'
  if (ms <= 50) return 'Ruim'
  return 'Muito ruim'
}

export function jitterColor(ms: number): string {
  if (ms <= 5) return '#00ff88'
  if (ms <= 15) return '#00d4ff'
  if (ms <= 30) return '#ffd700'
  if (ms <= 50) return '#ff8c00'
  return '#ff4d4d'
}

export function calcJitter(samples: number[]): number {
  if (samples.length < 2) return 0
  let total = 0
  for (let i = 1; i < samples.length; i++) {
    total += Math.abs(samples[i] - samples[i - 1])
  }
  return total / (samples.length - 1)
}

export function calcPacketLoss(sent: number, received: number): number {
  if (sent === 0) return 0
  return ((sent - received) / sent) * 100
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(2)} MB`
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(2)} KB`
  return `${bytes} B`
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function getChannelFrequency(channel: number, band: '2.4' | '5'): number {
  if (band === '2.4') {
    if (channel === 14) return 2484
    return 2412 + (channel - 1) * 5
  }
  if (channel >= 36 && channel <= 64) return 5180 + (channel - 36) * 5
  if (channel >= 100 && channel <= 144) return 5500 + (channel - 100) * 5
  if (channel >= 149 && channel <= 177) return 5745 + (channel - 149) * 5
  return 0
}

export const CHANNELS_24GHZ = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
export const CHANNELS_5GHZ = [
  36, 40, 44, 48,
  52, 56, 60, 64,
  100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144,
  149, 153, 157, 161, 165,
]

export const NON_OVERLAPPING_24 = [1, 6, 11]
export const NON_OVERLAPPING_5 = [36, 40, 44, 48, 149, 153, 157, 161]
