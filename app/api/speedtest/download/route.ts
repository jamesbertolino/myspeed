import { NextRequest } from 'next/server'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  // If ?remote= is present, proxy the download from that URL.
  // This allows non-CORS external servers to be used as test targets.
  const remoteUrl = request.nextUrl.searchParams.get('remote')
  if (remoteUrl) {
    try {
      const upstream = await fetch(remoteUrl, {
        cache: 'no-store',
        signal: AbortSignal.timeout(30_000),
      })
      if (!upstream.ok || !upstream.body) {
        return new Response('upstream error', { status: 502 })
      }
      return new Response(upstream.body, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        },
      })
    } catch (e) {
      return new Response(String(e), { status: 502 })
    }
  }

  // Local random data generation (fallback / local dev)
  const sizeMB = Math.min(parseInt(request.nextUrl.searchParams.get('size') || '25', 10), 100)
  const totalBytes = sizeMB * 1024 * 1024
  const chunkSize = 64 * 1024

  const stream = new ReadableStream({
    async start(controller) {
      let written = 0
      const buf = Buffer.alloc(chunkSize)
      for (let i = 0; i < chunkSize; i++) buf[i] = (i ^ 0xA5) & 0xFF
      while (written < totalBytes) {
        controller.enqueue(buf.subarray(0, Math.min(chunkSize, totalBytes - written)))
        written += Math.min(chunkSize, totalBytes - written)
        if (written % (1024 * 1024) === 0) await new Promise(r => setTimeout(r, 0))
      }
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(totalBytes),
      'Cache-Control': 'no-store, no-cache',
    },
  })
}
