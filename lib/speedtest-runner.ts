// Funções de medição reutilizáveis (usadas pelo teste manual e pelo agendado)

export interface SpeedtestResult {
  ping:     number
  jitter:   number
  download: number
  upload:   number
  server:   string
  auto:     boolean
}

const CF_DOWN = 'https://speed.cloudflare.com/__down'
const CF_UP   = 'https://speed.cloudflare.com/__up'

export async function measurePingIcmp(host: string, count = 5): Promise<{ ping: number; jitter: number }> {
  const res  = await fetch(`/api/speedtest/ping?target=${encodeURIComponent(host)}&count=${count}&_=${Date.now()}`, { cache: 'no-store' })
  const data = await res.json()
  return { ping: data.ping ?? -1, jitter: data.jitter ?? 0 }
}

export async function measureDownload(
  durationMs = 5000,
  chunkBytes = 10 * 1024 * 1024,
  onProgress?: (mbps: number) => void,
  signal?: AbortSignal
): Promise<number> {
  const start = performance.now()
  let total   = 0

  while (performance.now() - start < durationMs) {
    if (signal?.aborted) break
    const res    = await fetch(`${CF_DOWN}?bytes=${chunkBytes}&_=${Date.now()}`, { cache: 'no-store', signal })
    const reader = res.body!.getReader()
    while (true) {
      if (signal?.aborted) { reader.cancel(); break }
      const { done, value } = await reader.read()
      if (done) break
      total += value?.byteLength ?? 0
      const elapsed = (performance.now() - start) / 1000
      onProgress?.((total * 8) / (elapsed * 1e6))
      if (performance.now() - start >= durationMs) { reader.cancel(); break }
    }
    if (performance.now() - start >= durationMs) break
  }

  const elapsed = (performance.now() - start) / 1000
  return total > 0 ? (total * 8) / (elapsed * 1e6) : 0
}

export async function measureUpload(
  durationMs = 4000,
  chunkBytes = 3 * 1024 * 1024,
  onProgress?: (mbps: number) => void,
  signal?: AbortSignal
): Promise<number> {
  const chunk = new Uint8Array(chunkBytes)
  for (let i = 0; i < chunk.length; i += 65536)
    crypto.getRandomValues(chunk.subarray(i, Math.min(i + 65536, chunk.length)))
  const blob = new Blob([chunk])

  const start = performance.now()
  let total   = 0

  while (performance.now() - start < durationMs) {
    if (signal?.aborted) break
    const fd = new FormData()
    fd.append('file', blob, 'data.bin')
    await fetch(`${CF_UP}?_=${Date.now()}`, { method: 'POST', body: fd, cache: 'no-store', signal }).catch(() => {})
    total += chunkBytes
    const elapsed = (performance.now() - start) / 1000
    onProgress?.((total * 8) / (elapsed * 1e6))
    if (performance.now() - start >= durationMs) break
  }

  const elapsed = (performance.now() - start) / 1000
  return total > 0 ? (total * 8) / (elapsed * 1e6) : 0
}

export async function runAutoSpeedtest(signal?: AbortSignal): Promise<SpeedtestResult> {
  const { ping, jitter } = await measurePingIcmp('8.8.8.8', 5)
  if (signal?.aborted) throw new Error('aborted')

  const download = await measureDownload(5000, 10 * 1024 * 1024, undefined, signal)
  if (signal?.aborted) throw new Error('aborted')

  const upload = await measureUpload(4000, 3 * 1024 * 1024, undefined, signal)

  return { ping, jitter, download, upload, server: 'Cloudflare (auto)', auto: true }
}
