'use client'

import { useState, useRef, useEffect } from 'react'
import {
  Shield, ShieldAlert, ShieldCheck, ShieldX, Lock, Globe, Search,
  AlertTriangle, CheckCircle, XCircle, Info, Loader2, Send, Bot,
  ChevronDown, ChevronUp, Mail, Server, Key, Wifi, Zap, Eye,
  RefreshCw, ExternalLink, Copy, Check
} from 'lucide-react'
import clsx from 'clsx'

type Tab = 'ssl' | 'dns' | 'threat' | 'assistant'

// ── SSL Types ──────────────────────────────────────────────────────────────────
interface SSLIssue { severity: 'critical' | 'high' | 'medium' | 'low'; message: string }
interface SSLResult {
  host: string; port: number
  subject: Record<string, string>; issuer: Record<string, string>
  validFrom: string; validTo: string
  daysUntilExpiry: number; expired: boolean; selfSigned: boolean
  protocol: string; cipher: { name: string; version: string }
  sans: string[]; fingerprint: string; serialNumber: string
  issues: SSLIssue[]; grade: 'A+' | 'A' | 'B' | 'C' | 'F'
  error?: string
}

// ── DNS Security Types ─────────────────────────────────────────────────────────
interface DNSSecResult {
  domain: string
  spf: { record: string | null; valid: boolean; mechanisms: string[]; issues: string[] } | null
  dmarc: { record: string | null; valid: boolean; policy: string; pct: number; issues: string[] } | null
  dkim: Array<{ selector: string; record: string }>
  mx: Array<{ exchange: string; priority: number }>
  dnssec: boolean
  issues: Array<{ severity: 'critical' | 'high' | 'medium' | 'low'; message: string }>
  score: number; scoreLabel: string
  error?: string
}

// ── Threat Types ───────────────────────────────────────────────────────────────
interface ThreatResult {
  ip: string; isPrivate?: boolean; message?: string
  ipInfo?: { city: string; region: string; country: string; org: string; asn: string; isp: string; hostname?: string; timezone?: string }
  asnClass?: { type: string; label: string }
  dnsbl?: Array<{ name: string; host: string; description: string; listed: boolean; returnCode: string | null }>
  isTor?: boolean; listedCount?: number
  riskScore?: number; riskLevel?: string; riskLabel?: string
  flags?: string[]
  error?: string
}

// ── Chat Types ─────────────────────────────────────────────────────────────────
interface ChatMessage { role: 'user' | 'assistant'; content: string }

// ── Helpers ────────────────────────────────────────────────────────────────────
const severityColor = (s: string) => ({
  critical: 'text-red-400', high: 'text-orange-400', medium: 'text-yellow-400', low: 'text-blue-400', clean: 'text-green-400'
})[s] ?? 'text-gray-400'

const severityBg = (s: string) => ({
  critical: 'bg-red-500/10 border-red-500/30', high: 'bg-orange-500/10 border-orange-500/30',
  medium: 'bg-yellow-500/10 border-yellow-500/30', low: 'bg-blue-500/10 border-blue-500/30'
})[s] ?? 'bg-gray-500/10 border-gray-500/30'

const gradeColor = (g: string) => ({ 'A+': '#00ff88', A: '#00d4ff', B: '#ffd700', C: '#ff8c00', F: '#ff4444' })[g] ?? '#888'

function ScoreBadge({ score, label }: { score: number; label: string }) {
  const color = score >= 80 ? '#00ff88' : score >= 60 ? '#00d4ff' : score >= 40 ? '#ffd700' : '#ff4444'
  return (
    <div className="flex items-center gap-3">
      <div className="relative w-16 h-16 shrink-0">
        <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="26" fill="none" stroke="#1a2744" strokeWidth="6" />
          <circle cx="32" cy="32" r="26" fill="none" stroke={color} strokeWidth="6"
            strokeDasharray={`${(score / 100) * 163.4} 163.4`} strokeLinecap="round" />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-sm font-bold mono" style={{ color }}>{score}</span>
      </div>
      <div>
        <p className="text-base font-bold" style={{ color }}>{label}</p>
        <p className="text-xs text-gray-500">Score de segurança</p>
      </div>
    </div>
  )
}

