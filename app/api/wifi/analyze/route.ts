import { NextRequest, NextResponse } from 'next/server'

interface WiFiNetwork {
  ssid: string
  channel: number
  signal: number
  band: '2.4' | '5'
  width?: number
  security?: string
  bssid?: string
}

interface AnalysisRequest {
  networks: WiFiNetwork[]
  connectedSsid?: string
}

interface AIAnalysis {
  summary: string
  score: number          // 0-100 WiFi environment health
  scoreLabel: string
  recommendations: Array<{
    priority: 'high' | 'medium' | 'low'
    title: string
    detail: string
  }>
  bestChannel24: number
  bestChannel5: number
  congestion24: 'low' | 'medium' | 'high'
  congestion5: 'low' | 'medium' | 'high'
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 503 })
  }

  const body: AnalysisRequest = await req.json()
  const { networks, connectedSsid } = body

  if (!networks?.length) {
    return NextResponse.json({ error: 'No networks provided' }, { status: 400 })
  }

  const networksText = networks.map(n =>
    `- SSID: "${n.ssid}" | Canal: ${n.channel} | Banda: ${n.band} GHz | Sinal: ${n.signal} dBm | Largura: ${n.width ?? 20} MHz${n.security ? ` | Segurança: ${n.security}` : ''}`
  ).join('\n')

  const prompt = `Você é um especialista em redes WiFi. Analise os dados das redes WiFi detectadas e forneça uma análise técnica detalhada em português brasileiro.

Redes detectadas (${networks.length} total):
${networksText}
${connectedSsid ? `\nRede conectada: "${connectedSsid}"` : ''}

Responda EXCLUSIVAMENTE com um JSON válido no seguinte formato (sem markdown, sem explicações fora do JSON):
{
  "summary": "Resumo executivo da situação WiFi em 2-3 frases",
  "score": <número 0-100 representando a saúde geral do ambiente WiFi>,
  "scoreLabel": "<'Excelente'|'Bom'|'Regular'|'Ruim'>",
  "recommendations": [
    {
      "priority": "<'high'|'medium'|'low'>",
      "title": "Título curto da recomendação",
      "detail": "Explicação técnica detalhada com ação específica"
    }
  ],
  "bestChannel24": <melhor canal livre no 2.4 GHz (1, 6 ou 11)>,
  "bestChannel5": <melhor canal livre no 5 GHz (36, 40, 44, 48, 149, 153, 157, 161 ou 165)>,
  "congestion24": "<'low'|'medium'|'high'>",
  "congestion5": "<'low'|'medium'|'high'>"
}`

  try {
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
        max_tokens: 1000,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      return NextResponse.json({ error: 'OpenAI API error', detail: err }, { status: 502 })
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content ?? ''

    let analysis: AIAnalysis
    try {
      analysis = JSON.parse(content)
    } catch {
      // GPT wrapped in markdown — strip fences and retry
      const clean = content.replace(/```json\n?|\n?```/g, '').trim()
      analysis = JSON.parse(clean)
    }

    return NextResponse.json({ analysis })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: 'Análise falhou', detail: msg }, { status: 500 })
  }
}
