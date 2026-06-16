'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Activity, Search, Network, Play, Square, AlertTriangle,
  CheckCircle, Clock, Globe, ChevronRight, Loader2,
  Radar, Shield, ShieldAlert, ShieldCheck, ShieldOff,
  Terminal, Database, Lock, Server, Zap, Save, FileDown,
  Copy, Check, FileSearch, Calendar, ExternalLink, ChevronDown, ChevronUp,
} from 'lucide-react'
import LatencyChart from '@/components/LatencyChart'
import { latencyColor, calcJitter, jitterColor, jitterLabel, latencyLabel } from '@/lib/utils'
import clsx from 'clsx'
import ReportModal from '@/components/ReportModal'
import type { RiskLevel, VulnInfo, ScanPort, ScanResult, SSLResult, ThreatResult, BaselineSnapshot } from '@/types/network'

interface PingPoint { t: number; latency: number }

interface PingTiming {
  dns: number
  tcp: number
  tls: number
  ttfb: number
  total: number
}

interface NetInfo {
  type?: string
  effectiveType?: string
  downlink?: number
  rtt?: number
}

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

interface WhoisResult {
  domain: string
  elapsed: number
  server: string
  domainName: string
  registrar: string
  registrarUrl: string
  createdDate: string
  updatedDate: string
  expiresDate: string
  status: string[]
  nameServers: string[]
  dnssec: string
  country: string
  organization: string
  abuse: string
  raw: string
  error?: string
}

interface BenchResult {
  name: string
  ip: string
  flag: string
  avg: number
  samples: number[]
  timeout: boolean
  isp: boolean
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
  const [tab, setTab] = useState<'ping' | 'traceroute' | 'dns' | 'scanner' | 'security' | 'benchmark' | 'whois'>('ping')

  // Local agent detection
  const AGENT_URL = 'http://localhost:3777'
  const [agentStatus, setAgentStatus] = useState<'detecting' | 'connected' | 'disconnected'>('detecting')
  const [agentInfo, setAgentInfo] = useState<{ hostname?: string; platform?: string } | null>(null)

  // Ping state
  const [pingData, setPingData] = useState<PingPoint[]>([])
  const [pingRunning, setPingRunning] = useState(false)
  const [pingTarget, setPingTarget] = useState(PING_PRESETS[0].url)
  const [pingCustom, setPingCustom] = useState('')
  const [pingStats, setPingStats] = useState({ min: 0, max: 0, avg: 0, sent: 0, lost: 0 })
  const [jitter, setJitter] = useState(0)
  const [lastTiming, setLastTiming] = useState<PingTiming | null>(null)
  const [netInfo, setNetInfo] = useState<NetInfo | null>(null)
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pingHistory = useRef<number[]>([])
  const pingAllStats = useRef({ min: Infinity, max: 0, sum: 0, sent: 0, lost: 0 })

