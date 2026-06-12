import { NextRequest } from 'next/server'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const sizeMB = Math.min(
    parseInt(request.nextUrl.searchParams.get('size') || '25', 10),
    100
  )
  const totalBytes = sizeMB * 1024 * 1024
  const chunkSize = 64 * 1024 // 64 KB

  const stream = new ReadableStream({
    async start(controller) {
      let written = 0
      // Pre-allocate a chunk buffer filled with pseudo-random bytes
      const buf = Buffer.alloc(chunkSize)
      for (let i = 0; i < chunkSize; i++) buf[i] = (i ^ 0xA5) & 0xFF

      while (written < totalBytes) {
        const toSend = Math.min(chunkSize, totalBytes - written)
        controller.enqueue(buf.subarray(0, toSend))
        written += toSend
        // Yield to event loop every 1 MB
        if (written % (1024 * 1024) === 0) {
          await new Promise(r => setTimeout(r, 0))
        }
      }
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(totalBytes),
      'Cache-Control': 'no-store, no-cache',
      'X-Test-Size': String(totalBytes),
    },
  })
}
