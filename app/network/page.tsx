'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Activity, Search, Network, Play, Square, AlertTriangle,
  CheckCircle, Clock, Globe, ChevronRight, Loader2,
  Radar, Shield, ShieldAlert, ShieldCheck, ShieldOff,
  Terminal, Database, Lock, Server, Zap,
} from 'lucide-react'
import LatencyChart from '@/components/LatencyChart'
import { latencyColor, calcJitter, jitterColor, jitterLabel, latencyLabel } from '@/lib/utils'
import clsx from 'clsx'

interface PingPoint { t: number; latency: number }
interface TraceHop {
  hop: number
  host: string
  ip: string
  latency: number | null
  timeout: boolean
}

interface DnsResult {
  domain: string
  type: string
  records?: unknown[]
  A?: string[]
  MX?: unknown[]
  NS?: string[]
  TXT?: string[]
  elapsed: number
  error?: string
}

interface ScanPort {
  port: number
  service: string
  banner?: string
}

interface ScanResult {
  host: string
  ip: string
  open: ScanPort[]
  total: number
  scanned: number
}

interface SSLResult {
  host: string
  daysUntilExpiry: number
  expired: boolean
  selfSigned: boolean
  protocol: string
  grade: 'A+' | 'A' | 'B' | 'C' | 'F'
  issuer: Record<string, string>
  issues: Array<{ severity: string; message: string }>
  cipher: { name: string }
  error?: string
}

interface ThreatResult {
  ip: string
  ipInfo?: { country: string; org: string; city: string; region: string }
  isTor?: boolean
  listedCount?: number
  riskScore?: number
  riskLevel?: string
  dnsbl?: Array<{ name: string; listed: boolean; description: string }>
  flags?: string[]
  error?: string
}

type RiskLevel = 'critical' | 'high' | 'medium' | 'low' | 'info'

interface VulnInfo {
  risk: RiskLevel
  issues: string[]
  cves: string[]
  fix: string
}

