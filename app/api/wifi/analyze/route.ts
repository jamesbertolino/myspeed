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

interface OwnNetwork {
  ssid: string
  channel: number
  signal: number
  band: '2.4' | '5'
  bssid?: string
}

interface GhostEntry {
  bssid?: string
  channel: number
  signal: number
  reason: 'mac_prefix' | 'signal_proximity'
}

export interface AnalysisRequest {
  networks: WiFiNetwork[]           // lista bruta completa (incluindo ghosts)
  competitors: WiFiNetwork[]        // apenas concorrentes reais (sem own + sem ghosts)
  ownNetwork24?: OwnNetwork | null  // seu AP na banda 2.4GHz
  ownNetwork5?: OwnNetwork | null   // seu AP na banda 5GHz
  ghosts: GhostEntry[]              // hidden descartados como duplicidade do seu AP
  preComputedBestChannel24: number  // canal calculado deterministicamente
  preComputedBestChannel5: number
}

export interface AIAnalysis {
  summary: string
  score: number
  scoreLabel: string
  recommendations: Array<{ priority: 'high' | 'medium' | 'low'; title: string; detail: string }>
  bestChannel24: number
  bestChannel5: number
  channelReasoning24: string  // NOVO: explicação do porquê esse canal
  channelReasoning5: string   // NOVO
  preferredBand: '2.4' | '5' | 'both'  // NOVO: qual banda priorizar agora
  preferredBandReason: string           // NOVO: explicação
  congestion24: 'low' | 'medium' | 'high'
  congestion5: 'low' | 'medium' | 'high'
  securityIssues: Array<{ ssid: string; issue: string; severity: 'critical' | 'high' | 'medium' | 'low' }>
}

function signalQuality(dbm: number): string {
  if (dbm >= -50) return 'muito forte (dispositivo próximo)'
  if (dbm >= -65) return 'forte'
  if (dbm >= -75) return 'moderado'
  if (dbm >= -85) return 'fraco'
  return 'muito fraco (quase ruído de fundo)'
}