function IssueRow({ issue }: { issue: { severity: string; message: string } }) {
  const Icon = issue.severity === 'critical' ? XCircle : issue.severity === 'high' ? ShieldAlert : issue.severity === 'medium' ? AlertTriangle : Info
  return (
    <div className={clsx('flex items-start gap-3 p-3 rounded-lg border', severityBg(issue.severity))}>
      <Icon className={clsx('w-4 h-4 shrink-0 mt-0.5', severityColor(issue.severity))} />
      <span className="text-sm text-gray-300">{issue.message}</span>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
      className="p-1 text-gray-600 hover:text-gray-300 transition-colors">
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}

// ── Markdown renderer (simple) ─────────────────────────────────────────────────
function MarkdownText({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <div className="space-y-1 text-sm text-gray-300 leading-relaxed">
      {lines.map((line, i) => {
        if (line.startsWith('## ')) return <h3 key={i} className="text-white font-bold text-base mt-3 mb-1">{line.slice(3)}</h3>
        if (line.startsWith('### ')) return <h4 key={i} className="text-white font-semibold mt-2 mb-1">{line.slice(4)}</h4>
        if (line.startsWith('**') && line.endsWith('**')) return <p key={i} className="text-white font-semibold">{line.slice(2, -2)}</p>
        if (line.startsWith('- ') || line.startsWith('* ')) return <p key={i} className="flex gap-2"><span className="text-cyan-400 shrink-0">•</span><span dangerouslySetInnerHTML={{ __html: line.slice(2).replace(/\*\*(.*?)\*\*/g, '<strong class="text-white">$1</strong>').replace(/`(.*?)`/g, '<code class="bg-[#0a1128] text-cyan-300 px-1 rounded text-xs">$1</code>') }} /></p>
        if (line.match(/^\d+\. /)) return <p key={i} className="flex gap-2"><span className="text-cyan-400 shrink-0 mono text-xs">{line.match(/^(\d+)\./)?.[1]}.</span><span dangerouslySetInnerHTML={{ __html: line.replace(/^\d+\. /, '').replace(/\*\*(.*?)\*\*/g, '<strong class="text-white">$1</strong>').replace(/`(.*?)`/g, '<code class="bg-[#0a1128] text-cyan-300 px-1 rounded text-xs">$1</code>') }} /></p>
        if (line.startsWith('```')) return null
        if (!line.trim()) return <div key={i} className="h-1" />
        return <p key={i} dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.*?)\*\*/g, '<strong class="text-white">$1</strong>').replace(/`(.*?)`/g, '<code class="bg-[#0a1128] text-cyan-300 px-1 rounded text-xs">$1</code>') }} />
      })}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// SSL TAB
