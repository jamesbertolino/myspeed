import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

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
  score: number
  scoreLabel: string
  recommendations: Array<{ priority: 'high' | 'medium' | 'low'; title: string; detail: string }>
  bestChannel24: number
  bestChannel5: number
  congestion24: 'low' | 'medium' | 'high'
  congestion5: 'low' | 'medium' | 'high'
  securityIssues: Array<{ ssid: string; issue: string; severity: 'critical' | 'high' | 'medium' | 'low' }>
}

function buildPrompt(networks: WiFiNetwork[], connectedSsid?: string): string {
  const networksText = networks.map(n =>
    `- SSID: "${n.ssid}" | Canal: ${n.channel} | Banda: ${n.band} GHz | Sinal: ${n.signal} dBm | Largura: ${n.width ?? 20} MHz | Segurança: ${n.security ?? 'desconhecida'}${n.bssid ? ` | BSSID: ${n.bssid}` : ''}`
  ).join('\n')

  return `Você é um especialista em segurança de redes WiFi e RF (radiofrequência). Analise o ambiente WiFi detectado e forneça uma análise técnica completa em português brasileiro.

Redes detectadas (${networks.length} total):
${networksText}
${connectedSsid ? `\nRede conectada pelo usuário: "${connectedSsid}"` : ''}

Responda EXCLUSIVAMENTE com JSON válido (sem markdown externo):
{
  "summary": "Resumo executivo de 2-3 frases sobre saúde e segurança do ambiente WiFi",
  "score": <0-100>,
  "scoreLabel": "<'Excelente'|'Bom'|'Regular'|'Ruim'>",
  "recommendations": [
    {
      "priority": "<'high'|'medium'|'low'>",
      "title": "Título curto",
      "detail": "Ação técnica específica com configurações recomendadas"
    }
  ],
  "bestChannel24": <canal ideal 2.4 GHz: 1, 6 ou 11>,
  "bestChannel5": <canal ideal 5 GHz: 36, 40, 44, 48, 149, 153, 157, 161 ou 165>,
  "congestion24": "<'low'|'medium'|'high'>",
  "congestion5": "<'low'|'medium'|'high'>",
  "securityIssues": [
    {
      "ssid": "nome da rede",
      "issue": "Descrição do problema de segurança (ex: WEP obsoleto, rede aberta, SSID oculto ineficaz)",
      "severity": "<'critical'|'high'|'medium'|'low'>"
    }
  ]
}

Analise: sobreposição de canais, redes abertas ou com WEP/WPA, força do sinal, interferência, densidade de redes, SSIDs suspeitos (evil twin, redes homônimas), configurações de segurança fracas.`
}

async function callClaude(prompt: string, apiKey: string): Promise<AIAnalysis> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!response.ok) throw new Error(`Anthropic ${response.status}: ${await response.text()}`)
  const data = await response.json()
  const content = data.content?.[0]?.text ?? ''
  try { return JSON.parse(content) } catch {
    return JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim())
  }
}

async function callOpenAI(prompt: string, apiKey: string): Promise<AIAnalysis> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 2000,
    }),
  })
  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${await response.text()}`)
  const data = await response.json()
  const content = data.choices?.[0]?.message?.content ?? ''
  try { return JSON.parse(content) } catch {
    return JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim())
  }
}

export async function POST(req: NextRequest) {
  const body: AnalysisRequest = await req.json()
  const { networks, connectedSsid } = body
  if (!networks?.length) return NextResponse.json({ error: 'No networks provided' }, { status: 400 })

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY
  if (!anthropicKey && !openaiKey) return NextResponse.json({ error: 'Nenhuma chave de API configurada' }, { status: 503 })

  const prompt = buildPrompt(networks, connectedSsid)

  try {
    const analysis = anthropicKey ? await callClaude(prompt, anthropicKey) : await callOpenAI(prompt, openaiKey!)
    return NextResponse.json({ analysis })
  } catch (error) {
    if (anthropicKey && openaiKey) {
      try { return NextResponse.json({ analysis: await callOpenAI(prompt, openaiKey) }) } catch (_) {}
    }
    return NextResponse.json({ error: 'Análise falhou', detail: String(error) }, { status: 500 })
  }
}
