'use client'

import { useEffect, useState, useRef } from 'react'
import { Printer, RefreshCw, Copy, Check, FileText, AlertTriangle, Zap } from 'lucide-react'

interface SlaData {
  overallPct: number; dlPct: number; ulPct: number
  avgDl: number; avgUl: number; avgPing: number
  minDl: number; minUl: number; maxPing: number
  daysOk: number; daysBad: number
  daily: { day: string; avgDl: number; avgUl: number; avgPing: number; slaOk: number }[]
}
interface AlertRow { ts: number; type: string; message: string }

function fmtTs(ts: number) {
  return new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function ComplaintPage() {
  const [sla, setSla] = useState<SlaData | null>(null)
  const [alerts, setAlerts] = useState<AlertRow[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [generatedAt] = useState(() => new Date().toLocaleString('pt-BR'))
  const [contractedDl, setContractedDl] = useState(0)
  const [contractedUl, setContractedUl] = useState(0)
  const [ispName, setIspName] = useState('')
  const [clientName, setClientName] = useState('')
  const [clientCpf, setClientCpf] = useState('')
  const [clientContract, setClientContract] = useState('')
  const [clientAddress, setClientAddress] = useState('')
  const textRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem('myspeed_settings')
      if (raw) {
        const s = JSON.parse(raw)
        setContractedDl(s.contractedDownload ?? 0)
        setContractedUl(s.contractedUpload ?? 0)
      }
      const saved = localStorage.getItem('myspeed_complaint_info')
      if (saved) {
        const i = JSON.parse(saved)
        setIspName(i.ispName ?? '')
        setClientName(i.clientName ?? '')
        setClientCpf(i.clientCpf ?? '')
        setClientContract(i.clientContract ?? '')
        setClientAddress(i.clientAddress ?? '')
      }
    } catch { /* */ }

    Promise.all([
      fetch('/api/history/sla?days=30').then(r => r.json()),
      fetch('/api/history/alerts?limit=100').then(r => r.json()),
    ]).then(([sl, al]) => {
      setSla(sl.sla)
      setAlerts(al.rows ?? [])
    }).finally(() => setLoading(false))
  }, [])

  const saveInfo = () => {
    try {
      localStorage.setItem('myspeed_complaint_info', JSON.stringify({ ispName, clientName, clientCpf, clientContract, clientAddress }))
    } catch { /* */ }
  }

  // Violation days
  const badDays = sla?.daily?.filter(d => !d.slaOk) ?? []
  const speedViolations = alerts.filter(a => a.type.includes('download') || a.type.includes('upload') || a.type.includes('speed'))
  const latencyViolations = alerts.filter(a => a.type.includes('ping') || a.type.includes('latency'))

  const genComplaint = (): string => {
    const today = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
    const slaLine = sla ? `${sla.overallPct}% dos dias monitorados` : 'não calculado'
    const dlLine = contractedDl > 0 && sla ? `${sla.avgDl.toFixed(1)} Mbps (contratado: ${contractedDl} Mbps, aproveitamento: ${((sla.avgDl / contractedDl) * 100).toFixed(0)}%)` : sla ? `${sla.avgDl.toFixed(1)} Mbps` : 'não disponível'
    const ulLine = contractedUl > 0 && sla ? `${sla.avgUl.toFixed(1)} Mbps (contratado: ${contractedUl} Mbps, aproveitamento: ${((sla.avgUl / contractedUl) * 100).toFixed(0)}%)` : sla ? `${sla.avgUl.toFixed(1)} Mbps` : 'não disponível'

    const badDayLines = badDays.slice(0, 10).map(d =>
      `  - ${d.day}: Download médio ${d.avgDl.toFixed(1)} Mbps, Upload ${d.avgUl.toFixed(1)} Mbps, Ping ${d.avgPing.toFixed(0)} ms`
    ).join('\n')

    return `RECLAMAÇÃO FORMAL — DESCUMPRIMENTO DE CONTRATO DE INTERNET
${'='.repeat(62)}

Reclamante: ${clientName || '[SEU NOME COMPLETO]'}
CPF/CNPJ: ${clientCpf || '[SEU CPF OU CNPJ]'}
Endereço do serviço: ${clientAddress || '[ENDEREÇO ONDE O SERVIÇO É PRESTADO]'}
Número do contrato/linha: ${clientContract || '[NÚMERO DO CONTRATO OU DA LINHA]'}

Destinatário: ${ispName || '[NOME DA OPERADORA]'}
Data: ${today}

ASSUNTO: Descumprimento dos parâmetros de qualidade de serviço previstos em contrato e na Resolução Anatel nº 574/2011 e nº 680/2017 (SCM).

---

RELATO DOS FATOS

O(a) reclamante é cliente de serviço de banda larga com plano contratado de ${contractedDl > 0 ? `${contractedDl} Mbps de download e ${contractedUl} Mbps de upload` : '[VELOCIDADE CONTRATADA]'}.

Nos últimos 30 dias, foram realizadas medições sistemáticas de velocidade, latência e disponibilidade, utilizando ferramentas de monitoramento contínuo registradas localmente. Os dados coletados demonstram descumprimento reiterado dos parâmetros de qualidade mínima estabelecidos contratualmente e pela regulamentação da Anatel.

---

EVIDÊNCIAS COLETADAS (sistema MySpeed — ${generatedAt})

1. VELOCIDADE MÉDIA VERIFICADA
   - Download médio: ${dlLine}
   - Upload médio: ${ulLine}
   - Ping médio: ${sla ? `${sla.avgPing.toFixed(0)} ms` : 'não disponível'}
   - Pior download registrado: ${sla ? `${sla.minDl.toFixed(1)} Mbps` : '—'}
   - Pior ping registrado: ${sla ? `${sla.maxPing.toFixed(0)} ms` : '—'}

2. CONFORMIDADE COM SLA (30 dias)
   - Taxa de conformidade geral: ${slaLine}
   - Dias em conformidade: ${sla?.daysOk ?? '—'}
   - Dias abaixo do mínimo: ${sla?.daysBad ?? '—'}
${badDays.length > 0 ? `\n   Dias com violação registrada:\n${badDayLines}` : ''}

3. ALERTAS DE DEGRADAÇÃO
   - Total de alertas registrados: ${alerts.length}
   - Violações de velocidade: ${speedViolations.length} eventos
   - Violações de latência: ${latencyViolations.length} eventos
${alerts.slice(0, 5).map(a => `   - ${fmtTs(a.ts)}: ${a.message}`).join('\n')}
${alerts.length > 5 ? `   (... e mais ${alerts.length - 5} eventos registrados)` : ''}

---

FUNDAMENTAÇÃO LEGAL

A Resolução Anatel nº 574/2011 (Regulamento de Gestão da Qualidade do Serviço de Comunicação Multimídia) estabelece que as prestadoras devem garantir ao usuário no mínimo 80% da velocidade contratada. O art. 9º da Resolução nº 680/2017 reforça os critérios de qualidade e as penalidades por descumprimento.

O art. 22 do Código de Defesa do Consumidor (Lei 8.078/1990) determina que os serviços essenciais devem ser prestados de forma adequada, eficiente, segura e contínua.

---

PEDIDOS

Diante do exposto, o(a) reclamante requer:

1. Que a prestadora apresente justificativa técnica formal para as degradações documentadas, no prazo de 5 (cinco) dias úteis;

2. Que sejam tomadas providências imediatas para a normalização do serviço dentro dos parâmetros contratados;

3. Que seja concedido desconto proporcional na fatura do período em que o serviço foi prestado de forma inadequada, correspondendo a ${sla?.daysBad ?? '?'} dia(s) de descumprimento;

4. Que, em caso de não resolução no prazo, o presente documento seja protocolado junto à ANATEL (www.anatel.gov.br/consumidor — formulário de reclamação) e ao PROCON local;

5. Reserva-se o direito de solicitar rescisão contratual sem multa, com fundamento no art. 35, inciso V, do CDC, caso as obrigações não sejam cumpridas.

---

Documentação completa disponível mediante solicitação.

${clientName || '[NOME DO RECLAMANTE]'}
${clientCpf || '[CPF/CNPJ]'}
${clientAddress || '[ENDEREÇO]'}

Gerado automaticamente pelo sistema MySpeed Network Analyzer — dados coletados localmente, nenhuma informação enviada a terceiros.`
  }

  const complaint = (!loading && sla) ? genComplaint() : ''

  const copyText = () => {
    navigator.clipboard.writeText(complaint).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Toolbar */}
      <div className="print:hidden sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center">
            <FileText className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-bold text-gray-800">Gerador de Reclamação — Anatel / Operadora</span>
        </div>
        <div className="flex gap-2">
          {complaint && (
            <button onClick={copyText} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-100 transition-colors">
              {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copiado!' : 'Copiar texto'}
            </button>
          )}
          <button onClick={() => window.print()} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700 transition-colors">
            <Printer className="w-4 h-4" /> Imprimir / PDF
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="border-b-2 border-gray-900 pb-4">
          <h1 className="text-2xl font-black">Gerador de Reclamação Formal</h1>
          <p className="text-sm text-gray-500 mt-1">Usa seus dados reais de velocidade e alertas para gerar uma petição pronta para protocolar na Anatel ou enviar à operadora.</p>
        </div>

        {/* Status banner */}
        {loading ? (
          <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 text-sm text-gray-500">
            <RefreshCw className="w-4 h-4 animate-spin" /> Carregando seus dados de SLA e alertas...
          </div>
        ) : !sla ? (
          <div className="flex items-start gap-3 p-4 bg-orange-50 rounded-lg border border-orange-200 text-sm text-orange-700">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">Dados de SLA insuficientes</p>
              <p>Configure a velocidade contratada em Configurações e rode alguns speedtests para gerar evidências sólidas.</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'SLA geral', value: `${sla.overallPct}%`, bad: sla.overallPct < 80 },
              { label: 'Download médio', value: `${sla.avgDl.toFixed(1)} Mbps`, bad: contractedDl > 0 && sla.avgDl < contractedDl * 0.8 },
              { label: 'Dias ruins', value: `${sla.daysBad} dias`, bad: sla.daysBad > 2 },
              { label: 'Alertas', value: `${alerts.length}`, bad: alerts.length > 5 },
            ].map(c => (
              <div key={c.label} className={`border rounded-lg p-3 ${c.bad ? 'border-red-200 bg-red-50' : 'border-gray-200'}`}>
                <p className="text-xs text-gray-500">{c.label}</p>
                <p className={`text-xl font-black ${c.bad ? 'text-red-600' : 'text-gray-900'}`}>{c.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Info form */}
        <div className="print:hidden bg-gray-50 rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="text-sm font-bold text-gray-700">Seus dados (aparecem na reclamação)</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { label: 'Seu nome completo', value: clientName, set: setClientName, placeholder: 'João Silva' },
              { label: 'CPF ou CNPJ', value: clientCpf, set: setClientCpf, placeholder: '000.000.000-00' },
              { label: 'Nome da operadora', value: ispName, set: setIspName, placeholder: 'Claro, Vivo, TIM...' },
              { label: 'Número do contrato', value: clientContract, set: setClientContract, placeholder: 'Consta na fatura' },
            ].map(f => (
              <div key={f.label}>
                <label className="text-xs text-gray-500 mb-1 block">{f.label}</label>
                <input
                  value={f.value}
                  onChange={e => { f.set(e.target.value); saveInfo() }}
                  placeholder={f.placeholder}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-500"
                />
              </div>
            ))}
            <div className="sm:col-span-2">
              <label className="text-xs text-gray-500 mb-1 block">Endereço do serviço</label>
              <input
                value={clientAddress}
                onChange={e => { setClientAddress(e.target.value); saveInfo() }}
                placeholder="Rua, número, bairro, cidade — UF"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-500"
              />
            </div>
          </div>
          {contractedDl === 0 && (
            <p className="text-xs text-orange-600 flex items-center gap-1">
              <Zap className="w-3 h-3" /> Configure a velocidade contratada em <strong>Configurações → Velocidade Contratada</strong> para incluir os percentuais de cumprimento.
            </p>
          )}
        </div>

        {/* Generated complaint */}
        {complaint && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold text-gray-700">Texto da Reclamação (editável)</h2>
              <button onClick={copyText} className="print:hidden flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors">
                {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
            <textarea
              ref={textRef}
              value={complaint}
              readOnly
              rows={40}
              className="w-full border border-gray-200 rounded-xl p-4 text-xs font-mono text-gray-800 bg-white resize-y outline-none"
            />
            <p className="text-xs text-gray-400 mt-2 print:hidden">
              Dica: Protocole em <strong>consumidor.anatel.gov.br</strong> → "Reclamar de Serviço" → "Banda Larga Fixa" e anexe capturas de tela do sistema MySpeed como evidência adicional.
            </p>
          </div>
        )}
      </div>

      <style>{`
        @media print {
          body { background: white !important; }
          @page { margin: 2cm; }
          textarea { border: none !important; resize: none; height: auto !important; }
        }
      `}</style>
    </div>
  )
}