// ══════════════════════════════════════════════════════════════════════════════
function SSLTab() {
  const [host, setHost] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SSLResult | null>(null)
  const [showSANs, setShowSANs] = useState(false)

  const check = async () => {
    if (!host.trim()) return
    setLoading(true); setResult(null)
    try {
      const res = await fetch(`/api/ssl?host=${encodeURIComponent(host.trim())}`)
      setResult(await res.json())
    } finally { setLoading(false) }
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-56">
          <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Domínio ou IP</label>
          <input className="dark-input" placeholder="ex: google.com ou 192.168.1.1" value={host}
            onChange={e => setHost(e.target.value)} onKeyDown={e => e.key === 'Enter' && check()} />
        </div>
        <button onClick={check} disabled={loading || !host.trim()}
          className="btn-cyan px-5 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 disabled:opacity-50">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
          {loading ? 'Verificando...' : 'Verificar SSL'}
        </button>
      </div>

      {result && (
        result.error ? (
          <div className="card p-4 flex items-center gap-3 text-red-400">
            <XCircle className="w-5 h-5 shrink-0" /><span className="text-sm">{result.error}</span>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Header */}
            <div className="card p-5 flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center font-black text-lg"
                  style={{ background: `${gradeColor(result.grade)}20`, color: gradeColor(result.grade), border: `2px solid ${gradeColor(result.grade)}40` }}>
                  {result.grade}
                </div>
                <div>
                  <p className="text-white font-bold text-lg">{result.host}</p>
                  <p className="text-xs text-gray-500">{result.protocol} · {result.cipher.name}</p>
                </div>
              </div>
              <div className="flex gap-4 ml-auto flex-wrap">
                <div className="text-center">
                  <p className="text-2xl font-black mono" style={{ color: result.daysUntilExpiry < 30 ? '#ff4444' : result.daysUntilExpiry < 60 ? '#ffd700' : '#00ff88' }}>
                    {result.expired ? 'EXP' : result.daysUntilExpiry}
                  </p>
                  <p className="text-xs text-gray-500">dias restantes</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-black mono text-[#00d4ff]">{result.issues.length}</p>
                  <p className="text-xs text-gray-500">problemas</p>
                </div>
              </div>
            </div>

            {/* Issues */}
            {result.issues.length > 0 && (
              <div className="card p-4 space-y-2">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-orange-400" /> Problemas Detectados
                </h3>
                {result.issues.map((issue, i) => <IssueRow key={i} issue={issue} />)}
              </div>
            )}
            {result.issues.length === 0 && (
              <div className="card p-4 flex items-center gap-3 text-green-400">
                <ShieldCheck className="w-5 h-5" />
                <span className="text-sm font-semibold">Nenhum problema de segurança detectado</span>
              </div>
            )}

            {/* Details */}
            <div className="grid md:grid-cols-2 gap-4">
              <div className="card p-4 space-y-3">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Certificado</h3>
                {[
                  ['Emissor', result.issuer.O || result.issuer.CN],
                  ['Válido de', new Date(result.validFrom).toLocaleDateString('pt-BR')],
                  ['Válido até', new Date(result.validTo).toLocaleDateString('pt-BR')],
                  ['Auto-assinado', result.selfSigned ? 'Sim ⚠️' : 'Não'],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between text-sm">
                    <span className="text-gray-500">{k}</span>
                    <span className="text-gray-300 font-medium text-right max-w-48 truncate">{v}</span>
                  </div>
                ))}
              </div>
              <div className="card p-4 space-y-3">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Conexão</h3>
                {[
                  ['Protocolo', result.protocol],
                  ['Cipher Suite', result.cipher.name.split('-').slice(0, 3).join('-')],
                  ['Porta', String(result.port)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between text-sm">
                    <span className="text-gray-500">{k}</span>
                    <span className="text-gray-300 font-medium mono text-right">{v}</span>
                  </div>
                ))}
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Fingerprint</span>
                  <div className="flex items-center gap-1">
                    <span className="text-gray-600 mono text-xs">{result.fingerprint.slice(0, 20)}…</span>
                    <CopyButton text={result.fingerprint} />
                  </div>
                </div>
              </div>
            </div>

            {/* SANs */}
            {result.sans.length > 0 && (
              <div className="card p-4">
                <button className="w-full flex items-center justify-between text-xs font-semibold text-gray-500 uppercase tracking-wider"
                  onClick={() => setShowSANs(s => !s)}>
                  <span className="flex items-center gap-2"><Globe className="w-4 h-4" /> SANs ({result.sans.length} domínios)</span>
                  {showSANs ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                {showSANs && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {result.sans.map(s => <span key={s} className="tag tag-cyan text-xs mono">{s}</span>)}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// DNS SECURITY TAB
// ══════════════════════════════════════════════════════════════════════════════
function DNSSecurityTab() {
  const [domain, setDomain] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<DNSSecResult | null>(null)

  const check = async () => {
    if (!domain.trim()) return
    setLoading(true); setResult(null)
    try {
      const res = await fetch(`/api/dns-security?domain=${encodeURIComponent(domain.trim())}`)
      setResult(await res.json())
    } finally { setLoading(false) }
  }

  const StatusIcon = ({ ok }: { ok: boolean }) => ok
    ? <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
    : <XCircle className="w-4 h-4 text-red-400 shrink-0" />

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-56">
          <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Domínio</label>
          <input className="dark-input" placeholder="ex: empresa.com.br" value={domain}
            onChange={e => setDomain(e.target.value)} onKeyDown={e => e.key === 'Enter' && check()} />
        </div>
        <button onClick={check} disabled={loading || !domain.trim()}
          className="btn-cyan px-5 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 disabled:opacity-50">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
          {loading ? 'Analisando...' : 'Verificar DNS'}
        </button>
      </div>

      {result && !result.error && (
        <div className="space-y-4">
          {/* Score */}
          <div className="card p-5 flex flex-wrap items-center gap-6">
            <ScoreBadge score={result.score} label={result.scoreLabel} />
            <div className="flex gap-4 flex-wrap">
              {[
                { label: 'SPF', ok: !!result.spf?.valid, icon: Shield },
                { label: 'DMARC', ok: !!result.dmarc?.valid, icon: ShieldCheck },
                { label: 'DKIM', ok: result.dkim.length > 0, icon: Key },
                { label: 'DNSSEC', ok: result.dnssec, icon: Lock },
              ].map(({ label, ok, icon: Icon }) => (
                <div key={label} className={clsx('flex items-center gap-2 px-3 py-2 rounded-lg border', ok ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30')}>
                  <StatusIcon ok={ok} />
                  <span className="text-sm font-semibold" style={{ color: ok ? '#00ff88' : '#ff4444' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Issues */}
          {result.issues.length > 0 && (
            <div className="card p-4 space-y-2">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-400" /> Problemas de Segurança de Email
              </h3>
              {result.issues.map((issue, i) => <IssueRow key={i} issue={issue} />)}
            </div>
          )}

          {/* Records */}
          <div className="grid md:grid-cols-2 gap-4">
            {/* SPF */}
            <div className="card p-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Shield className="w-4 h-4" /> SPF
              </h3>
              {result.spf?.record ? (
                <>
                  <div className="bg-[#050a1a] rounded-lg p-3 mb-2 flex items-start gap-2">
                    <code className="text-xs text-cyan-300 break-all flex-1">{result.spf.record}</code>
                    <CopyButton text={result.spf.record} />
                  </div>
                  {result.spf.issues.map((iss, i) => <p key={i} className="text-xs text-yellow-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3 shrink-0" />{iss}</p>)}
                </>
              ) : <p className="text-sm text-red-400">❌ Registro SPF não encontrado</p>}
            </div>

            {/* DMARC */}
            <div className="card p-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" /> DMARC
              </h3>
              {result.dmarc?.record ? (
                <>
                  <div className="bg-[#050a1a] rounded-lg p-3 mb-2 flex items-start gap-2">
                    <code className="text-xs text-cyan-300 break-all flex-1">{result.dmarc.record}</code>
                    <CopyButton text={result.dmarc.record} />
                  </div>
                  <div className="flex gap-2 mt-2">
                    <span className="tag tag-cyan">p={result.dmarc.policy}</span>
                    <span className="tag tag-cyan">pct={result.dmarc.pct}%</span>
                  </div>
                  {result.dmarc.issues.map((iss, i) => <p key={i} className="text-xs text-yellow-400 flex items-center gap-1 mt-1"><AlertTriangle className="w-3 h-3 shrink-0" />{iss}</p>)}
                </>
              ) : <p className="text-sm text-red-400">❌ Registro DMARC não encontrado</p>}
            </div>
          </div>

          {/* DKIM */}
          <div className="card p-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Key className="w-4 h-4" /> DKIM ({result.dkim.length} seletor{result.dkim.length !== 1 ? 'es' : ''} encontrado{result.dkim.length !== 1 ? 's' : ''})
            </h3>
            {result.dkim.length > 0 ? (
              <div className="space-y-2">
                {result.dkim.map(d => (
                  <div key={d.selector} className="bg-[#050a1a] rounded-lg p-3 flex items-center gap-3">
                    <span className="tag tag-cyan shrink-0">{d.selector}</span>
                    <code className="text-xs text-gray-400 truncate flex-1">{d.record}</code>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-red-400">❌ Nenhuma chave DKIM detectada nos seletores comuns</p>}
          </div>

          {/* MX + DNSSEC */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="card p-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Mail className="w-4 h-4" /> Servidores MX
              </h3>
              {result.mx.length > 0
                ? result.mx.map((mx, i) => (
                    <div key={i} className="flex items-center justify-between text-sm py-1.5 border-b border-[#1a2744]/50 last:border-0">
                      <span className="text-gray-300 truncate">{mx.exchange}</span>
                      <span className="text-gray-600 mono text-xs shrink-0 ml-2">p={mx.priority}</span>
                    </div>
                  ))
                : <p className="text-sm text-gray-500">Nenhum registro MX</p>}
            </div>
            <div className="card p-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Lock className="w-4 h-4" /> DNSSEC
              </h3>
              <div className={clsx('flex items-center gap-3 p-3 rounded-lg border', result.dnssec ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30')}>
                <StatusIcon ok={result.dnssec} />
                <div>
                  <p className="text-sm font-semibold" style={{ color: result.dnssec ? '#00ff88' : '#ff4444' }}>
                    {result.dnssec ? 'DNSSEC Habilitado' : 'DNSSEC Desabilitado'}
                  </p>
                  <p className="text-xs text-gray-500">{result.dnssec ? 'Respostas DNS assinadas digitalmente' : 'Vulnerável a DNS cache poisoning'}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// THREAT INTELLIGENCE TAB
// ══════════════════════════════════════════════════════════════════════════════
function ThreatTab() {
  const [ip, setIp] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ThreatResult | null>(null)

  const check = async () => {
    if (!ip.trim()) return
    setLoading(true); setResult(null)
    try {
      const res = await fetch(`/api/threat?ip=${encodeURIComponent(ip.trim())}`)
      setResult(await res.json())
    } finally { setLoading(false) }
  }

  const riskColor = (level: string) => ({ critical: '#ff4444', high: '#ff8c00', medium: '#ffd700', low: '#00d4ff', clean: '#00ff88' })[level] ?? '#888'

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-56">
          <label className="text-xs text-gray-500 mb-1.5 block uppercase tracking-wider">Endereço IP</label>
          <input className="dark-input" placeholder="ex: 8.8.8.8 ou 187.49.218.114" value={ip}
            onChange={e => setIp(e.target.value)} onKeyDown={e => e.key === 'Enter' && check()} />
        </div>
        <button onClick={check} disabled={loading || !ip.trim()}
          className="btn-cyan px-5 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 disabled:opacity-50">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
          {loading ? 'Verificando...' : 'Verificar IP'}
        </button>
      </div>

      {result && (
        result.error ? (
          <div className="card p-4 flex items-center gap-3 text-red-400">
            <XCircle className="w-5 h-5 shrink-0" /><span className="text-sm">{result.error}</span>
          </div>
        ) : result.isPrivate ? (
          <div className="card p-4 flex items-center gap-3 text-blue-400">
            <Info className="w-5 h-5 shrink-0" /><span className="text-sm">{result.message}</span>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Risk header */}
            <div className="card p-5 flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center font-black text-2xl"
                  style={{ background: `${riskColor(result.riskLevel!)}15`, color: riskColor(result.riskLevel!), border: `2px solid ${riskColor(result.riskLevel!)}40` }}>
                  {result.listedCount! > 0 ? '!' : result.isTor ? 'T' : '✓'}
                </div>
                <div>
                  <p className="text-white font-bold text-xl mono">{result.ip}</p>
                  <p className="font-semibold" style={{ color: riskColor(result.riskLevel!) }}>{result.riskLabel}</p>
                  <p className="text-xs text-gray-500">{result.listedCount} lista{result.listedCount !== 1 ? 's' : ''} negra · Score: {result.riskScore}</p>
                </div>
              </div>
              {result.flags && result.flags.length > 0 && (
                <div className="flex flex-wrap gap-2 ml-auto">
                  {result.flags.map(f => <span key={f} className="tag tag-red text-xs">{f}</span>)}
                </div>
              )}
            </div>

            {/* IP Info */}
            {result.ipInfo && (
              <div className="card p-4">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Globe className="w-4 h-4" /> Informações do IP
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    ['Localização', `${result.ipInfo.city}, ${result.ipInfo.region}, ${result.ipInfo.country}`],
                    ['ISP / Org', result.ipInfo.isp || result.ipInfo.org],
                    ['ASN', result.ipInfo.asn],
                    ['Tipo', result.asnClass?.label],
                    ['Hostname', result.ipInfo.hostname || '—'],
                    ['Timezone', result.ipInfo.timezone ?? '—'],
                  ].map(([k, v]) => v && (
                    <div key={k} className="bg-[#050a1a] rounded-lg p-3">
                      <p className="text-xs text-gray-600 mb-1">{k}</p>
                      <p className="text-sm text-gray-300 font-medium truncate">{v}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* DNSBL */}
            <div className="card p-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                <ShieldX className="w-4 h-4" /> Listas Negras (DNSBL)
              </h3>
              <div className="space-y-2">
                {result.dnsbl?.map(d => (
                  <div key={d.name} className={clsx('flex items-center justify-between p-3 rounded-lg border',
                    d.listed ? 'bg-red-500/10 border-red-500/30' : 'bg-green-500/5 border-green-500/10')}>
                    <div>
                      <p className="text-sm font-semibold text-white">{d.name}</p>
                      <p className="text-xs text-gray-500">{d.description}</p>
                    </div>
                    {d.listed
                      ? <span className="tag tag-red shrink-0">LISTADO</span>
                      : <span className="tag tag-green shrink-0">Limpo</span>}
                  </div>
                ))}
                {result.isTor && (
                  <div className="flex items-center justify-between p-3 rounded-lg border bg-orange-500/10 border-orange-500/30">
                    <div>
                      <p className="text-sm font-semibold text-white">Tor Project</p>
                      <p className="text-xs text-gray-500">Base de nós de saída da rede Tor</p>
                    </div>
                    <span className="tag tag-red shrink-0">NÓ TOR</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// AI ASSISTANT TAB
// ══════════════════════════════════════════════════════════════════════════════
function AssistantTab() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: 'Olá! Sou o **NetGuard AI**, seu assistente de segurança de redes. Posso ajudar a interpretar resultados de varreduras, analisar configurações SSL/DNS, identificar vulnerabilidades e recomendar mitigações.\n\nO que gostaria de analisar hoje?' }
  ])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const send = async () => {
    const text = input.trim()
    if (!text || streaming) return
    setInput('')
    const newMessages: ChatMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(newMessages)
    setStreaming(true)

    const assistantMsg: ChatMessage = { role: 'assistant', content: '' }
    setMessages(m => [...m, assistantMsg])

    try {
      const res = await fetch('/api/ai-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages.map(m => ({ role: m.role, content: m.content })) }),
      })

      if (!res.ok) { setMessages(m => { const a = [...m]; a[a.length - 1] = { role: 'assistant', content: '❌ Erro ao conectar ao assistente. Verifique a chave ANTHROPIC_API_KEY nas configurações do servidor.' }; return a }); return }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const { text } = JSON.parse(line.slice(6))
            setMessages(m => { const a = [...m]; a[a.length - 1] = { ...a[a.length - 1], content: a[a.length - 1].content + text }; return a })
          } catch { /* skip */ }
        }
      }
    } catch {
      setMessages(m => { const a = [...m]; a[a.length - 1] = { role: 'assistant', content: '❌ Falha na conexão.' }; return a })
    } finally { setStreaming(false) }
  }

  const quickPrompts = [
    'O que é SMBv1 e por que é perigoso?',
    'Como configurar DMARC corretamente?',
    'Quais portas devo fechar no firewall?',
    'Como detectar um ataque de força bruta no RDP?',
  ]

  return (
    <div className="flex flex-col h-[70vh]">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1 mb-4">
        {messages.map((msg, i) => (
          <div key={i} className={clsx('flex gap-3', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
            {msg.role === 'assistant' && (
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-purple-600 flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="w-4 h-4 text-white" />
              </div>
            )}
            <div className={clsx('max-w-[85%] rounded-2xl px-4 py-3', msg.role === 'user' ? 'bg-cyan-500/10 border border-cyan-500/20 rounded-tr-sm' : 'bg-[#0d1a35] border border-[#1a2744] rounded-tl-sm')}>
              {msg.role === 'assistant'
                ? <MarkdownText text={msg.content || (streaming && i === messages.length - 1 ? '▋' : '')} />
                : <p className="text-sm text-gray-200">{msg.content}</p>}
            </div>
          </div>
        ))}
        {streaming && messages[messages.length - 1]?.content === '' && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-purple-600 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div className="bg-[#0d1a35] border border-[#1a2744] rounded-2xl rounded-tl-sm px-4 py-3">
              <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick prompts */}
      {messages.length <= 1 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {quickPrompts.map(p => (
            <button key={p} onClick={() => { setInput(p) }}
              className="text-xs px-3 py-1.5 rounded-lg border border-[#1a2744] text-gray-400 hover:text-gray-200 hover:border-cyan-500/40 hover:bg-cyan-500/5 transition-all">
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="card p-3 flex items-end gap-3">
        <textarea
          ref={inputRef}
          className="flex-1 bg-transparent text-sm text-gray-200 placeholder-gray-600 outline-none resize-none max-h-32 min-h-[40px]"
          placeholder="Pergunte sobre segurança de redes, vulnerabilidades, configurações..."
          value={input} rows={1}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
        />
        <button onClick={send} disabled={!input.trim() || streaming}
          className="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-400 to-purple-600 flex items-center justify-center shrink-0 disabled:opacity-40 transition-opacity">
          {streaming ? <Loader2 className="w-4 h-4 text-white animate-spin" /> : <Send className="w-4 h-4 text-white" />}
        </button>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════════════════════
export default function SecurityPage() {
  const [tab, setTab] = useState<Tab>('ssl')

  const tabs = [
    { id: 'ssl' as Tab, icon: Lock, label: 'SSL / TLS' },
    { id: 'dns' as Tab, icon: Mail, label: 'Segurança de Email' },
    { id: 'threat' as Tab, icon: Eye, label: 'Reputação de IP' },
    { id: 'assistant' as Tab, icon: Bot, label: 'NetGuard AI' },
  ]

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-purple-600 flex items-center justify-center">
            <Shield className="w-4 h-4 text-white" />
          </div>
          <h1 className="text-xl md:text-2xl font-bold text-white">Centro de Segurança</h1>
        </div>
        <p className="text-sm text-gray-500 ml-11">SSL/TLS · Segurança de Email · Reputação de IP · Assistente IA</p>
      </div>

      {/* Tab Nav */}
      <div className="flex gap-1 mb-6 bg-[#0a1128] rounded-xl p-1 border border-[#1a2744] overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={clsx('flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all whitespace-nowrap flex-1 justify-center',
              tab === t.id ? 'bg-[#1a2744] text-white' : 'text-gray-500 hover:text-gray-300')}>
            <t.icon className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {tab === 'ssl' && <SSLTab />}
      {tab === 'dns' && <DNSSecurityTab />}
      {tab === 'threat' && <ThreatTab />}
      {tab === 'assistant' && <AssistantTab />}
    </div>
  )
}