  // Traceroute state
  const [traceTarget, setTraceTarget] = useState('8.8.8.8')
  const [traceHops, setTraceHops] = useState<TraceHop[]>([])
  const [traceLoading, setTraceLoading] = useState(false)
  const [traceSimulated, setTraceSimulated] = useState(false)
  const [traceDone, setTraceDone] = useState(false)
  const [traceError, setTraceError] = useState('')
  const [traceLive, setTraceLive] = useState(false)
  const traceLiveRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map())
  const traceAbortRef = useRef<AbortController | null>(null)

  // DNS Benchmark state
  const [benchResults, setBenchResults] = useState<BenchResult[]>([])
  const [benchLoading, setBenchLoading] = useState(false)
  const [benchCustomIp, setBenchCustomIp] = useState('')
  const [benchDone, setBenchDone] = useState(false)
  const [benchIspFound, setBenchIspFound] = useState(false)
  const [copied, setCopied] = useState('')

  // DNS state
  const [dnsDomain, setDnsDomain] = useState('google.com')
  const [dnsType, setDnsType] = useState('A')
  const [dnsResult, setDnsResult] = useState<DnsResult | null>(null)
  const [dnsLoading, setDnsLoading] = useState(false)

  // WHOIS state
  const [whoisDomain, setWhoisDomain] = useState('google.com')
  const [whoisResult, setWhoisResult] = useState<WhoisResult | null>(null)
  const [whoisLoading, setWhoisLoading] = useState(false)
  const [whoisError, setWhoisError] = useState('')
  const [whoisRawOpen, setWhoisRawOpen] = useState(false)

  // Scanner state
  const [scanTarget, setScanTarget] = useState('')
  const [scanLoading, setScanLoading] = useState(false)
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scanProgress, setScanProgress] = useState(0)
  const [expandedPort, setExpandedPort] = useState<number | null>(null)
  const [scanMode, setScanMode] = useState<'common' | 'custom'>('common')
  const [customPorts, setCustomPorts] = useState('')
  const [baseline, setBaseline] = useState<BaselineSnapshot | null>(null)
  const [reportModalOpen, setReportModalOpen] = useState(false)

  // Auto-fetched enrichment after scan
  const [sslResult, setSslResult] = useState<SSLResult | null>(null)
  const [sslLoading, setSslLoading] = useState(false)
  const [threatResult, setThreatResult] = useState<ThreatResult | null>(null)
  const [threatLoading, setThreatLoading] = useState(false)

  const doPing = useCallback(async () => {
    const s = pingAllStats.current
    s.sent++
    const t0 = performance.now()
    const base = pingCustom ? `https://${pingCustom}` : pingTarget
    const fetchUrl = `${base}${base.includes('?') ? '&' : '?'}_t=${Date.now()}`
    try {
      await fetch(fetchUrl, { cache: 'no-store' })
      const lat = performance.now() - t0
      pingHistory.current = [...pingHistory.current.slice(-99), lat]
      setPingData(prev => [...prev.slice(-99), { t: Date.now(), latency: lat }])
      s.min = Math.min(s.min, lat)
      s.max = Math.max(s.max, lat)
      s.sum += lat
      const avg = s.sum / (s.sent - s.lost)
      setPingStats({ min: s.min, max: s.max, avg, sent: s.sent, lost: s.lost })
      setJitter(calcJitter(pingHistory.current))

      // Capture performance timing breakdown
      const entries = performance.getEntriesByName(fetchUrl, 'resource') as PerformanceResourceTiming[]
      const entry = entries[entries.length - 1]
      if (entry && entry.responseEnd > 0 && entry.connectEnd > 0) {
        setLastTiming({
          dns: Math.max(0, entry.domainLookupEnd - entry.domainLookupStart),
          tcp: Math.max(0, (entry.connectEnd - entry.connectStart) - (entry.secureConnectionStart > 0 ? entry.requestStart - entry.secureConnectionStart : 0)),
          tls: entry.secureConnectionStart > 0 ? Math.max(0, entry.requestStart - entry.secureConnectionStart) : 0,
          ttfb: Math.max(0, entry.responseStart - entry.requestStart),
          total: Math.max(0, entry.responseEnd - entry.startTime),
        })
      }
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

  // Detect local agent on mount and every 10s
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>
    async function detect() {
      try {
        const res = await fetch(`${AGENT_URL}/health`, { signal: AbortSignal.timeout(1500) })
        if (res.ok) {
          const data = await res.json() as { hostname?: string; platform?: string }
          setAgentStatus('connected')
          setAgentInfo(data)
          return
        }
      } catch { /* not running */ }
      setAgentStatus('disconnected')
      setAgentInfo(null)
    }
    detect()
    interval = setInterval(detect, 10_000)
    return () => clearInterval(interval)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // API URL helper — prefers agent for server-side tools when connected
  const apiUrl = useCallback((cloudPath: string, agentPath: string, params: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString()
    if (agentStatus === 'connected') return `${AGENT_URL}${agentPath}${qs ? '?' + qs : ''}`
    return `${cloudPath}${qs ? '?' + qs : ''}`
  }, [agentStatus]) // eslint-disable-line react-hooks/exhaustive-deps

  // Network Information API
  useEffect(() => {
    type Conn = { type?: string; effectiveType?: string; downlink?: number; rtt?: number; onchange: (() => void) | null }
    const nav = navigator as Navigator & { connection?: Conn; mozConnection?: Conn; webkitConnection?: Conn }
    const conn = nav.connection ?? nav.mozConnection ?? nav.webkitConnection
    if (!conn) return
    const update = () => setNetInfo({ type: conn.type, effectiveType: conn.effectiveType, downlink: conn.downlink, rtt: conn.rtt })
    update()
    conn.onchange = update
    return () => { conn.onchange = null }
  }, [])

  // Load baseline from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('scan_baseline')
      if (stored) setBaseline(JSON.parse(stored))
    } catch { /* ignore */ }
  }, [])

  const saveBaseline = () => {
    if (!scanResult || !analysis) return
    const snap: BaselineSnapshot = {
      scan: scanResult,
      score: analysis.score,
      counts: analysis.counts,
      date: new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }),
    }
    localStorage.setItem('scan_baseline', JSON.stringify(snap))
    setBaseline(snap)
  }

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

  const stopTrace = () => {
    traceAbortRef.current?.abort()
    traceLiveRef.current.forEach(t => clearInterval(t))
    traceLiveRef.current.clear()
    setTraceLoading(false)
  }

  const startLivePing = (ip: string) => {
    if (ip === '*' || traceLiveRef.current.has(ip)) return
    const tick = async () => {
      try {
        const r = await fetch(`/api/ping?target=${ip}`)
        const d = await r.json()
        if (d.ms >= 0) {
          setTraceHops(prev => prev.map(h => h.ip === ip ? { ...h, latency: d.ms, timeout: false } : h))
        } else {
          setTraceHops(prev => prev.map(h => h.ip === ip ? { ...h, timeout: true } : h))
        }
      } catch { /* ignore */ }
    }
    tick()
    traceLiveRef.current.set(ip, setInterval(tick, 1500))
  }

  const runTraceroute = async () => {
    stopTrace()
    setTraceHops([])
    setTraceError('')
    setTraceDone(false)
    setTraceSimulated(false)
    setTraceLive(false)
    setTraceLoading(true)

    // Agent connected: single plain-JSON traceroute from the user's own device
    if (agentStatus === 'connected') {
      try {
        const url = apiUrl('/api/traceroute', '/traceroute', { target: traceTarget })
        const res = await fetch(url)
        const data = await res.json()
        setTraceHops(data.hops || [])
        setTraceSimulated(data.simulated || false)
        setTraceDone(true)
      } catch {
        setTraceHops([])
        setTraceError('Falha ao executar traceroute via agente local')
      } finally {
        setTraceLoading(false)
      }
      return
    }

    // No agent: stream hops from the cloud server with live per-hop re-ping
    setTraceLive(true)
    const ctrl = new AbortController()
    traceAbortRef.current = ctrl

    try {
      const res = await fetch(`/api/traceroute?target=${encodeURIComponent(traceTarget)}`, { signal: ctrl.signal })
      if (!res.body) throw new Error('Sem resposta do servidor')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() ?? ''
        for (const part of parts) {
          const line = part.replace(/^data: /, '').trim()
          if (!line) continue
          try {
            const obj = JSON.parse(line)
            if (obj.done) { setTraceDone(true); setTraceLoading(false) }
            else if (obj.error) { setTraceError(obj.error); setTraceLoading(false) }
            else {
              setTraceHops(prev => {
                const exists = prev.find(h => h.hop === obj.hop)
                return exists ? prev.map(h => h.hop === obj.hop ? obj : h) : [...prev, obj]
              })
              startLivePing(obj.ip)
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') setTraceError(e.message)
    } finally {
      setTraceLoading(false)
    }
  }

  useEffect(() => () => stopTrace(), [])

  const runBenchmark = async () => {
    setBenchLoading(true)
    setBenchDone(false)
    setBenchResults([])
    try {
      const customTrim = benchCustomIp.trim()
      const [mainRes, customRes] = await Promise.all([
        fetch('/api/dns-benchmark').then(r => r.json()),
        customTrim
          ? fetch(`/api/dns-benchmark?ip=${encodeURIComponent(customTrim)}`).then(r => r.json())
          : Promise.resolve(null),
      ])

      const rows: BenchResult[] = mainRes.results ?? []
      setBenchIspFound(mainRes.ispFound ?? false)
      if (customRes?.avg != null) {
        rows.push({ name: `Personalizado (${customTrim})`, ip: customTrim, flag: '⚙️', avg: customRes.avg, samples: customRes.samples, timeout: customRes.timeout, isp: false })
        rows.sort((a, b) => (a.timeout ? 1 : 0) - (b.timeout ? 1 : 0) || a.avg - b.avg)
      }

      setBenchResults(rows)
      setBenchDone(true)
    } finally {
      setBenchLoading(false)
    }
  }

  const copyIp = (ip: string) => {
    navigator.clipboard.writeText(ip).then(() => {
      setCopied(ip)
      setTimeout(() => setCopied(''), 2000)
    })
  }

  const runWhois = async () => {
    setWhoisLoading(true)
    setWhoisError('')
    setWhoisResult(null)
    setWhoisRawOpen(false)
    try {
      const res = await fetch(`/api/whois?domain=${encodeURIComponent(whoisDomain.trim())}`)
      const data: WhoisResult = await res.json()
      if (data.error) setWhoisError(data.error)
      else setWhoisResult(data)
    } catch {
      setWhoisError('Falha ao consultar WHOIS')
    } finally {
      setWhoisLoading(false)
    }
  }

  const runDns = async () => {
    setDnsLoading(true)
    setDnsResult(null)
    try {
      const url = apiUrl('/api/dns', '/dns', { domain: dnsDomain, type: dnsType })
      const res = await fetch(url)
      setDnsResult(await res.json())
    } finally {
      setDnsLoading(false)
    }
  }

  const runScan = async () => {
    if (!scanTarget.trim()) return
    if (scanMode === 'custom' && countCustomPorts(customPorts) === 0) return
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
      const params: Record<string, string> = { host: scanTarget.trim() }
      if (scanMode === 'custom' && customPorts.trim()) params.ports = customPorts.trim()
      const url = apiUrl('/api/portscan', '/portscan', params)
      const res = await fetch(url)
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

  function countCustomPorts(input: string): number {
    if (!input.trim()) return 0
    const result = new Set<number>()
    const parts = input.split(/[\s,;]+/).filter(Boolean)
    for (const part of parts) {
      if (part.includes('-')) {
        const [a, b] = part.split('-').map(s => parseInt(s, 10))
        if (!isNaN(a) && !isNaN(b) && a >= 1 && b <= 65535 && a <= b) {
          const limit = Math.min(b, a + 999)
          for (let p = a; p <= limit; p++) result.add(p)
        }
      } else {
        const p = parseInt(part, 10)
        if (!isNaN(p) && p >= 1 && p <= 65535) result.add(p)
      }
    }
    return result.size
  }

  const packetLoss = pingStats.sent > 0 ? (pingStats.lost / pingStats.sent) * 100 : 0
  const lastLatency = pingData[pingData.length - 1]?.latency ?? null

  const analysis = scanResult ? analyzeResults(scanResult) : null

  const scoreColor = (s: number) =>
    s >= 80 ? '#00ff88' : s >= 60 ? '#00d4ff' : s >= 40 ? '#ffd700' : s >= 20 ? '#ff8c00' : '#ff4d4d'

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl md:text-2xl font-bold text-white">Análise de Rede</h1>
        <p className="text-sm text-gray-500 mt-1">Ping, Jitter, Traceroute, DNS, Benchmark, WHOIS e Scanner de Portas</p>
      </div>

      {/* Agent status banner */}
      {agentStatus === 'connected' ? (
        <div className="flex items-center gap-3 mb-4 bg-green-500/5 border border-green-500/25 rounded-xl px-4 py-2.5 text-xs">
          <span className="w-2 h-2 rounded-full bg-green-400 shrink-0 animate-pulse" />
          <div className="flex-1 min-w-0">
            <span className="text-green-400 font-semibold">Agente Local Conectado</span>
            <span className="text-green-400/60 ml-2">{agentInfo?.hostname} ({agentInfo?.platform})</span>
            <span className="text-green-400/50 ml-2">— todos os testes originam do seu dispositivo, incluindo IPs internos</span>
          </div>
        </div>
      ) : agentStatus === 'disconnected' ? (
        <div className="flex items-start gap-3 mb-4 bg-[#0a1128] border border-[#1a2744] rounded-xl px-4 py-2.5 text-xs">
          <span className="w-2 h-2 rounded-full bg-gray-600 shrink-0 mt-1" />
          <div className="flex-1 min-w-0">
            <span className="text-gray-400">Agente local não detectado</span>
            <span className="text-gray-600 ml-2">— traceroute, DNS e port scan originam do servidor cloud</span>
            <span className="text-gray-600 block mt-0.5">
              Para testes locais: <code className="text-gray-500">node scripts/local-agent.js</code>
            </span>
          </div>
        </div>
      ) : null}

      {/* Tab Nav */}
      <div className="flex gap-1 mb-6 bg-[#0a1128] rounded-xl p-1 border border-[#1a2744] w-full overflow-x-auto">
        {([
          { id: 'ping',       icon: Activity,    label: 'Ping' },
          { id: 'traceroute', icon: Network,      label: 'Traceroute' },
          { id: 'dns',        icon: Globe,        label: 'DNS' },
          { id: 'benchmark',  icon: Zap,          label: 'DNS Benchmark' },
          { id: 'whois',      icon: FileSearch,   label: 'WHOIS' },
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
          {/* Origin banner */}
          <div className="flex items-start gap-3 bg-green-500/5 border border-green-500/20 rounded-xl px-4 py-3 text-xs text-green-400">
            <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold mb-0.5">Medição a partir do seu dispositivo local</p>
              <p className="text-green-400/70">O teste parte do seu <strong>navegador → destino</strong>, não do servidor da aplicação. Reflete a qualidade real da sua conexão de internet, incluindo WiFi, roteador e ISP.</p>
            </div>
          </div>

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

          {/* Latency breakdown panel */}
          {lastTiming && lastTiming.total > 0 && (
            <div className="card p-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-cyan-400" />
                Breakdown de Latência (último ping)
              </h3>
              <div className="space-y-2.5">
                {([
                  { key: 'dns',  label: 'DNS',  value: lastTiming.dns,  desc: 'Resolução do nome para IP',           color: '#7b2fff' },
                  { key: 'tcp',  label: 'TCP',  value: lastTiming.tcp,  desc: 'Abertura da conexão TCP',             color: '#00d4ff' },
                  { key: 'tls',  label: 'TLS',  value: lastTiming.tls,  desc: 'Handshake SSL/TLS',                  color: '#ffd700' },
                  { key: 'ttfb', label: 'TTFB', value: lastTiming.ttfb, desc: 'Tempo até 1º byte (processamento)',  color: '#00ff88' },
                ] as const).map(row => {
                  if (row.value < 0.1) return null
                  const pct = Math.min(100, (row.value / lastTiming.total) * 100)
                  return (
                    <div key={row.key} className="flex items-center gap-3">
                      <span className="w-9 text-xs mono font-semibold text-right shrink-0" style={{ color: row.color }}>{row.label}</span>
                      <div className="flex-1 bg-[#0a1128] rounded-full h-3.5 overflow-hidden">
                        <div className="h-3.5 rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: row.color, opacity: 0.5 }} />
                      </div>
                      <span className="w-14 text-xs mono text-right shrink-0" style={{ color: latencyColor(row.value) }}>{row.value.toFixed(1)}ms</span>
                      <span className="text-xs text-gray-600 hidden lg:block w-52 shrink-0">{row.desc}</span>
                    </div>
                  )
                })}
                <div className="flex items-center gap-3 pt-2 border-t border-[#1a2744]">
                  <span className="w-9 text-xs mono font-semibold text-right shrink-0 text-white">Total</span>
                  <div className="flex-1 bg-[#0a1128] rounded-full h-3.5 overflow-hidden">
                    <div className="h-3.5 rounded-full bg-white/10" style={{ width: '100%' }} />
                  </div>
                  <span className="w-14 text-xs mono text-right shrink-0 text-white font-bold">{lastTiming.total.toFixed(1)}ms</span>
                  <span className="text-xs text-gray-600 hidden lg:block w-52 shrink-0">RTT completo (browser → servidor)</span>
                </div>
              </div>
              <p className="text-xs text-gray-700 mt-3">
                DNS e TCP são cacheados após a primeira conexão — pings subsequentes mostram somente TTFB.
                Valores 0ms indicam que o breakdown não está disponível para esse destino (requer <code className="text-gray-600">Timing-Allow-Origin</code>).
              </p>
            </div>
          )}

          {/* Network Info panel */}
          {netInfo && (netInfo.type || netInfo.effectiveType || netInfo.downlink !== undefined || netInfo.rtt !== undefined) && (
            <div className="card p-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 text-cyan-400" />
                Informações da Conexão (reportado pelo SO)
              </h3>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {netInfo.type && (
                  <div className="bg-[#0a1128] rounded-lg p-3">
                    <p className="text-xs text-gray-600 mb-1">Tipo de Rede</p>
                    <p className="text-sm font-semibold text-white capitalize">{netInfo.type}</p>
                  </div>
                )}
                {netInfo.effectiveType && (
                  <div className="bg-[#0a1128] rounded-lg p-3">
                    <p className="text-xs text-gray-600 mb-1">Velocidade Efetiva</p>
                    <p className="text-sm font-bold uppercase" style={{ color: netInfo.effectiveType === '4g' ? '#00ff88' : netInfo.effectiveType === '3g' ? '#ffd700' : '#ff4d4d' }}>
                      {netInfo.effectiveType}
                    </p>
                  </div>
                )}
                {netInfo.downlink !== undefined && (
                  <div className="bg-[#0a1128] rounded-lg p-3">
                    <p className="text-xs text-gray-600 mb-1">Downlink Estimado</p>
                    <p className="text-sm font-semibold text-white">{netInfo.downlink} <span className="text-xs text-gray-500">Mbps</span></p>
                  </div>
                )}
                {netInfo.rtt !== undefined && (
                  <div className="bg-[#0a1128] rounded-lg p-3">
                    <p className="text-xs text-gray-600 mb-1">RTT (estimativa OS)</p>
                    <p className="text-sm font-semibold mono" style={{ color: latencyColor(netInfo.rtt) }}>{netInfo.rtt}ms</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TRACEROUTE TAB */}
      {tab === 'traceroute' && (
        <div className="space-y-4">
          {agentStatus === 'connected' ? (
            <div className="flex items-start gap-3 bg-green-500/5 border border-green-500/25 rounded-xl px-4 py-3 text-xs text-green-400">
              <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold mb-0.5">Agente Local — traceroute a partir do seu dispositivo</p>
                <p className="text-green-400/70">Os saltos refletem a rota real da sua conexão: seu roteador, ISP, e caminho até o destino.</p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3 bg-yellow-500/5 border border-yellow-500/20 rounded-xl px-4 py-3 text-xs text-yellow-400">
              <Server className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold mb-0.5">Executado a partir do servidor cloud — com ping ao vivo por salto</p>
                <p className="text-yellow-400/70">Não reflete a sua rota de rede. Rode <code className="text-yellow-300">node scripts/local-agent.js</code> para obter o traceroute real do seu dispositivo.</p>
              </div>
            </div>
          )}
          <div className="card p-4 flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-0">
              <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Destino</label>
              <input
                className="dark-input"
                value={traceTarget}
                onChange={e => setTraceTarget(e.target.value)}
                placeholder="IP ou domínio (ex: 8.8.8.8)"
                onKeyDown={e => e.key === 'Enter' && !traceLoading && runTraceroute()}
              />
            </div>
            {traceLoading && agentStatus !== 'connected' ? (
              <button onClick={stopTrace} className="btn-purple px-5 py-2 rounded-lg font-semibold text-sm flex items-center gap-2">
                <Square className="w-4 h-4" />Parar
              </button>
            ) : (
              <button
                onClick={runTraceroute}
                disabled={traceLoading}
                className="btn-cyan px-5 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 disabled:opacity-50"
              >
                {traceLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                {traceLoading ? 'Rastreando...' : 'Rastrear'}
              </button>
            )}
          </div>

          {traceSimulated && (
            <div className="flex items-center gap-2 text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-4 py-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Traceroute simulado — o agente local não tem permissão para executar traceroute real.
            </div>
          )}

          {traceError && (
            <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />{traceError}
            </div>
          )}

          <div className="card overflow-hidden">
            {traceHops.length === 0 && !traceLoading ? (
              <div className="p-8 text-center text-gray-600 text-sm">
                <Network className="w-8 h-8 mx-auto mb-2 opacity-30" />
                Execute o traceroute para ver os saltos
              </div>
            ) : (
              <>
                <div className="px-4 py-3 border-b border-[#1a2744] grid grid-cols-12 text-xs text-gray-500 uppercase tracking-wider font-semibold">
                  <span className="col-span-1">#</span>
                  <span className="col-span-4">Host / IP</span>
                  <span className="col-span-3 text-right">Latência</span>
                  <span className="col-span-4 text-right">Status</span>
                </div>

                {traceHops.map((hop) => {
                  const color = hop.timeout ? '#4a5568' : hop.latency ? latencyColor(hop.latency) : '#4a5568'
                  const isLive = traceLive && traceDone && !hop.timeout && hop.ip !== '*'
                  return (
                    <div key={hop.hop} className="px-4 py-2.5 border-b border-[#1a2744]/40 grid grid-cols-12 text-sm items-center hover:bg-white/[0.02] transition-colors">
                      <span className="col-span-1 text-gray-600 mono text-xs">{hop.hop}</span>

                      <div className="col-span-4 min-w-0 pr-2">
                        {hop.timeout ? (
                          <span className="text-gray-600">* * *</span>
                        ) : (
                          <>
                            <p className="text-gray-200 mono text-xs truncate">{hop.ip}</p>
                            {hop.host !== hop.ip && <p className="text-gray-600 text-[10px] truncate">{hop.host}</p>}
                          </>
                        )}
                      </div>

                      <div className="col-span-3 text-right">
                        {hop.timeout ? (
                          <span className="text-gray-700 mono text-xs">—</span>
                        ) : (
                          <span className="font-bold mono text-sm transition-all duration-300" style={{ color }}>
                            {hop.latency != null ? `${hop.latency.toFixed(1)}ms` : '…'}
                            {isLive && <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-current opacity-70 animate-pulse" />}
                          </span>
                        )}
                      </div>

                      <div className="col-span-4 flex justify-end">
                        {hop.timeout ? (
                          <span className="tag tag-red text-[10px]">Sem resposta</span>
                        ) : hop.latency == null ? (
                          <span className="flex items-center gap-1 text-xs text-gray-600">
                            <Loader2 className="w-3 h-3 animate-spin" />medindo
                          </span>
                        ) : (
                          <span className="tag text-[10px]" style={{
                            background: `${color}15`, color, border: `1px solid ${color}30`
                          }}>
                            {latencyLabel(hop.latency)}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}

                {traceLoading && (
                  <div className="px-4 py-3 flex items-center gap-2 text-gray-600 text-xs border-b border-[#1a2744]/40">
                    <span className="flex gap-0.5">
                      <span className="w-1 h-1 rounded-full bg-[#00d4ff] animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1 h-1 rounded-full bg-[#00d4ff] animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1 h-1 rounded-full bg-[#00d4ff] animate-bounce" style={{ animationDelay: '300ms' }} />
                    </span>
                    Descobrindo próximo salto…
                  </div>
                )}

                {traceLive && traceDone && (
                  <div className="px-4 py-2.5 text-xs text-gray-600 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#00ff88] animate-pulse" />
                    {traceHops.filter(h => !h.timeout).length} saltos ativos · ping ao vivo a cada 1.5s
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* DNS TAB */}
      {tab === 'dns' && (
        <div className="space-y-4">
          {agentStatus === 'connected' ? (
            <div className="flex items-start gap-3 bg-green-500/5 border border-green-500/25 rounded-xl px-4 py-3 text-xs text-green-400">
              <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold mb-0.5">Agente Local — usando seu resolver DNS local</p>
                <p className="text-green-400/70">Resultados refletem o que o seu sistema operacional resolve — mostrando o DNS do seu roteador ou provedor.</p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3 bg-yellow-500/5 border border-yellow-500/20 rounded-xl px-4 py-3 text-xs text-yellow-400">
              <Server className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold mb-0.5">Consulta DNS pelo servidor cloud</p>
                <p className="text-yellow-400/70">Pode diferir do que o seu sistema resolve. Para ver seu DNS local: <code className="text-yellow-300">node scripts/local-agent.js</code>.</p>
              </div>
            </div>
          )}
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

      {/* DNS BENCHMARK TAB */}
      {tab === 'benchmark' && (
        <div className="space-y-4">
          <div className="card p-4 flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-48">
              <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">
                IP personalizado — gateway/DNS local <span className="text-gray-600 normal-case">(opcional)</span>
              </label>
              <input
                className="dark-input"
                value={benchCustomIp}
                onChange={e => setBenchCustomIp(e.target.value)}
                placeholder="ex: 192.168.1.1"
                onKeyDown={e => e.key === 'Enter' && !benchLoading && runBenchmark()}
              />
            </div>
            <button
              onClick={runBenchmark}
              disabled={benchLoading}
              className="btn-cyan px-5 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 disabled:opacity-50"
            >
              {benchLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              {benchLoading ? 'Testando…' : 'Iniciar Benchmark'}
            </button>
          </div>

          {benchLoading && benchResults.length === 0 && (
            <div className="card p-8 flex flex-col items-center gap-3 text-gray-500">
              <Loader2 className="w-8 h-8 animate-spin text-[#00d4ff]" />
              <p className="text-sm">Medindo latência ICMP para cada servidor DNS — aguarde…</p>
            </div>
          )}

          {benchDone && benchResults.length > 0 && (() => {
            const best    = benchResults.find(r => !r.timeout)
            const bestIsp = benchResults.find(r => !r.timeout && r.isp)
            const maxAvg  = Math.max(...benchResults.filter(r => !r.timeout).map(r => r.avg), 1)
            const ispResults    = benchResults.filter(r => r.isp)
            const publicResults = benchResults.filter(r => !r.isp)

            return (
              <div className="card p-5">
                {best && (
                  <div className="flex items-center gap-3 p-3 rounded-xl mb-4 border border-[#00d4ff]/20 bg-[#00d4ff]/5">
                    <span className="text-2xl">{best.flag}</span>
                    <div className="flex-1">
                      <p className="text-xs text-[#00d4ff] font-semibold uppercase tracking-wider mb-0.5">🏆 Mais rápido</p>
                      <p className="text-white font-bold">{best.name} <span className="text-gray-400 font-normal text-sm">({best.ip})</span></p>
                      <p className="text-xs text-gray-500 mt-0.5">Média {best.avg.toFixed(1)}ms · menor latência na sua rede</p>
                    </div>
                    <button
                      onClick={() => copyIp(best.ip)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#00d4ff]/30 text-[#00d4ff] hover:bg-[#00d4ff]/10 transition-all"
                    >
                      {copied === best.ip ? <><Check className="w-3 h-3" />Copiado!</> : <><Copy className="w-3 h-3" />Copiar IP</>}
                    </button>
                  </div>
                )}

                {bestIsp && !bestIsp.timeout && (
                  <div className="flex items-center gap-3 p-3 rounded-xl mb-5 border border-amber-500/20 bg-amber-500/5">
                    <span className="text-2xl">{bestIsp.flag}</span>
                    <div className="flex-1">
                      <p className="text-xs text-amber-400 font-semibold uppercase tracking-wider mb-0.5">🏠 DNS do Provedor</p>
                      <p className="text-white font-bold">{bestIsp.name} <span className="text-gray-400 font-normal text-sm">({bestIsp.ip})</span></p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Média {bestIsp.avg.toFixed(1)}ms ·{' '}
                        {best && !best.isp
                          ? bestIsp.avg <= best.avg
                            ? 'mais rápido que os DNS públicos'
                            : `${(bestIsp.avg - best.avg).toFixed(1)}ms mais lento que ${best.name}`
                          : 'detectado automaticamente'
                        }
                      </p>
                    </div>
                    <button
                      onClick={() => copyIp(bestIsp.ip)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-all"
                    >
                      {copied === bestIsp.ip ? <><Check className="w-3 h-3" />Copiado!</> : <><Copy className="w-3 h-3" />Copiar IP</>}
                    </button>
                  </div>
                )}

                {ispResults.length > 0 && (
                  <>
                    <p className="text-xs text-amber-400/70 font-semibold uppercase tracking-wider mb-2">DNS do Provedor (ISP)</p>
                    <div className="space-y-2 mb-5">
                      {ispResults.map(r => {
                        const rank   = benchResults.indexOf(r)
                        const barPct = r.timeout ? 100 : (r.avg / maxAvg) * 100
                        const color  = r.timeout ? '#ff4d4d' : '#f59e0b'
                        return (
                          <div key={r.ip} className="group">
                            <div className="flex items-center gap-3 mb-1">
                              <span className="text-gray-600 text-xs w-4 text-right shrink-0">{rank + 1}</span>
                              <span className="text-base shrink-0">{r.flag}</span>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm text-white font-medium truncate">{r.name}</span>
                                  <span className="text-xs text-gray-600 mono shrink-0">{r.ip}</span>
                                </div>
                                <div className="relative h-1.5 bg-white/5 rounded-full mt-1.5 overflow-hidden">
                                  <div className="absolute left-0 top-0 h-full rounded-full" style={{ width: `${barPct}%`, background: color }} />
                                </div>
                              </div>
                              <div className="text-right shrink-0 w-20">
                                {r.timeout ? <span className="text-xs text-red-400">Timeout</span>
                                  : <span className="text-sm font-bold mono" style={{ color }}>{r.avg.toFixed(1)}<span className="text-gray-500 text-xs font-normal ml-0.5">ms</span></span>}
                              </div>
                              <button onClick={() => copyIp(r.ip)} className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-600 hover:text-amber-400" title="Copiar IP">
                                {copied === r.ip ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}

                <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-2">DNS Públicos</p>
                <div className="space-y-2">
                  {publicResults.map(r => {
                    const rank   = benchResults.indexOf(r)
                    const barPct = r.timeout ? 100 : (r.avg / maxAvg) * 100
                    const color  = r.timeout ? '#ff4d4d' : rank === 0 ? '#00d4ff' : rank < 3 ? '#00ff88' : rank < 6 ? '#ffd700' : '#ff8800'
                    return (
                      <div key={r.ip} className="group">
                        <div className="flex items-center gap-3 mb-1">
                          <span className="text-gray-600 text-xs w-4 text-right shrink-0">{rank + 1}</span>
                          <span className="text-base shrink-0">{r.flag}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-white font-medium truncate">{r.name}</span>
                              <span className="text-xs text-gray-600 mono shrink-0">{r.ip}</span>
                            </div>
                            <div className="relative h-1.5 bg-white/5 rounded-full mt-1.5 overflow-hidden">
                              <div className="absolute left-0 top-0 h-full rounded-full" style={{ width: `${barPct}%`, background: color }} />
                            </div>
                          </div>
                          <div className="text-right shrink-0 w-20">
                            {r.timeout ? <span className="text-xs text-red-400">Timeout</span>
                              : <span className="text-sm font-bold mono" style={{ color }}>{r.avg.toFixed(1)}<span className="text-gray-500 text-xs font-normal ml-0.5">ms</span></span>}
                          </div>
                          <button onClick={() => copyIp(r.ip)} className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-600 hover:text-[#00d4ff]" title="Copiar IP">
                            {copied === r.ip ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {!benchIspFound && (
                  <p className="text-xs text-amber-500/60 mt-3">⚠ DNS do provedor não detectado automaticamente — use o campo personalizado para adicioná-lo manualmente.</p>
                )}

                <p className="text-xs text-gray-600 mt-4 text-center">
                  Medido via ICMP ping (OS) · 5 amostras por servidor · mesma precisão do CMD
                </p>
              </div>
            )
          })()}
        </div>
      )}

      {/* WHOIS TAB */}
      {tab === 'whois' && (
        <div className="space-y-4">
          <div className="card p-4 flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-48">
              <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Domínio</label>
              <input
                className="dark-input"
                value={whoisDomain}
                onChange={e => setWhoisDomain(e.target.value)}
                placeholder="ex: google.com"
                onKeyDown={e => e.key === 'Enter' && !whoisLoading && runWhois()}
              />
            </div>
            <button
              onClick={runWhois}
              disabled={whoisLoading}
              className="btn-cyan px-5 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 disabled:opacity-50"
            >
              {whoisLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSearch className="w-4 h-4" />}
              {whoisLoading ? 'Consultando…' : 'Consultar WHOIS'}
            </button>
          </div>

          {whoisError && (
            <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {whoisError}
            </div>
          )}

          {whoisResult && (
            <div className="space-y-4">
              <div className="card p-5">
                <div className="flex items-start justify-between gap-4 mb-5">
                  <div>
                    <h2 className="text-lg font-bold text-white">{whoisResult.domainName || whoisResult.domain}</h2>
                    {whoisResult.organization && (
                      <p className="text-sm text-gray-400 mt-0.5">{whoisResult.organization}</p>
                    )}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {whoisResult.status.slice(0, 4).map(s => {
                        const ok = s.toLowerCase().includes('active') || s.toLowerCase().includes('ok')
                        return (
                          <span key={s} className={`tag text-[10px] ${ok ? 'tag-green' : 'tag-yellow'}`}>
                            {s.split(' ')[0].replace('client', '').replace('server', '').trim() || s}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-gray-600">Consultado em</p>
                    <p className="text-xs text-gray-500 mono">{whoisResult.elapsed}ms</p>
                    <p className="text-xs text-gray-700 mt-1 mono">{whoisResult.server}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {whoisResult.registrar && (
                    <div className="bg-white/3 rounded-xl p-3.5">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Shield className="w-3.5 h-3.5 text-[#00d4ff]" />
                        <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Registrar</span>
                      </div>
                      <p className="text-sm text-white font-medium">{whoisResult.registrar}</p>
                      {whoisResult.registrarUrl && (
                        <a
                          href={whoisResult.registrarUrl.startsWith('http') ? whoisResult.registrarUrl : `https://${whoisResult.registrarUrl}`}
                          target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-[#00d4ff]/70 hover:text-[#00d4ff] mt-1 transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" />{whoisResult.registrarUrl}
                        </a>
                      )}
                    </div>
                  )}

                  {whoisResult.createdDate && (
                    <div className="bg-white/3 rounded-xl p-3.5">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Calendar className="w-3.5 h-3.5 text-[#00ff88]" />
                        <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Criado em</span>
                      </div>
                      <p className="text-sm text-white font-medium mono">
                        {whoisResult.createdDate.split('T')[0]}
                      </p>
                    </div>
                  )}

                  {whoisResult.expiresDate && (() => {
                    const exp = new Date(whoisResult.expiresDate)
                    const daysLeft = Math.ceil((exp.getTime() - Date.now()) / 86400000)
                    const expired = daysLeft < 0
                    const soon = daysLeft >= 0 && daysLeft <= 30
                    return (
                      <div className={`bg-white/3 rounded-xl p-3.5 ${expired ? 'border border-red-500/30' : soon ? 'border border-amber-500/30' : ''}`}>
                        <div className="flex items-center gap-2 mb-1.5">
                          <Calendar className={`w-3.5 h-3.5 ${expired ? 'text-red-400' : soon ? 'text-amber-400' : 'text-gray-400'}`} />
                          <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Expira em</span>
                        </div>
                        <p className={`text-sm font-medium mono ${expired ? 'text-red-400' : soon ? 'text-amber-400' : 'text-white'}`}>
                          {whoisResult.expiresDate.split('T')[0]}
                        </p>
                        <p className={`text-xs mt-0.5 ${expired ? 'text-red-400' : soon ? 'text-amber-400' : 'text-gray-500'}`}>
                          {expired ? `Expirado há ${Math.abs(daysLeft)} dias` : `${daysLeft} dias restantes`}
                        </p>
                      </div>
                    )
                  })()}

                  {whoisResult.updatedDate && (
                    <div className="bg-white/3 rounded-xl p-3.5">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Clock className="w-3.5 h-3.5 text-gray-500" />
                        <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Atualizado</span>
                      </div>
                      <p className="text-sm text-white mono">{whoisResult.updatedDate.split('T')[0]}</p>
                    </div>
                  )}

                  {whoisResult.country && (
                    <div className="bg-white/3 rounded-xl p-3.5">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Globe className="w-3.5 h-3.5 text-gray-500" />
                        <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold">País</span>
                      </div>
                      <p className="text-sm text-white">{whoisResult.country}</p>
                    </div>
                  )}

                  {whoisResult.dnssec && (
                    <div className="bg-white/3 rounded-xl p-3.5">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Shield className="w-3.5 h-3.5 text-gray-500" />
                        <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold">DNSSEC</span>
                      </div>
                      <p className="text-sm text-white">{whoisResult.dnssec}</p>
                    </div>
                  )}
                </div>
              </div>

              {whoisResult.nameServers.length > 0 && (
                <div className="card p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Server className="w-4 h-4 text-[#00d4ff]" />
                    <h3 className="text-sm font-semibold text-white">Name Servers</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {whoisResult.nameServers.map(ns => (
                      <div key={ns} className="flex items-center gap-2 bg-white/3 rounded-lg px-3 py-2">
                        <ChevronRight className="w-3 h-3 text-[#00d4ff] shrink-0" />
                        <span className="text-sm text-gray-300 mono truncate">{ns.toLowerCase()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {whoisResult.raw && (
                <div className="card overflow-hidden">
                  <button
                    onClick={() => setWhoisRawOpen(p => !p)}
                    className="w-full flex items-center justify-between px-5 py-3.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
                  >
                    <span className="font-semibold">Resposta bruta (raw WHOIS)</span>
                    {whoisRawOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {whoisRawOpen && (
                    <pre className="px-5 pb-5 text-xs text-gray-500 mono whitespace-pre-wrap break-all leading-5 max-h-96 overflow-y-auto border-t border-white/5">
                      {whoisResult.raw}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}

          {!whoisResult && !whoisLoading && !whoisError && (
            <div className="card p-10 flex flex-col items-center gap-3 text-gray-600">
              <FileSearch className="w-10 h-10 opacity-30" />
              <p className="text-sm">Digite um domínio e clique em Consultar WHOIS</p>
            </div>
          )}
        </div>
      )}

      {/* SCANNER TAB */}
      {tab === 'scanner' && (
        <div className="space-y-4">
          {/* Info banner */}
          {agentStatus === 'connected' ? (
            <div className="flex items-start gap-3 bg-green-500/5 border border-green-500/25 rounded-xl px-4 py-3 text-xs text-green-400">
              <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold mb-0.5">Agente Local — scan TCP a partir do seu dispositivo</p>
                <p className="text-green-400/70">
                  Alcança IPs internos da sua rede (<code className="text-green-300">192.168.x.x</code>, <code className="text-green-300">10.x.x.x</code>), roteadores, switches e outros dispositivos locais — impossível via servidor cloud.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3 bg-cyan-500/5 border border-cyan-500/20 rounded-xl px-4 py-3 text-xs text-cyan-300">
              <Terminal className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold mb-0.5">Scanner TCP de Portas (servidor cloud)</p>
                <p className="text-cyan-400/70">
                  Funciona apenas para hosts com acesso à internet. IPs internos (<code className="text-cyan-300">192.168.x.x</code>) são inacessíveis do servidor cloud.
                  Use <code className="text-cyan-300">node scripts/local-agent.js</code> para escanear sua rede local.
                </p>
              </div>
            </div>
          )}

          {/* Controls */}
          <div className="card p-4 space-y-3">
            <div className="flex flex-wrap items-end gap-4">
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
                disabled={scanLoading || !scanTarget.trim() || (scanMode === 'custom' && countCustomPorts(customPorts) === 0)}
                className="btn-cyan px-5 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 disabled:opacity-50"
              >
                {scanLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radar className="w-4 h-4" />}
                {scanLoading ? 'Scaneando...' : 'Iniciar Scan'}
              </button>
            </div>

            {/* Port mode selector */}
            <div>
              <label className="text-xs text-gray-500 mb-2 block uppercase tracking-wider">Portas a Escanear</label>
              <div className="flex gap-2 mb-2">
                <button
                  onClick={() => setScanMode('common')}
                  className={clsx('px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border', scanMode === 'common' ? 'bg-cyan-500/10 border-cyan-500/30 text-[#00d4ff]' : 'border-[#1a2744] text-gray-500 hover:text-gray-300')}
                >
                  Portas Comuns (30)
                </button>
                <button
                  onClick={() => setScanMode('custom')}
                  className={clsx('px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border', scanMode === 'custom' ? 'bg-cyan-500/10 border-cyan-500/30 text-[#00d4ff]' : 'border-[#1a2744] text-gray-500 hover:text-gray-300')}
                >
                  Personalizar
                </button>
              </div>

              {scanMode === 'custom' && (
                <div className="space-y-2">
                  <input
                    className="dark-input"
                    placeholder="ex: 80, 443, 22-25, 3306, 27017"
                    value={customPorts}
                    onChange={e => setCustomPorts(e.target.value)}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    {customPorts.trim() && (
                      <span className={clsx('text-xs mono', countCustomPorts(customPorts) > 500 ? 'text-red-400' : 'text-cyan-400')}>
                        {countCustomPorts(customPorts)} porta{countCustomPorts(customPorts) !== 1 ? 's' : ''}{countCustomPorts(customPorts) > 500 ? ' (máx 500)' : ''}
                      </span>
                    )}
                    <span className="text-xs text-gray-600">Presets:</span>
                    {[
                      { label: 'Web', value: '80, 443, 8080, 8443' },
                      { label: 'Bancos', value: '3306, 5432, 1433, 27017, 6379, 11211' },
                      { label: 'Email', value: '25, 110, 143, 587, 993, 995' },
                      { label: 'Remoto', value: '22, 23, 3389, 5900, 4444' },
                    ].map(p => (
                      <button
                        key={p.label}
                        onClick={() => setCustomPorts(p.value)}
                        className="text-xs px-2 py-0.5 rounded border border-[#1a2744] text-gray-500 hover:text-gray-300 hover:border-gray-500 transition-all"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Progress */}
          {scanLoading && (
            <div className="card p-4">
              <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
                <span className="flex items-center gap-2 flex-1 min-w-0">
                  <Radar className="w-3.5 h-3.5 animate-spin text-cyan-400 shrink-0" />
                  <span className="truncate">
                    {scanMode === 'custom'
                      ? `Testando ${countCustomPorts(customPorts)} porta${countCustomPorts(customPorts) !== 1 ? 's' : ''} personalizadas...`
                      : 'Testando 30 portas comuns em paralelo...'}
                  </span>
                </span>
                <span className="mono text-cyan-400">{Math.round(scanProgress)}%</span>
              </div>
              <div className="progress-bar">
                <div className="progress-fill transition-all duration-300" style={{ width: `${scanProgress}%` }} />
              </div>
              {scanMode === 'common' && (
                <p className="text-xs text-gray-600 mt-2">
                  FTP · SSH · Telnet · SMTP · DNS · HTTP · POP3 · IMAP · HTTPS · SMB · MySQL · PostgreSQL · Redis · MongoDB · RDP · VNC · Elasticsearch...
                </p>
              )}
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
              {scanMode === 'common' && (
                <p className="text-xs mt-1 text-gray-700">Portas escaneadas: FTP, SSH, Telnet, HTTP/S, SMB, MySQL, PostgreSQL, Redis, MongoDB, RDP, VNC e mais</p>
              )}
              {scanMode === 'custom' && customPorts.trim() && (
                <p className="text-xs mt-1 text-gray-700">{countCustomPorts(customPorts)} porta{countCustomPorts(customPorts) !== 1 ? 's' : ''} selecionada{countCustomPorts(customPorts) !== 1 ? 's' : ''}</p>
              )}
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
              {/* Action bar */}
              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  onClick={saveBaseline}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold border border-[#1a2744] text-gray-400 hover:text-white hover:border-gray-600 transition-all"
                >
                  <Save className="w-3.5 h-3.5" />
                  Salvar como Linha de Base
                </button>
                {baseline && (
                  <span className="text-xs text-gray-600 self-center">Base: {baseline.date}</span>
                )}
                <button
                  onClick={() => setReportModalOpen(true)}
                  className="flex items-center gap-2 btn-cyan px-3 py-2 rounded-lg text-xs font-semibold"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  Exportar Relatório PDF
                </button>
              </div>

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

              <ReportModal
                open={reportModalOpen}
                onClose={() => setReportModalOpen(false)}
                scan={scanResult!}
                analysis={analysis}
                ssl={sslResult}
                threat={threatResult}
                baseline={baseline}
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}