function buildPrompt(req: AnalysisRequest): string {
  const { networks, competitors, ownNetwork24, ownNetwork5, ghosts,
          preComputedBestChannel24, preComputedBestChannel5 } = req

  const fmtNet = (n: WiFiNetwork) =>
    `  • "${n.ssid}" | CH${n.channel} | ${n.band}GHz | ${n.signal}dBm (${signalQuality(n.signal)}) | ${n.width ?? 20}MHz${n.bssid ? ` | MAC:${n.bssid}` : ''} | seg:${n.security ?? '?'}`

  const own24text = ownNetwork24
    ? `"${ownNetwork24.ssid}" em CH${ownNetwork24.channel}, ${ownNetwork24.signal}dBm${ownNetwork24.bssid ? `, MAC:${ownNetwork24.bssid}` : ''}`
    : 'não detectado'
  const own5text = ownNetwork5
    ? `"${ownNetwork5.ssid}" em CH${ownNetwork5.channel}, ${ownNetwork5.signal}dBm${ownNetwork5.bssid ? `, MAC:${ownNetwork5.bssid}` : ''}`
    : 'não detectado'

  const comp24 = competitors.filter(n => n.band === '2.4')
  const comp5  = competitors.filter(n => n.band === '5')

  const ghostText = ghosts.length
    ? ghosts.map(g => `  • CH${g.channel} | ${g.signal}dBm | motivo:${g.reason === 'mac_prefix' ? 'mesmo prefixo MAC' : 'sinal idêntico ±3dBm'}`).join('\n')
    : '  (nenhuma)'

  // Agrupa concorrentes por canal para facilitar raciocínio do LLM
  const byChannel = (nets: WiFiNetwork[]) => {
    const map: Record<number, WiFiNetwork[]> = {}
    nets.forEach(n => { (map[n.channel] ??= []).push(n) })
    return Object.entries(map)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([ch, list]) => {
        const strongest = Math.max(...list.map(n => n.signal))
        return `    CH${ch}: ${list.length} rede(s), mais forte ${strongest}dBm (${signalQuality(strongest)})`
      }).join('\n')
  }

  return `Você é um engenheiro de RF especializado em WiFi. Analise o ambiente abaixo com rigor técnico e forneça recomendações práticas em português brasileiro.

═══ SEU ROTEADOR ═══
• 2.4GHz: ${own24text}
• 5GHz:   ${own5text}

═══ REDES HIDDEN DESCARTADAS (mesmo equipamento que o seu AP) ═══
${ghostText}

Estas redes hidden foram identificadas como radio secundário/IoT do próprio roteador (mesmo MAC prefix ou sinal idêntico no mesmo canal). NÃO interferem com vizinhos — são seu próprio AP transmitindo em múltiplos SSIDs/BSSIDs.

═══ CONCORRENTES REAIS — 2.4GHz (${comp24.length} redes) ═══
${comp24.length ? comp24.map(fmtNet).join('\n') : '  (banda vazia)'}

Densidade por canal (2.4GHz):
${byChannel(comp24) || '  (nenhum)'}

═══ CONCORRENTES REAIS — 5GHz (${comp5.length} redes) ═══
${comp5.length ? comp5.map(fmtNet).join('\n') : '  (banda vazia)'}

Densidade por canal (5GHz):
${byChannel(comp5) || '  (nenhum)'}

═══ TODOS OS SINAIS DETECTADOS (${networks.length} total incluindo seu AP e ghosts) ═══
${networks.map(fmtNet).join('\n')}

═══ CANAL PRÉ-CALCULADO (algoritmo local de interferência mínima) ═══
• 2.4GHz: CH${preComputedBestChannel24}
• 5GHz:   CH${preComputedBestChannel5}

Estes canais foram calculados pelo critério "mínima penalidade máxima" (pior interferência minimizada) excluindo redes hidden identificadas como próprias e o próprio AP. VALIDE se o raciocínio faz sentido com o ambiente acima e explique por quê.

═══ REGRAS DE ANÁLISE ═══
1. Canais não sobrepostos 2.4GHz: apenas 1, 6 e 11. Canal 8 ou 4 causa sobreposição com 6 e 11.
2. Para 5GHz prefira UNII-1 (36–48) ou UNII-3 (149–165) — mais estáveis, menos DFS.
3. Sinal < -85dBm é ruído de fundo e quase não interfere. Sinal > -70dBm interfere significativamente.
4. Largura de canal 80MHz em 2.4GHz é agressivo e causa sobreposição massiva — recomende 20MHz.
5. Redes hidden que mudaram de canal junto com o AP do usuário = mesmo dispositivo, NÃO vizinho.
6. Se 5GHz estiver pouco congestionada e o ambiente tiver muitos dispositivos, priorize 5GHz.

Responda EXCLUSIVAMENTE com JSON válido (sem markdown):
{
  "summary": "2-3 frases técnicas sobre o ambiente: densidade, qualidade, principais riscos",
  "score": <0-100>,
  "scoreLabel": "<'Excelente'|'Bom'|'Regular'|'Ruim'>",
  "preferredBand": "<'2.4'|'5'|'both'>",
  "preferredBandReason": "Por que usar esta banda prioritariamente agora, considerando congestionamento e ambiente",
  "bestChannel24": <1, 6 ou 11 — validado contra os dados acima>,
  "channelReasoning24": "Explique brevemente: quais canais estão ocupados, por quem, com que força, e por que este canal é o melhor",
  "bestChannel5": <36, 40, 44, 48, 149, 153, 157 ou 161>,
  "channelReasoning5": "Explique brevemente: mesma lógica para 5GHz",
  "congestion24": "<'low'|'medium'|'high'>",
  "congestion5": "<'low'|'medium'|'high'>",
  "recommendations": [
    {
      "priority": "<'high'|'medium'|'low'>",
      "title": "Título curto e acionável",
      "detail": "Ação específica com parâmetros: qual menu do roteador, qual valor configurar"
    }
  ],
  "securityIssues": [
    {
      "ssid": "nome da rede",
      "issue": "Problema de segurança específico",
      "severity": "<'critical'|'high'|'medium'|'low'>"
    }
  ]
}`
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
      max_tokens: 3000,
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
      temperature: 0.1,
      max_tokens: 3000,
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
  const { networks } = body
  if (!networks?.length) return NextResponse.json({ error: 'No networks provided' }, { status: 400 })

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY
  if (!anthropicKey && !openaiKey)
    return NextResponse.json({ error: 'Nenhuma chave de API configurada' }, { status: 503 })

  const prompt = buildPrompt(body)

  try {
    const analysis = anthropicKey
      ? await callClaude(prompt, anthropicKey)
      : await callOpenAI(prompt, openaiKey!)
    return NextResponse.json({ analysis })
  } catch (error) {
    if (anthropicKey && openaiKey) {
      try { return NextResponse.json({ analysis: await callOpenAI(prompt, openaiKey) }) } catch (_) {}
    }
    return NextResponse.json({ error: 'Análise falhou', detail: String(error) }, { status: 500 })
  }
}
