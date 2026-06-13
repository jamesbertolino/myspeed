import { NextRequest, NextResponse } from 'next/server'

interface OpenPort {
  port: number
  service: string
  risk: string
}

interface Device {
  ip: string
  mac: string | null
  vendor: string | null
  hostname: string | null
  openPorts: OpenPort[]
  riskLevel: string
}

interface AIAnalysis {
  score: number
  scoreLabel: string
  summary: string
  risks: Array<{
    deviceIp: string
    severity: string
    title: string
    detail: string
    fix: string
  }>
  generalRecommendations: Array<{
    priority: string
    title: string
    detail: string
  }>
}

function buildPrompt(devices: Device[]): string {
  const deviceLines = devices.map(d => {
    const ports = d.openPorts.length
      ? d.openPorts.map(p => `${p.service}:${p.port}(${p.risk})`).join(', ')
      : 'nenhuma porta aberta'
    const label = d.vendor ? `${d.ip} [${d.vendor}]` : d.ip
    return `  • ${label} — Risco: ${d.riskLevel} — Portas: ${ports}`
  }).join('\n')

  return `Você é um especialista em segurança de redes. Analise os dispositivos detectados na rede local e identifique vulnerabilidades de segurança, fornecendo orientações práticas de correção em português brasileiro.

Dispositivos detectados (${devices.length}):
${deviceLines}

Responda EXCLUSIVAMENTE com JSON válido (sem markdown) neste formato:
{
  "score": <0-100, onde 100 é rede totalmente segura>,
  "scoreLabel": "<'Excelente'|'Bom'|'Regular'|'Crítico'>",
  "summary": "Resumo executivo em 2-3 frases sobre a postura de segurança da rede",
  "risks": [
    {
      "deviceIp": "IP do dispositivo afetado",
      "severity": "<'critical'|'high'|'medium'|'low'>",
      "title": "Nome curto do risco (ex: Telnet sem criptografia)",
      "detail": "Explicação técnica do risco e por que é perigoso",
      "fix": "Como corrigir este problema específico, com passos práticos"
    }
  ],
  "generalRecommendations": [
    {
      "priority": "<'high'|'medium'|'low'>",
      "title": "Título da recomendação",
      "detail": "Ação recomendada detalhada"
    }
  ]
}

Inclua apenas riscos reais baseados nas portas abertas. Ordene risks por severidade (critical primeiro).`
}

async function callAnthropic(prompt: string, apiKey: string): Promise<AIAnalysis> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!response.ok) throw new Error(`Anthropic ${response.status}: ${await response.text()}`)
  const data = await response.json()
  const content = data.content?.[0]?.text ?? ''
  try {
    return JSON.parse(content)
  } catch {
    return JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim())
  }
}

async function callOpenAI(prompt: string, apiKey: string): Promise<AIAnalysis> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 1500,
    }),
  })
  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${await response.text()}`)
  const data = await response.json()
  const content = data.choices?.[0]?.message?.content ?? ''
  try {
    return JSON.parse(content)
  } catch {
    return JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim())
  }
}

export async function POST(req: NextRequest) {
  const { devices }: { devices: Device[] } = await req.json()

  if (!devices?.length) {
    return NextResponse.json({ error: 'Nenhum dispositivo fornecido' }, { status: 400 })
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY

  if (!anthropicKey && !openaiKey) {
    return NextResponse.json({ error: 'Nenhuma chave de API de IA configurada' }, { status: 503 })
  }

  const prompt = buildPrompt(devices)

  try {
    let analysis: AIAnalysis

    if (anthropicKey) {
      analysis = await callAnthropic(prompt, anthropicKey)
    } else {
      analysis = await callOpenAI(prompt, openaiKey!)
    }

    return NextResponse.json({ analysis })
  } catch (error) {
    // Try the other provider as fallback
    if (anthropicKey && openaiKey) {
      try {
        const analysis = await callOpenAI(prompt, openaiKey)
        return NextResponse.json({ analysis })
      } catch (_) {}
    }
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: 'Análise falhou', detail: msg }, { status: 500 })
  }
}