const VULN_DB: Record<string, VulnInfo> = {
  'FTP': {
    risk: 'high',
    issues: ['Transmissão de credenciais em texto claro', 'Login anônimo frequentemente habilitado', 'Suscetível a ataques MITM'],
    cves: ['CVE-2011-3389'],
    fix: 'Substitua por SFTP (SSH) ou FTPS. Desabilite login anônimo.',
  },
  'Telnet': {
    risk: 'critical',
    issues: ['Protocolo obsoleto sem criptografia', 'Credenciais expostas em texto claro', 'Amplamente explorado por botnets'],
    cves: [],
    fix: 'Desabilite imediatamente. Substitua por SSH.',
  },
  'SSH': {
    risk: 'low',
    issues: ['Alvo constante de brute force', 'Versões antigas podem conter vulnerabilidades', 'Autenticação por senha é mais fraca que chaves'],
    cves: ['CVE-2023-38408', 'CVE-2023-48795'],
    fix: 'Use autenticação por chave pública. Implemente fail2ban. Desabilite login root.',
  },
  'SMTP': {
    risk: 'low',
    issues: ['Pode estar configurado como open relay', 'Usado para spam se mal configurado'],
    cves: [],
    fix: 'Verifique relay. Implemente SPF, DKIM e DMARC.',
  },
  'SMTP/TLS': {
    risk: 'info',
    issues: ['SMTP sobre TLS para envio seguro', 'Verifique se STARTTLS é obrigatório'],
    cves: [],
    fix: 'Configure STARTTLS obrigatório. Implemente DKIM e DMARC.',
  },
  'DNS': {
    risk: 'low',
    issues: ['Recursão aberta pode amplificar ataques DDoS', 'Transferência de zona pode expor registros internos'],
    cves: ['CVE-2023-50387'],
    fix: 'Desabilite recursão para externos. Restrinja transferência de zona. Implemente DNSSEC.',
  },
  'HTTP': {
    risk: 'medium',
    issues: ['Tráfego sem criptografia — interceptável', 'Credenciais expostas em redes intermediárias', 'Vulnerável a ataques de conteúdo misto'],
    cves: [],
    fix: 'Migre para HTTPS (443) com TLS 1.2+. Redirecione HTTP → HTTPS automaticamente.',
  },
  'HTTPS': {
    risk: 'info',
    issues: ['Verifique se o certificado é válido e atualizado', 'Certifique-se que TLS 1.0/1.1 e SSLv3 estão desabilitados'],
    cves: [],
    fix: 'Use TLS 1.2 ou 1.3. Renove certificado antes do vencimento. Habilite HSTS.',
  },
  'POP3': {
    risk: 'medium',
    issues: ['Protocolo de email sem criptografia', 'Credenciais expostas em texto claro'],
    cves: [],
    fix: 'Use POP3S (995) com TLS. Prefira IMAP/IMAPS para sincronização.',
  },
  'POP3S': {
    risk: 'info',
    issues: ['Verifique configuração do certificado SSL'],
    cves: [],
    fix: 'Certifique-se que TLS 1.2+ está em uso.',
  },
  'IMAP': {
    risk: 'medium',
    issues: ['Protocolo de email sem criptografia', 'Credenciais expostas'],
    cves: [],
    fix: 'Use IMAPS (993) com TLS.',
  },
  'IMAPS': {
    risk: 'info',
    issues: ['Verifique configuração do certificado SSL'],
    cves: [],
    fix: 'Certifique-se que TLS 1.2+ está em uso.',
  },
  'SMB': {
    risk: 'critical',
    issues: ['EternalBlue (MS17-010) — explorado pelo WannaCry e NotPetya', 'Permite execução remota de código sem autenticação', 'Vetor principal de ransomware'],
    cves: ['CVE-2017-0144', 'CVE-2017-0145', 'CVE-2020-0796'],
    fix: 'NUNCA exponha SMB à internet. Use VPN para acesso remoto. Aplique patches do Windows.',
  },
  'MSSQL': {
    risk: 'high',
    issues: ['Banco de dados exposto à internet', 'Autenticação sa (admin) com senhas fracas', 'xp_cmdshell pode permitir execução de comandos'],
    cves: ['CVE-2020-0618'],
    fix: 'Coloque atrás de firewall. Restrinja acesso por IP. Desabilite xp_cmdshell.',
  },
  'Oracle': {
    risk: 'high',
    issues: ['Banco de dados corporativo exposto', 'Histórico extenso de vulnerabilidades críticas'],
    cves: ['CVE-2012-1741'],
    fix: 'Proteja com firewall. Aplique patches Oracle regularmente.',
  },
  'NFS': {
    risk: 'high',
    issues: ['Compartilhamentos podem ser acessíveis sem autenticação', 'Permite leitura/escrita de arquivos remotamente'],
    cves: [],
    fix: 'Restrinja NFS à rede local. Use /etc/exports para limitar acesso por IP.',
  },
  'HTTP/Dev': {
    risk: 'medium',
    issues: ['Servidor de desenvolvimento exposto', 'Interfaces admin frequentemente sem autenticação', 'Pode expor código-fonte ou APIs internas'],
    cves: [],
    fix: 'Nunca exponha servidores de desenvolvimento. Use firewall ou VPN.',
  },
  'MySQL': {
    risk: 'high',
    issues: ['Banco de dados exposto diretamente à internet', 'Root com senha fraca é comum', 'Dados sensíveis sem proteção adequada'],
    cves: ['CVE-2012-2122', 'CVE-2016-6662'],
    fix: 'Bloqueie porta 3306 no firewall. Acesse apenas via túnel SSH ou VPN.',
  },
  'RDP': {
    risk: 'critical',
    issues: ['BlueKeep — wormable, sem autenticação necessária', 'Alvo principal de grupos de ransomware', 'Brute force automatizado constante'],
    cves: ['CVE-2019-0708', 'CVE-2019-1181', 'CVE-2019-1182'],
    fix: 'Nunca exponha RDP diretamente. Use VPN + NLA. Ative autenticação em dois fatores.',
  },
  'Shell/C2': {
    risk: 'critical',
    issues: ['⚠️ PORTA 4444 — POSSÍVEL BACKDOOR OU SHELL REVERSA', 'Tipicamente usada por frameworks de C2 (Metasploit, Cobalt Strike)', 'Sistema pode estar comprometido'],
    cves: [],
    fix: 'INVESTIGUE IMEDIATAMENTE. Isole o sistema. Conduza análise forense completa.',
  },
  'PostgreSQL': {
    risk: 'high',
    issues: ['Banco de dados exposto à internet', 'Autenticação trust pode permitir acesso sem senha', 'Extensões como pg_exec permitem execução de código'],
    cves: ['CVE-2019-9193'],
    fix: 'Bloqueie porta 5432. Configure pg_hba.conf para restringir acesso por IP.',
  },
  'VNC': {
    risk: 'high',
    issues: ['Acesso gráfico remoto frequentemente sem criptografia', 'Senhas fracas ou ausentes', 'Tráfego interceptável em redes não seguras'],
    cves: ['CVE-2019-15681', 'CVE-2022-41975'],
    fix: 'Tunnel VNC via SSH. Use VPN. Configure senha forte e autenticação.',
  },
  'Redis': {
    risk: 'critical',
    issues: ['Sem autenticação por padrão em versões antigas', 'Permite escrita de arquivos no sistema (authorized_keys, crontab)', 'Explorado para RCE e escalonamento de privilégios'],
    cves: ['CVE-2022-0543', 'CVE-2015-4335'],
    fix: 'NUNCA exponha Redis. Configure requirepass. Use bind 127.0.0.1.',
  },
  'HTTP-Alt': {
    risk: 'medium',
    issues: ['Porta HTTP alternativa — pode expor admin panels', 'Frequentemente sem autenticação ou TLS'],
    cves: [],
    fix: 'Proteja com autenticação forte. Use HTTPS. Restrinja acesso por IP.',
  },
  'HTTPS-Alt': {
    risk: 'info',
    issues: ['Porta HTTPS alternativa', 'Verifique validade do certificado SSL'],
    cves: [],
    fix: 'Certifique-se que TLS 1.2+ está configurado. Desative versões antigas.',
  },
  'Jupyter': {
    risk: 'critical',
    issues: ['Jupyter Notebook permite execução arbitrária de código Python/Shell', 'Frequentemente sem senha em ambientes cloud', 'Acesso direto ao sistema operacional via terminal embutido'],
    cves: ['CVE-2022-24758'],
    fix: 'Nunca exponha Jupyter. Use autenticação com token. Acesse via SSH tunnel.',
  },
  'Elasticsearch': {
    risk: 'critical',
    issues: ['Sem autenticação em versões antigas por padrão', 'Responsável por alguns dos maiores vazamentos de dados da história', 'Acesso completo a todos os índices sem credenciais'],
    cves: [],
    fix: 'Habilite X-Pack Security. Configure bind para 127.0.0.1. Use reverse proxy com autenticação.',
  },
  'Memcached': {
    risk: 'high',
    issues: ['Sem autenticação por padrão', 'Usado em ataques DDoS de amplificação (até 50.000x via UDP)', 'Acesso a dados em cache sem credenciais'],
    cves: ['CVE-2018-1000115'],
    fix: 'Nunca exponha à internet. Use bind 127.0.0.1. Bloqueie UDP/11211 no firewall.',
  },
  'MongoDB': {
    risk: 'critical',
    issues: ['Sem autenticação por padrão em versões antigas', 'Responsável por bilhões de registros vazados globalmente', 'Acesso irrestrito a todos os bancos de dados'],
    cves: ['CVE-2013-4650'],
    fix: 'Habilite autenticação (--auth). Use bind_ip para restringir acesso. Nunca exponha à internet.',
  },
}

const RISK_CONFIG: Record<RiskLevel, { label: string; color: string; bg: string; border: string }> = {
  critical: { label: 'Crítico', color: '#ff4d4d', bg: 'rgba(255,77,77,0.1)', border: 'rgba(255,77,77,0.3)' },
  high:     { label: 'Alto',    color: '#ff8c00', bg: 'rgba(255,140,0,0.1)', border: 'rgba(255,140,0,0.3)' },
  medium:   { label: 'Médio',  color: '#ffd700', bg: 'rgba(255,215,0,0.1)', border: 'rgba(255,215,0,0.3)' },
  low:      { label: 'Baixo',  color: '#00d4ff', bg: 'rgba(0,212,255,0.1)', border: 'rgba(0,212,255,0.3)' },
  info:     { label: 'Info',   color: '#4a5568', bg: 'rgba(74,85,104,0.1)', border: 'rgba(74,85,104,0.3)' },
}

const PING_PRESETS = [
  { label: 'Este Servidor', url: '/api/ping', tag: 'LOCAL' },
  { label: '1.1.1.1 (Cloudflare)', url: 'https://one.one.one.one/dns-query?name=a&type=A', tag: 'CF' },
  { label: '8.8.8.8 (Google)', url: 'https://dns.google/dns-query?name=a&type=A', tag: 'G' },
]

