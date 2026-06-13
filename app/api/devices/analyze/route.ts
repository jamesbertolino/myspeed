import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

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
    cves?: string[]
  }>
  generalRecommendations: Array<{
    priority: string
    title: string
    detail: string
  }>
  attackVectors: Array<{
    vector: string
    description: string
    affectedDevices: string[]
  }>
}

const PORT_CVE_MAP: Record<number, { cves: string[]; notes: string }> = {
  21:    { cves: ['CVE-2010-4221', 'CVE-2011-0762'], notes: 'FTP transfere credenciais em texto claro' },
  23:    { cves: ['CVE-2020-10188', 'CVE-2023-39191'], notes: 'Telnet sem criptografia, múltiplos RCEs históricos' },
  80:    { cves: ['CVE-2021-41773', 'CVE-2021-42013'], notes: 'HTTP sem TLS; Apache path traversal se não atualizado' },
  135:   { cves: ['CVE-2003-0352', 'CVE-2021-31166'], notes: 'MS-RPC historicamente explorado por MS03-026 (Blaster worm)' },
  139:   { cves: ['CVE-2017-0144', 'CVE-2017-0145'], notes: 'SMBv1 vulnerável ao EternalBlue (WannaCry/NotPetya)' },
  445:   { cves: ['CVE-2017-0144', 'CVE-2020-0796'], notes: 'SMB – EternalBlue e SMBGhost; desabilitar SMBv1 imediatamente' },
  1433:  { cves: ['CVE-2020-0618', 'CVE-2023-21705'], notes: 'SQL Server exposto — injeções e acesso direto ao banco' },
  1723:  { cves: ['CVE-2010-0842'], notes: 'PPTP VPN com criptografia quebrada (MS-CHAPv2)' },
  3306:  { cves: ['CVE-2012-2122', 'CVE-2021-27928'], notes: 'MySQL sem firewall — risco crítico de exfiltração de dados' },
  3389:  { cves: ['CVE-2019-0708', 'CVE-2022-21990'], notes: 'RDP — BlueKeep e ataques de força bruta frequentes; use NLA + MFA' },
  4444:  { cves: ['CVE-2003-0210'], notes: 'Porta clássica de backdoor/reverse shell (Metasploit default)' },
  5432:  { cves: ['CVE-2019-9193', 'CVE-2021-20229'], notes: 'PostgreSQL exposto — arbitrary code execution via COPY TO/FROM' },
  5900:  { cves: ['CVE-2015-5239', 'CVE-2019-15681'], notes: 'VNC com senhas fracas; LibVNCServer RCE' },
  5985:  { cves: ['CVE-2021-31166'], notes: 'WinRM exposto — movimento lateral em ambientes Windows' },
  6379:  { cves: ['CVE-2022-0543', 'CVE-2023-28425'], notes: 'Redis sem auth — RCE via Lua scripting, acesso irrestrito a dados' },
  8080:  { cves: ['CVE-2021-44228'], notes: 'HTTP-alt; se for Tomcat/Log4j, Log4Shell crítico' },
  9200:  { cves: ['CVE-2015-1427', 'CVE-2021-22145'], notes: 'Elasticsearch sem auth — exfiltração massiva de dados' },
  27017: { cves: ['CVE-2013-4650', 'CVE-2019-2392'], notes: 'MongoDB sem auth — dados expostos publicamente (Shodan)' },
}

function buildPrompt(devices: Device[]): string {
  const deviceLines = devices.map(d => {
    const ports = d.openPorts.length
      ? d.openPorts.map(p => {
          const cveInfo = PORT_CVE_MAP[p.port]
          return `    - ${p.service} (porta ${p.port}, risco: ${p.risk})${cveInfo ? ` [CVEs: ${cveInfo.cves.slice(0,2).join(', ')}]` : ''}`
        }).join('\n')
      : '    - Sem portas abertas detectadas'
    const label = [d.ip, d.vendor && `[${d.vendor}]`, d.hostname && `(${d.hostname})`].filter(Boolean).join(' ')
    return `  • ${label}\n    Risco geral: ${d.riskLevel}\n    Portas abertas:\n${ports}`
  }).join('\n\n')

  return `Você é um especialista sênior em cibersegurança e pentest de redes corporativas. Analise o inventário de dispositivos detectados na rede local e produza uma análise de segurança profissional, completa e acionável em português brasileiro.

== INVENTÁRIO DA REDE (${devices.length} dispositivos) ==
${deviceLines}

Responda EXCLUSIVAMENTE com JSON válido (sem markdown externo) neste formato:
{
  "score": <0-100, onde 100 é rede totalmente segura>,
  "scoreLabel": "<'Excelente'|'Bom'|'Regular'|'Crítico'>",
  "summary": "Resumo executivo de 3-4 frases sobre a postura de segurança: pontos críticos, superfície de ataque e impacto potencial para o negócio",
  "risks": [
    {
      "deviceIp": "IP do dispositivo",
      "severity": "<'critical'|'high'|'medium'|'low'>",
      "title": "Nome curto do risco (ex: RDP exposto sem NLA)",
      "detail": "Explicação técnica: o que está vulnerável, como pode ser explorado, qual o impacto real (ex: ransomware, movimento lateral, exfiltração)",
      "fix": "Passos práticos e específicos para remediar: comandos, configurações, ferramentas recomendadas",
      "cves": ["CVE-XXXX-XXXXX"]
    }
  ],
  "generalRecommendations": [
    {
      "priority": "<'high'|'medium'|'low'>",
      "title": "Ação recomendada",
      "detail": "Implementação detalhada com referências a frameworks (CIS Benchmark, NIST, ISO 27001) quando aplicável"
    }
  ],
  "attackVectors": [
    {
      "vector": "Nome do vetor de ataque (ex: Propagação via SMB)",
      "description": "Como um atacante encadearia os achados para comprometer a rede",
      "affectedDevices": ["IP1", "IP2"]
    }
  ]
}

Regras:
- Priorize risks críticos e altos primeiro
- Cite CVEs reais e relevantes
- Em attackVectors, descreva cenários de ataque encadeados realistas (ex: lateral movement, ransomware spread)
- Seja específico e técnico, evite respostas genéricas
- generalRecommendations deve incluir segmentação de rede, patch management e monitoramento`
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
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
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
  const { devices }: { devices: Device[] } = await req.json()
  if (!devices?.length) return NextResponse.json({ error: 'Nenhum dispositivo fornecido' }, { status: 400 })

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY
  if (!anthropicKey && !openaiKey) return NextResponse.json({ error: 'Nenhuma chave de API de IA configurada' }, { status: 503 })

  const prompt = buildPrompt(devices)

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
