import { NextRequest } from 'next/server'

export const runtime = 'nodejs'

const SYSTEM_PROMPT = `Você é NetGuard AI, um assistente especializado em segurança de redes e infraestrutura, integrado ao MySpeed Network Analyzer. Você ajuda analistas de rede e profissionais de segurança a:

- Interpretar resultados de varredura de portas e identificar vulnerabilidades
- Analisar certificados SSL/TLS e configurações de segurança
- Verificar configurações de DNS (SPF, DMARC, DKIM, DNSSEC)
- Avaliar reputação de IPs e detectar ameaças
- Diagnosticar problemas de conectividade e latência
- Recomendar hardening de redes e sistemas
- Explicar CVEs, exploit técnicas e mitigações
- Interpretar logs e eventos de rede

Responda sempre em português brasileiro. Seja técnico mas claro. Use markdown para formatar respostas com listas, código e destaques. Para riscos críticos, destaque em **negrito**. Quando relevante, cite CVEs específicos, RFC's ou CIS Benchmarks.`

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY não configurada' }), { status: 503 })
  }

  const { messages, context } = await req.json()

  const systemWithContext = context
    ? `${SYSTEM_PROMPT}\n\n## Contexto atual da rede do usuário:\n${context}`
    : SYSTEM_PROMPT

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      stream: true,
      system: systemWithContext,
      messages,
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    return new Response(JSON.stringify({ error: err }), { status: response.status })
  }

  // Stream SSE from Anthropic to client
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6)
            if (data === '[DONE]') { controller.close(); return }
            try {
              const evt = JSON.parse(data)
              if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: evt.delta.text })}\n\n`))
              }
              if (evt.type === 'message_stop') { controller.close(); return }
            } catch { /* skip malformed */ }
          }
        }
        controller.close()
      } catch (e) {
        controller.error(e)
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