const DNS_TYPES = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'ALL']

function getVuln(service: string): VulnInfo {
  return VULN_DB[service] ?? {
    risk: 'info',
    issues: ['Serviço identificado na porta'],
    cves: [],
    fix: 'Verifique se este serviço é necessário e está corretamente configurado.',
  }
}

function analyzeResults(result: ScanResult) {
  const findings = result.open.map(p => ({ ...p, vuln: getVuln(p.service) }))
  const counts: Record<RiskLevel, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  let score = 100

  for (const f of findings) {
    counts[f.vuln.risk]++
    if (f.vuln.risk === 'critical') score -= 25
    else if (f.vuln.risk === 'high') score -= 12
    else if (f.vuln.risk === 'medium') score -= 5
    else if (f.vuln.risk === 'low') score -= 2
  }

  return { findings, counts, score: Math.max(0, score) }
}

export default function NetworkPage() {
  const [tab, setTab] = useState<'ping' | 'traceroute' | 'dns' | 'scanner' | 'security'>('ping')

  // Ping state
  const [pingData, setPingData] = useState<PingPoint[]>([])
  const [pingRunning, setPingRunning] = useState(false)
  const [pingTarget, setPingTarget] = useState(PING_PRESETS[0].url)
  const [pingCustom, setPingCustom] = useState('')
  const [pingStats, setPingStats] = useState({ min: 0, max: 0, avg: 0, sent: 0, lost: 0 })
  const [jitter, setJitter] = useState(0)
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pingHistory = useRef<number[]>([])
  const pingAllStats = useRef({ min: Infinity, max: 0, sum: 0, sent: 0, lost: 0 })

  // Traceroute state
  const [traceTarget, setTraceTarget] = useState('8.8.8.8')
  const [traceHops, setTraceHops] = useState<TraceHop[]>([])
  const [traceLoading, setTraceLoading] = useState(false)
  const [traceSimulated, setTraceSimulated] = useState(false)

  // DNS state
  const [dnsDomain, setDnsDomain] = useState('google.com')
  const [dnsType, setDnsType] = useState('A')
  const [dnsResult, setDnsResult] = useState<DnsResult | null>(null)
  const [dnsLoading, setDnsLoading] = useState(false)

  // Scanner state
  const [scanTarget, setScanTarget] = useState('')
  const [scanLoading, setScanLoading] = useState(false)
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scanProgress, setScanProgress] = useState(0)
  const [expandedPort, setExpandedPort] = useState<number | null>(null)

  // Auto-fetched enrichment after scan
  const [sslResult, setSslResult] = useState<SSLResult | null>(null)
  const [sslLoading, setSslLoading] = useState(false)
  const [threatResult, setThreatResult] = useState<ThreatResult | null>(null)
  const [threatLoading, setThreatLoading] = useState(false)

  const doPing = useCallback(async () => {
    const s = pingAllStats.current
    s.sent++
    const t0 = performance.now()
    const url = pingCustom ? `https://${pingCustom}` : pingTarget
    try {
      await fetch(url + `?_t=${Date.now()}`, { cache: 'no-store' })
      const lat = performance.now() - t0
      pingHistory.current = [...pingHistory.current.slice(-99), lat]
      setPingData(prev => [...prev.slice(-99), { t: Date.now(), latency: lat }])
      s.min = Math.min(s.min, lat)
      s.max = Math.max(s.max, lat)
      s.sum += lat
      const avg = s.sum / (s.sent - s.lost)
      setPingStats({ min: s.min, max: s.max, avg, sent: s.sent, lost: s.lost })
      setJitter(calcJitter(pingHistory.current))
    } catch {
      s.lost++
      setPingStats(prev => ({ ...prev, sent: s.sent, lost: s.lost }))
    }
  }, [pingTarget, pingCustom])

  const startPing = useCallback(() => {
    pingAllStats.current = { min: Infinity, max: 0, sum: 0, sent: 0, lost: 0 }
    pingHistory.current = []
    setPingData([])
    setPingRunning(true)
    doPing()
    pingRef.current = setInterval(doPing, 1000)
  }, [doPing])

  const stopPing = () => {
    if (pingRef.current) clearInterval(pingRef.current)
    setPingRunning(false)
  }

  useEffect(() => () => { if (pingRef.current) clearInterval(pingRef.current) }, [])

  // Auto-enrich scan results with SSL + threat intelligence
  useEffect(() => {
    if (!scanResult) { setSslResult(null); setThreatResult(null); return }

    const hasHttps = scanResult.open.some(p => p.port === 443 || p.port === 8443)
    if (hasHttps) {
      setSslLoading(true)
      setSslResult(null)
      fetch(`/api/ssl?host=${encodeURIComponent(scanResult.host)}`)
        .then(r => r.json())
        .then(setSslResult)
        .catch(() => {})
        .finally(() => setSslLoading(false))
    }

    const isPublic = (ip: string) =>
      !/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|::1|fc|fd)/.test(ip)
    if (scanResult.ip && isPublic(scanResult.ip)) {
      setThreatLoading(true)
      setThreatResult(null)
      fetch(`/api/threat?ip=${encodeURIComponent(scanResult.ip)}`)
        .then(r => r.json())
        .then(setThreatResult)
        .catch(() => {})
        .finally(() => setThreatLoading(false))
    }
  }, [scanResult])

  const runTraceroute = async () => {
    setTraceLoading(true)
    setTraceHops([])
    try {
      const res = await fetch(`/api/traceroute?target=${encodeURIComponent(traceTarget)}`)
      const data = await res.json()
      setTraceHops(data.hops || [])
      setTraceSimulated(data.simulated || false)
    } catch {
      setTraceHops([])
    } finally {
      setTraceLoading(false)
    }
  }

  const runDns = async () => {
    setDnsLoading(true)
    setDnsResult(null)
    try {
      const res = await fetch(`/api/dns?domain=${encodeURIComponent(dnsDomain)}&type=${dnsType}`)
      setDnsResult(await res.json())
    } finally {
      setDnsLoading(false)
    }
  }

  const runScan = async () => {
    if (!scanTarget.trim()) return
    setScanLoading(true)
    setScanResult(null)
    setScanError(null)
    setScanProgress(0)
    setExpandedPort(null)
    setSslResult(null)
    setThreatResult(null)

    const start = Date.now()
    const expectedMs = 5000
    const ticker = setInterval(() => {
      const elapsed = Date.now() - start
      setScanProgress(Math.min(88, (elapsed / expectedMs) * 88))
    }, 200)

    try {
      const res = await fetch(`/api/portscan?host=${encodeURIComponent(scanTarget.trim())}`)
      const data = await res.json()
      clearInterval(ticker)
      setScanProgress(100)
      if (data.error) {
        setScanError(data.error)
      } else {
        setScanResult(data)
        setTimeout(() => setScanProgress(0), 600)
      }
    } catch {
      clearInterval(ticker)
      setScanProgress(0)
      setScanError('Falha ao conectar com o servidor de scan')
    } finally {
      setScanLoading(false)
    }
  }

  const packetLoss = pingStats.sent > 0 ? (pingStats.lost / pingStats.sent) * 100 : 0
  const lastLatency = pingData[pingData.length - 1]?.latency ?? null

  const analysis = scanResult ? analyzeResults(scanResult) : null

  const scoreColor = (s: number) =>
    s >= 80 ? '#00ff88' : s >= 60 ? '#00d4ff' : s >= 40 ? '#ffd700' : s >= 20 ? '#ff8c00' : '#ff4d4d'

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-bold text-white">Análise de Rede</h1>
        <p className="text-sm text-gray-500 mt-1">Ping, Jitter, Traceroute, DNS e Scanner de Portas</p>
      </div>

      {/* Tab Nav */}
      <div className="flex gap-1 mb-6 bg-[#0a1128] rounded-xl p-1 border border-[#1a2744] w-full overflow-x-auto">
        {([
          { id: 'ping',       icon: Activity,    label: 'Ping' },
          { id: 'traceroute', icon: Network,      label: 'Traceroute' },
          { id: 'dns',        icon: Globe,        label: 'DNS' },
          { id: 'scanner',    icon: Radar,        label: 'Scanner' },
          { id: 'security',   icon: Shield,       label: 'Segurança' },
        ] as const).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-all whitespace-nowrap flex-shrink-0',
              tab === t.id ? 'bg-[#1a2744] text-white' : 'text-gray-500 hover:text-gray-300'
            )}
          >
            <t.icon className="w-4 h-4 shrink-0" />
            {t.label}
          </button>
        ))}
      </div>

      {/* PING TAB */}
      {tab === 'ping' && (
        <div className="space-y-4">
          <div className="card p-4 flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-0">
              <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Destino</label>
              <select
                value={pingCustom ? 'custom' : pingTarget}
                onChange={e => {
                  if (e.target.value === 'custom') { setPingCustom(''); }
                  else { setPingCustom(''); setPingTarget(e.target.value) }
                }}
                className="bg-[#050a1a] border border-[#1a2744] text-gray-300 text-sm rounded-lg px-3 py-2 outline-none w-full"
              >
                {PING_PRESETS.map(p => <option key={p.url} value={p.url}>{p.label}</option>)}
                <option value="custom">Personalizado...</option>
              </select>
            </div>
            {(pingTarget === 'custom' || pingCustom) && (
              <div className="flex-1 min-w-0">
                <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Host</label>
                <input
                  className="dark-input"
                  placeholder="ex: example.com"
                  value={pingCustom}
                  onChange={e => setPingCustom(e.target.value)}
                />
              </div>
            )}
            <button
              onClick={pingRunning ? stopPing : startPing}
              className={clsx('px-5 py-2 rounded-lg font-semibold text-sm flex items-center gap-2', pingRunning ? 'btn-purple' : 'btn-cyan')}
            >
              {pingRunning ? <><Square className="w-4 h-4" />Parar</> : <><Play className="w-4 h-4" />Iniciar</>}
            </button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              { label: 'Atual',  value: lastLatency ? `${lastLatency.toFixed(1)}ms` : '—', color: lastLatency ? latencyColor(lastLatency) : '#4a5568' },
              { label: 'Mínimo', value: pingStats.min !== Infinity ? `${pingStats.min.toFixed(1)}ms` : '—', color: '#00ff88' },
              { label: 'Máximo', value: pingStats.max > 0 ? `${pingStats.max.toFixed(1)}ms` : '—', color: '#ff4d4d' },
              { label: 'Média',  value: pingStats.avg > 0 ? `${pingStats.avg.toFixed(1)}ms` : '—', color: '#00d4ff' },
              { label: 'Jitter', value: jitter > 0 ? `${jitter.toFixed(1)}ms` : '—', color: jitterColor(jitter) },
            ].map(s => (
              <div key={s.label} className="card p-3">
                <p className="text-xs text-gray-600 mb-1">{s.label}</p>
                <p className="text-lg font-bold mono" style={{ color: s.color }}>{s.value}</p>
              </div>
            ))}
          </div>

          <div className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
              <div>
                <h3 className="text-sm font-semibold text-white">Latência em Tempo Real</h3>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  {lastLatency && (
                    <span className={clsx('tag', lastLatency <= 50 ? 'tag-cyan' : lastLatency <= 100 ? 'tag-yellow' : 'tag-red')}>
                      {latencyLabel(lastLatency)}
                    </span>
                  )}
                  {jitter > 0 && (
                    <span className={clsx('tag', jitter <= 5 ? 'tag-green' : jitter <= 15 ? 'tag-cyan' : 'tag-yellow')}>
                      Jitter: {jitterLabel(jitter)}
                    </span>
                  )}
                  {packetLoss > 0 && (
                    <span className="tag tag-red">Perda: {packetLoss.toFixed(1)}%</span>
                  )}
                </div>
              </div>
              <div className="text-right text-xs text-gray-600">
                <p>Enviados: {pingStats.sent}</p>
                <p>Perdidos: {pingStats.lost}</p>
              </div>
            </div>
            {pingData.length > 0 ? (
              <LatencyChart data={pingData} height={200} showGrid />
            ) : (
              <div className="h-48 flex items-center justify-center text-gray-600 text-sm">
                <div className="text-center">
                  <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  Clique em &quot;Iniciar&quot; para começar o monitoramento
                </div>
              </div>
            )}
          </div>

          <div className="card p-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Qualidade para Aplicações</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { app: 'VoIP / Chamadas',  ok: jitter <= 30 && lastLatency !== null && lastLatency <= 150, label: jitter <= 30 ? 'Ótimo' : 'Ruim' },
                { app: 'Videoconferência', ok: jitter <= 50 && lastLatency !== null && lastLatency <= 200, label: jitter <= 50 ? 'Ótimo' : 'Ruim' },
                { app: 'Gaming Online',    ok: lastLatency !== null && lastLatency <= 50, label: lastLatency !== null && lastLatency <= 50 ? 'Ótimo' : lastLatency !== null && lastLatency <= 100 ? 'Ok' : 'Ruim' },
                { app: 'Streaming',        ok: lastLatency !== null && lastLatency <= 200, label: lastLatency !== null && lastLatency <= 100 ? 'Excelente' : 'Ok' },
              ].map(a => (
                <div key={a.app} className={clsx('p-3 rounded-lg border', a.ok ? 'border-green-500/20 bg-green-500/5' : 'border-red-500/20 bg-red-500/5')}>
                  <div className="flex items-center gap-2 mb-1">
                    {a.ok ? <CheckCircle className="w-4 h-4 text-[#00ff88]" /> : <AlertTriangle className="w-4 h-4 text-[#ff4d4d]" />}
                    <span className="text-xs font-semibold text-white">{a.app}</span>
                  </div>
                  <span className={clsx('text-xs', a.ok ? 'text-[#00ff88]' : 'text-[#ff4d4d]')}>{a.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TRACEROUTE TAB */}
      {tab === 'traceroute' && (
        <div className="space-y-4">
          <div className="card p-4 flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-0">
              <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Destino</label>
              <input
                className="dark-input"
                value={traceTarget}
                onChange={e => setTraceTarget(e.target.value)}
                placeholder="IP ou domínio (ex: 8.8.8.8)"
                onKeyDown={e => e.key === 'Enter' && runTraceroute()}
              />
            </div>
            <button
              onClick={runTraceroute}
              disabled={traceLoading}
              className="btn-cyan px-5 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 disabled:opacity-50"
            >
              {traceLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {traceLoading ? 'Rastreando...' : 'Rastrear'}
            </button>
          </div>

          {traceSimulated && (
            <div className="flex items-center gap-2 text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-4 py-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Traceroute simulado — o servidor não tem permissão para executar traceroute real.
            </div>
          )}

          <div className="card overflow-x-auto">
            {traceHops.length === 0 && !traceLoading ? (
              <div className="p-8 text-center text-gray-600 text-sm">
                <Network className="w-8 h-8 mx-auto mb-2 opacity-30" />
                Execute o traceroute para ver os saltos
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[480px]">
                  <div className="px-4 py-3 border-b border-[#1a2744] grid grid-cols-12 text-xs text-gray-500 uppercase tracking-wider font-semibold">
                    <span className="col-span-1">#</span>
                    <span className="col-span-4">Host</span>
                    <span className="col-span-3">IP</span>
                    <span className="col-span-2 text-right">Latência</span>
                    <span className="col-span-2 text-right">Status</span>
                  </div>
                  {traceHops.map((hop, i) => (
                    <div key={i} className="px-4 py-3 border-b border-[#1a2744]/50 grid grid-cols-12 text-sm items-center hover:bg-white/2">
                      <span className="col-span-1 text-gray-600 mono">{hop.hop}</span>
                      <span className="col-span-4 text-gray-300 truncate font-medium">{hop.host}</span>
                      <span className="col-span-3 text-gray-500 mono text-xs">{hop.ip !== hop.host ? hop.ip : ''}</span>
                      <span className="col-span-2 text-right mono" style={{ color: hop.latency ? latencyColor(hop.latency) : '#4a5568' }}>
                        {hop.latency ? `${hop.latency.toFixed(1)}ms` : '—'}
                      </span>
                      <div className="col-span-2 flex justify-end">
                        {hop.timeout ? (
                          <span className="tag tag-red">Timeout</span>
                        ) : (
                          <span className="tag" style={{
                            background: `${hop.latency ? latencyColor(hop.latency) : '#4a5568'}15`,
                            color: hop.latency ? latencyColor(hop.latency) : '#4a5568',
                            border: `1px solid ${hop.latency ? latencyColor(hop.latency) : '#4a5568'}30`,
                          }}>
                            {hop.latency ? latencyLabel(hop.latency) : 'OK'}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  {traceLoading && (
                    <div className="px-4 py-3 flex items-center gap-2 text-gray-500 text-sm">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Descobrindo próximo salto...
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* DNS TAB */}
      {tab === 'dns' && (
        <div className="space-y-4">
          <div className="card p-4 flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-0">
              <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Domínio</label>
              <input
                className="dark-input"
                value={dnsDomain}
                onChange={e => setDnsDomain(e.target.value)}
                placeholder="ex: google.com"
                onKeyDown={e => e.key === 'Enter' && runDns()}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Tipo</label>
              <select
                value={dnsType}
                onChange={e => setDnsType(e.target.value)}
                className="bg-[#050a1a] border border-[#1a2744] text-gray-300 text-sm rounded-lg px-3 py-2 outline-none"
              >
                {DNS_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <button
              onClick={runDns}
              disabled={dnsLoading}
              className="btn-cyan px-5 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 disabled:opacity-50"
            >
              {dnsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Resolver
            </button>
          </div>

          {dnsResult && (
            <div className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-white">{dnsResult.domain}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="tag tag-cyan">{dnsResult.type}</span>
                    {dnsResult.elapsed && (
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <Clock className="w-3 h-3" />{dnsResult.elapsed}ms
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {dnsResult.error ? (
                <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 rounded-lg px-4 py-3">
                  <AlertTriangle className="w-4 h-4" />
                  {dnsResult.error}
                </div>
              ) : (
                <div className="space-y-2">
                  {dnsType === 'ALL' ? (
                    ['A', 'MX', 'NS', 'TXT'].map(t => {
                      const records = (dnsResult as unknown as Record<string, unknown>)[t] as unknown[] | undefined
                      if (!records?.length) return null
                      return (
                        <div key={t}>
                          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1.5">{t} Records</p>
                          {records.map((r, i) => (
                            <div key={i} className="bg-[#050a1a] rounded-lg px-4 py-2 mono text-xs text-gray-300 mb-1 overflow-x-auto">
                              {typeof r === 'object' ? JSON.stringify(r) : String(r)}
                            </div>
                          ))}
                        </div>
                      )
                    })
                  ) : (
                    (dnsResult.records || []).map((r, i) => (
                      <div key={i} className="bg-[#050a1a] rounded-lg px-4 py-2.5 mono text-sm text-[#00d4ff] border border-[#1a2744] overflow-x-auto">
                        {typeof r === 'object' ? JSON.stringify(r, null, 2) : String(r)}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* SCANNER TAB */}
      {tab === 'scanner' && (
        <div className="space-y-4">
          {/* Info banner */}
          <div className="flex items-start gap-3 bg-cyan-500/5 border border-cyan-500/20 rounded-xl px-4 py-3 text-xs text-cyan-300">
            <Terminal className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold mb-0.5">Scanner TCP de Portas</p>
              <p className="text-cyan-400/70">Scan via conexão TCP a partir do servidor — funciona apenas para hosts com acesso à internet. Redes locais (192.168.x.x) não são acessíveis a partir deste servidor.</p>
            </div>
          </div>

          {/* Controls */}
          <div className="card p-4 flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-0">
              <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Alvo (IP ou domínio)</label>
              <input
                className="dark-input"
                placeholder="ex: example.com ou 93.184.216.34"
                value={scanTarget}
                onChange={e => setScanTarget(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !scanLoading && runScan()}
              />
            </div>
            <button
              onClick={runScan}
              disabled={scanLoading || !scanTarget.trim()}
              className="btn-cyan px-5 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 disabled:opacity-50"
            >
              {scanLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radar className="w-4 h-4" />}
              {scanLoading ? 'Scaneando...' : 'Iniciar Scan'}
            </button>
          </div>

          {/* Progress */}
          {scanLoading && (
            <div className="card p-4">
              <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
                <span className="flex items-center gap-2 flex-1 min-w-0">
                  <Radar className="w-3.5 h-3.5 animate-spin text-cyan-400 shrink-0" />
                  <span className="truncate">Testando 30 portas em paralelo...</span>
                </span>
                <span className="mono text-cyan-400">{Math.round(scanProgress)}%</span>
              </div>
              <div className="progress-bar">
                <div className="progress-fill transition-all duration-300" style={{ width: `${scanProgress}%` }} />
              </div>
              <p className="text-xs text-gray-600 mt-2">
                FTP · SSH · Telnet · SMTP · DNS · HTTP · POP3 · IMAP · HTTPS · SMB · MySQL · PostgreSQL · Redis · MongoDB · RDP · VNC · Elasticsearch...
              </p>
            </div>
          )}

          {/* Error */}
          {scanError && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {scanError}
            </div>
          )}

          {/* Results */}
          {scanResult && !scanLoading && (
            <div className="space-y-3">
              {/* Summary */}
              <div className="card p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Server className="w-4 h-4 text-cyan-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{scanResult.host}</p>
                      {scanResult.ip !== scanResult.host && (
                        <p className="text-xs text-gray-500 mono">{scanResult.ip}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-4 shrink-0">
                    <div className="text-center">
                      <p className="text-2xl font-black mono text-[#00ff88]">{scanResult.open.length}</p>
                      <p className="text-xs text-gray-500">abertas</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-black mono text-gray-600">{scanResult.total - scanResult.open.length}</p>
                      <p className="text-xs text-gray-500">fechadas</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-black mono text-gray-400">{scanResult.total}</p>
                      <p className="text-xs text-gray-500">total</p>
                    </div>
                  </div>
                </div>
                {scanResult.open.length > 0 && (
                  <button
                    onClick={() => setTab('security')}
                    className="w-full btn-purple py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5"
                  >
                    <Shield className="w-3.5 h-3.5" />
                    Ver Análise de Segurança
                  </button>
                )}
              </div>

              {scanResult.open.length === 0 ? (
                <div className="card p-8 text-center text-gray-500">
                  <ShieldCheck className="w-10 h-10 mx-auto mb-2 text-green-400 opacity-60" />
                  <p className="font-semibold text-white">Nenhuma porta aberta encontrada</p>
                  <p className="text-xs mt-1">O host parece bem protegido ou inacessível a partir deste servidor.</p>
                </div>
              ) : (
                <div className="card overflow-x-auto">
                  <div className="min-w-[480px]">
                    <div className="px-4 py-3 border-b border-[#1a2744] grid grid-cols-12 text-xs text-gray-500 uppercase tracking-wider font-semibold">
                      <span className="col-span-2">Porta</span>
                      <span className="col-span-3">Serviço</span>
                      <span className="col-span-2">Risco</span>
                      <span className="col-span-5">Banner</span>
                    </div>
                    {scanResult.open.map(p => {
                      const vuln = getVuln(p.service)
                      const rc = RISK_CONFIG[vuln.risk]
                      return (
                        <button
                          key={p.port}
                          onClick={() => setExpandedPort(expandedPort === p.port ? null : p.port)}
                          className="w-full px-4 py-3 border-b border-[#1a2744]/50 grid grid-cols-12 text-sm items-center hover:bg-white/2 text-left"
                        >
                          <span className="col-span-2 mono font-bold text-[#00d4ff]">{p.port}</span>
                          <span className="col-span-3 font-semibold text-white">{p.service}</span>
                          <span className="col-span-2">
                            <span className="tag text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: rc.bg, color: rc.color, border: `1px solid ${rc.border}` }}>
                              {rc.label}
                            </span>
                          </span>
                          <span className="col-span-4 text-gray-500 mono text-xs truncate">{p.banner ?? '—'}</span>
                          <span className="col-span-1 text-gray-600 text-right">
                            <ChevronRight className={clsx('w-3.5 h-3.5 ml-auto transition-transform', expandedPort === p.port && 'rotate-90')} />
                          </span>
                          {expandedPort === p.port && (
                            <div className="col-span-12 mt-3 pt-3 border-t border-[#1a2744]/50 text-left" onClick={e => e.stopPropagation()}>
                              <div className="space-y-2">
                                {vuln.issues.map((iss, i) => (
                                  <div key={i} className="flex items-start gap-2 text-xs">
                                    <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" style={{ color: rc.color }} />
                                    <span className="text-gray-300">{iss}</span>
                                  </div>
                                ))}
                                {vuln.cves.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-2">
                                    {vuln.cves.map(cve => (
                                      <span key={cve} className="tag tag-red text-xs">{cve}</span>
                                    ))}
                                  </div>
                                )}
                                <div className="flex items-start gap-2 text-xs mt-2 bg-[#050a1a] rounded-lg px-3 py-2">
                                  <ShieldCheck className="w-3 h-3 mt-0.5 shrink-0 text-[#00ff88]" />
                                  <span className="text-gray-300">{vuln.fix}</span>
                                </div>
                              </div>
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {!scanResult && !scanLoading && !scanError && (
            <div className="card p-10 text-center text-gray-600">
              <Radar className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">Informe um host e inicie o scan para descobrir portas abertas</p>
              <p className="text-xs mt-1 text-gray-700">Portas escaneadas: FTP, SSH, Telnet, HTTP/S, SMB, MySQL, PostgreSQL, Redis, MongoDB, RDP, VNC e mais</p>
            </div>
          )}
        </div>
      )}

      {/* SECURITY TAB */}
      {tab === 'security' && (
        <div className="space-y-4">
          {!scanResult ? (
            <div className="card p-10 text-center text-gray-600">
              <Shield className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm font-semibold text-gray-400">Nenhum scan realizado</p>
              <p className="text-xs mt-1">Execute um scan na aba Scanner para obter a análise de segurança</p>
              <button
                onClick={() => setTab('scanner')}
                className="btn-cyan mt-4 px-5 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2"
              >
                <Radar className="w-4 h-4" /> Ir para Scanner
              </button>
            </div>
          ) : analysis && (
            <>
              {/* Score + Summary */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Score gauge */}
                <div className="card p-5 flex items-center gap-5">
                  <div className="relative w-20 h-20 shrink-0">
                    <svg viewBox="0 0 100 100" className="w-20 h-20 -rotate-90">
                      <circle cx="50" cy="50" r="40" fill="none" stroke="#1a2744" strokeWidth="10" />
                      <circle
                        cx="50" cy="50" r="40" fill="none"
                        stroke={scoreColor(analysis.score)}
                        strokeWidth="10"
                        strokeDasharray={`${analysis.score * 2.513} 251.3`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-xl font-black mono" style={{ color: scoreColor(analysis.score) }}>
                        {analysis.score}
                      </span>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Score de Segurança</p>
                    <p className="text-lg font-bold" style={{ color: scoreColor(analysis.score) }}>
                      {analysis.score >= 80 ? 'Bom' : analysis.score >= 60 ? 'Regular' : analysis.score >= 40 ? 'Ruim' : analysis.score >= 20 ? 'Crítico' : 'Comprometido'}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">{scanResult.host}</p>
                  </div>
                </div>

                {/* Risk counts */}
                <div className="card p-5">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Vulnerabilidades por Severidade</p>
                  <div className="space-y-2">
                    {(['critical', 'high', 'medium', 'low', 'info'] as RiskLevel[]).map(r => {
                      const rc = RISK_CONFIG[r]
                      const count = analysis.counts[r]
                      const pct = analysis.findings.length > 0 ? (count / analysis.findings.length) * 100 : 0
                      return (
                        <div key={r} className="flex items-center gap-3">
                          <span className="text-xs w-16 shrink-0" style={{ color: rc.color }}>{rc.label}</span>
                          <div className="flex-1 bg-[#0a1128] rounded-full h-1.5">
                            <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, background: rc.color }} />
                          </div>
                          <span className="text-xs mono w-4 text-right" style={{ color: count > 0 ? rc.color : '#4a5568' }}>{count}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* SSL Certificate */}
              {(sslLoading || sslResult) && (
                <div className="card p-5">
                  <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Lock className="w-3.5 h-3.5 text-cyan-400" />
                    Certificado SSL/TLS
                    {sslLoading && <Loader2 className="w-3.5 h-3.5 animate-spin ml-1" />}
                  </h2>
                  {sslResult && (
                    sslResult.error ? (
                      <p className="text-xs text-red-400">{sslResult.error}</p>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-4">
                          <div className="text-center shrink-0">
                            <div className={clsx('text-4xl font-black mono', {
                              'text-[#00ff88]': sslResult.grade === 'A+' || sslResult.grade === 'A',
                              'text-[#ffd700]': sslResult.grade === 'B',
                              'text-[#ff8c00]': sslResult.grade === 'C',
                              'text-[#ff4d4d]': sslResult.grade === 'F',
                            })}>
                              {sslResult.grade}
                            </div>
                            <p className="text-xs text-gray-500">Nota TLS</p>
                          </div>
                          <div className="flex-1 min-w-0 space-y-1.5 text-xs">
                            <div className="flex gap-2">
                              <span className="text-gray-500 w-20 shrink-0">Protocolo:</span>
                              <span className="text-white mono">{sslResult.protocol}</span>
                            </div>
                            <div className="flex gap-2">
                              <span className="text-gray-500 w-20 shrink-0">Expira em:</span>
                              <span className={clsx('mono font-semibold', sslResult.expired ? 'text-[#ff4d4d]' : sslResult.daysUntilExpiry < 30 ? 'text-[#ffd700]' : 'text-[#00ff88]')}>
                                {sslResult.expired ? 'EXPIRADO' : `${sslResult.daysUntilExpiry} dias`}
                              </span>
                            </div>
                            <div className="flex gap-2">
                              <span className="text-gray-500 w-20 shrink-0">Emissor:</span>
                              <span className="text-white truncate">{sslResult.issuer?.O ?? sslResult.issuer?.CN ?? '—'}</span>
                            </div>
                            <div className="flex gap-2">
                              <span className="text-gray-500 w-20 shrink-0">Cipher:</span>
                              <span className="text-gray-400 mono truncate">{sslResult.cipher?.name}</span>
                            </div>
                          </div>
                        </div>
                        {sslResult.issues?.length > 0 && (
                          <div className="space-y-1.5 pt-2 border-t border-[#1a2744]">
                            {sslResult.issues.map((iss, i) => {
                              const col = iss.severity === 'critical' ? '#ff4d4d' : iss.severity === 'high' ? '#ff8c00' : iss.severity === 'medium' ? '#ffd700' : '#00d4ff'
                              return (
                                <div key={i} className="flex items-start gap-2 text-xs">
                                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" style={{ color: col }} />
                                  <span className="text-gray-300">{iss.message}</span>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  )}
                </div>
              )}

              {/* Threat Intelligence */}
              {(threatLoading || threatResult) && (
                <div className="card p-5">
                  <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <ShieldAlert className="w-3.5 h-3.5 text-orange-400" />
                    Inteligência de Ameaças
                    {threatLoading && <Loader2 className="w-3.5 h-3.5 animate-spin ml-1" />}
                  </h2>
                  {threatResult && !threatResult.error && (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-start gap-4">
                        {threatResult.ipInfo && (
                          <div className="text-xs space-y-1">
                            <p><span className="text-gray-500">IP:</span> <span className="text-white mono">{threatResult.ip}</span></p>
                            <p><span className="text-gray-500">Localização:</span> <span className="text-white">{[threatResult.ipInfo.city, threatResult.ipInfo.country].filter(Boolean).join(', ')}</span></p>
                            <p><span className="text-gray-500">Provedor:</span> <span className="text-white break-all">{threatResult.ipInfo.org}</span></p>
                          </div>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {threatResult.isTor && <span className="tag tag-red">Nó Tor</span>}
                          {(threatResult.listedCount ?? 0) > 0 && (
                            <span className="tag tag-red">DNSBL: {threatResult.listedCount} listas</span>
                          )}
                          {threatResult.riskLevel && (
                            <span className="tag" style={{
                              background: RISK_CONFIG[threatResult.riskLevel as RiskLevel]?.bg ?? 'rgba(74,85,104,0.1)',
                              color: RISK_CONFIG[threatResult.riskLevel as RiskLevel]?.color ?? '#4a5568',
                              border: `1px solid ${RISK_CONFIG[threatResult.riskLevel as RiskLevel]?.border ?? 'rgba(74,85,104,0.3)'}`,
                            }}>
                              Risco: {RISK_CONFIG[threatResult.riskLevel as RiskLevel]?.label ?? threatResult.riskLevel}
                            </span>
                          )}
                        </div>
                      </div>
                      {(threatResult.dnsbl ?? []).some(d => d.listed) && (
                        <div className="space-y-1 pt-2 border-t border-[#1a2744]">
                          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Listas negras com ocorrência:</p>
                          {(threatResult.dnsbl ?? []).filter(d => d.listed).map(d => (
                            <div key={d.name} className="flex items-center gap-2 text-xs">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#ff4d4d] shrink-0" />
                              <span className="text-red-300 font-semibold">{d.name}</span>
                              <span className="text-gray-500">{d.description}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {(threatResult.listedCount === 0 && !threatResult.isTor) && (
                        <div className="flex items-center gap-2 text-xs text-[#00ff88]">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          IP não encontrado em listas negras conhecidas
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Findings */}
              <div className="space-y-3">
                {analysis.findings.length === 0 ? (
                  <div className="card p-8 text-center">
                    <ShieldCheck className="w-10 h-10 mx-auto mb-2 text-green-400" />
                    <p className="text-white font-semibold">Nenhuma porta exposta encontrada</p>
                    <p className="text-xs text-gray-500 mt-1">Excelente postura de segurança perimetral</p>
                  </div>
                ) : (
                  <>
                    <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Análise por Serviço</h2>
                    {(['critical', 'high', 'medium', 'low', 'info'] as RiskLevel[]).map(risk =>
                      analysis.findings
                        .filter(f => f.vuln.risk === risk)
                        .map(f => {
                          const rc = RISK_CONFIG[f.vuln.risk]
                          const RiskIcon = f.vuln.risk === 'critical' ? ShieldAlert : f.vuln.risk === 'high' ? ShieldOff : f.vuln.risk === 'medium' ? AlertTriangle : ShieldCheck
                          return (
                            <div key={f.port} className="card p-4 rounded-xl border" style={{ borderColor: rc.border }}>
                              <div className="flex flex-wrap items-start gap-3 mb-3">
                                <div className="flex items-center gap-2">
                                  <RiskIcon className="w-4 h-4 shrink-0" style={{ color: rc.color }} />
                                  <span className="font-bold text-white">{f.service}</span>
                                  <span className="mono text-xs px-2 py-0.5 rounded" style={{ background: '#0a1128', color: '#00d4ff' }}>:{f.port}</span>
                                </div>
                                <span className="tag text-xs font-bold" style={{ background: rc.bg, color: rc.color, border: `1px solid ${rc.border}` }}>
                                  {rc.label}
                                </span>
                              </div>

                              {f.banner && (
                                <div className="bg-[#050a1a] rounded-lg px-3 py-1.5 mono text-xs text-gray-400 mb-3 truncate">
                                  {f.banner}
                                </div>
                              )}

                              <div className="space-y-1.5 mb-3">
                                {f.vuln.issues.map((iss, i) => (
                                  <div key={i} className="flex items-start gap-2 text-xs">
                                    <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" style={{ color: rc.color }} />
                                    <span className="text-gray-300">{iss}</span>
                                  </div>
                                ))}
                              </div>

                              {f.vuln.cves.length > 0 && (
                                <div className="flex flex-wrap gap-1 mb-3">
                                  {f.vuln.cves.map(cve => (
                                    <span key={cve} className="tag tag-red text-xs">{cve}</span>
                                  ))}
                                </div>
                              )}

                              <div className="flex items-start gap-2 bg-[#050a1a] rounded-lg px-3 py-2 text-xs">
                                <Lock className="w-3 h-3 mt-0.5 shrink-0 text-[#00ff88]" />
                                <span className="text-gray-300">{f.vuln.fix}</span>
                              </div>
                            </div>
                          )
                        })
                    )}
                  </>
                )}
              </div>

              {/* General Recommendations */}
              <div className="card p-5">
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Zap className="w-3.5 h-3.5 text-yellow-400" />
                  Recomendações Gerais
                </h2>
                <div className="space-y-2">
                  {[
                    { icon: Lock, text: 'Use firewall para bloquear portas não essenciais. Princípio do menor privilégio.', color: '#00d4ff' },
                    { icon: Database, text: 'Bancos de dados nunca devem estar expostos à internet. Use VPN ou SSH tunnel.', color: '#7b2fff' },
                    { icon: Shield, text: 'Implemente autenticação em dois fatores em todos os serviços acessíveis remotamente.', color: '#00ff88' },
                    { icon: AlertTriangle, text: 'Monitore logs de acesso e configure alertas para tentativas de login suspeitas.', color: '#ffd700' },
                    { icon: Server, text: 'Mantenha todos os serviços atualizados. A maioria dos ataques exploram vulnerabilidades conhecidas.', color: '#ff8c00' },
                  ].map(({ icon: Icon, text, color }, i) => (
                    <div key={i} className="flex items-start gap-3 text-xs">
                      <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color }} />
                      <span className="text-gray-400">{text}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-4 border-t border-[#1a2744] text-xs text-gray-600">
                  ⚠️ Esta análise é para fins educacionais e auditoria autorizada. Execute scans apenas em sistemas que você tem permissão para testar.
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
