import type { ScanResult, Analysis, SSLResult, ThreatResult, RiskLevel, BaselineSnapshot } from '@/types/network'

export type { BaselineSnapshot }

export interface ReportInput {
  client: { name: string; analyst: string; date: string }
  scan: ScanResult
  analysis: Analysis
  ssl?: SSLResult | null
  threat?: ThreatResult | null
  baseline?: BaselineSnapshot | null
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function scoreColor(s: number): string {
  if (s >= 80) return '#16a34a'
  if (s >= 60) return '#0284c7'
  if (s >= 40) return '#ca8a04'
  if (s >= 20) return '#ea580c'
  return '#dc2626'
}

function scoreLabel(s: number): string {
  if (s >= 80) return 'Bom'
  if (s >= 60) return 'Regular'
  if (s >= 40) return 'Ruim'
  if (s >= 20) return 'Crítico'
  return 'Comprometido'
}

const RISK_COLOR: Record<RiskLevel, string> = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#ca8a04',
  low: '#0284c7',
  info: '#6b7280',
}

const RISK_LABEL: Record<RiskLevel, string> = {
  critical: 'Crítico',
  high: 'Alto',
  medium: 'Médio',
  low: 'Baixo',
  info: 'Info',
}

const RISK_ORDER: RiskLevel[] = ['critical', 'high', 'medium', 'low', 'info']

function gauge(score: number, size: number): string {
  const r = 42
  const circ = 2 * Math.PI * r
  const fill = (score / 100) * circ
  const color = scoreColor(score)
  const label = scoreLabel(score)
  return `
    <div style="text-align:center;display:inline-block">
      <svg width="${size}" height="${size}" viewBox="0 0 100 100" style="display:block;transform:rotate(-90deg)">
        <circle cx="50" cy="50" r="${r}" fill="none" stroke="#e5e7eb" stroke-width="10"/>
        <circle cx="50" cy="50" r="${r}" fill="none" stroke="${color}" stroke-width="10"
          stroke-dasharray="${fill.toFixed(2)} ${circ.toFixed(2)}" stroke-linecap="round"/>
      </svg>
      <div style="margin-top:-${Math.round(size * 0.38)}px;font-size:${Math.round(size * 0.22)}px;font-weight:900;color:${color};font-family:monospace;line-height:1">${score}</div>
      <div style="margin-top:${Math.round(size * 0.34)}px;font-size:11px;color:${color};font-weight:600">${label}</div>
    </div>`
}

function badge(risk: RiskLevel): string {
  const color = RISK_COLOR[risk]
  const label = RISK_LABEL[risk]
  return `<span style="background:${color}20;color:${color};border:1px solid ${color}60;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;white-space:nowrap">${label}</span>`
}

function execSummary(
  scan: ScanResult,
  analysis: Analysis,
  baseline: BaselineSnapshot | null | undefined,
  resolved: ScanResult['open'],
  added: ScanResult['open'],
  delta: number | null,
): string {
  const lines: string[] = []

  if (scan.open.length === 0) {
    lines.push(`O scan de ${scan.total} portas em <strong>${esc(scan.host)}</strong> não detectou nenhum serviço exposto à internet. O host apresenta excelente postura de segurança perimetral.`)
  } else {
    lines.push(`O scan de ${scan.total} portas em <strong>${esc(scan.host)}</strong> (${esc(scan.ip)}) identificou <strong>${scan.open.length} serviço${scan.open.length !== 1 ? 's' : ''}</strong> exposto${scan.open.length !== 1 ? 's' : ''} à internet.`)
  }

  if (analysis.counts.critical > 0 || analysis.counts.high > 0) {
    const sev = analysis.counts.critical > 0 ? 'riscos críticos' : 'riscos de alto nível'
    lines.push(`Foram identificados <strong style="color:#dc2626">${analysis.counts.critical + analysis.counts.high} ${sev}</strong> que requerem ação imediata.`)
  }

  if (baseline && delta !== null) {
    if (delta > 0) {
      lines.push(`Em comparação à linha de base (${baseline.date}), o score de segurança <strong style="color:#16a34a">melhorou ${delta} pontos</strong> (de ${baseline.score} para ${analysis.score}).`)
    } else if (delta < 0) {
      lines.push(`Em comparação à linha de base (${baseline.date}), o score de segurança <strong style="color:#dc2626">piorou ${Math.abs(delta)} pontos</strong> (de ${baseline.score} para ${analysis.score}).`)
    } else {
      lines.push(`Em comparação à linha de base (${baseline.date}), o score de segurança permaneceu estável em ${analysis.score} pontos.`)
    }
    if (resolved.length > 0) {
      lines.push(`<strong style="color:#16a34a">${resolved.length} porta${resolved.length !== 1 ? 's' : ''}</strong> foi${resolved.length !== 1 ? 'ram' : ''} fechada${resolved.length !== 1 ? 's' : ''} desde a avaliação anterior.`)
    }
    if (added.length > 0) {
      lines.push(`<strong style="color:#ea580c">${added.length} nova${added.length !== 1 ? 's' : ''} porta${added.length !== 1 ? 's' : ''}</strong> foi${added.length !== 1 ? 'ram' : ''} identificada${added.length !== 1 ? 's' : ''} nesta avaliação.`)
    }
  }

  return lines.map(l => `<p style="margin-bottom:10px;line-height:1.7;color:#374151">${l}</p>`).join('')
}

function recommendations(analysis: Analysis, ssl: SSLResult | null, threat: ThreatResult | null): string {
  const items: { color: string; priority: string; text: string }[] = []

  if (analysis.counts.critical > 0) {
    items.push({ color: '#dc2626', priority: 'Urgente', text: 'Feche imediatamente os serviços de risco crítico (Telnet, RDP exposto, Redis, MongoDB, Jupyter, Shell/C2). Estes são alvos ativos de exploração automatizada.' })
  }
  if (analysis.counts.high > 0) {
    items.push({ color: '#ea580c', priority: 'Alta', text: 'Proteja bancos de dados (MySQL, PostgreSQL, MSSQL) atrás de firewall. Acesso deve ser feito exclusivamente via VPN ou túnel SSH, nunca diretamente pela internet.' })
  }
  if (analysis.findings.some(f => f.service === 'HTTP' || f.service === 'HTTP-Alt' || f.service === 'HTTP/Dev')) {
    items.push({ color: '#ca8a04', priority: 'Média', text: 'Migre todos os serviços HTTP para HTTPS. Configure redirecionamento automático HTTP → HTTPS e habilite HSTS (Strict-Transport-Security).' })
  }
  if (ssl && ssl.daysUntilExpiry < 30) {
    items.push({ color: '#ea580c', priority: 'Alta', text: `Certificado SSL expira em ${ssl.daysUntilExpiry} dias. Renove imediatamente para evitar interrupção de serviço e alertas nos navegadores dos usuários.` })
  }
  if (ssl && ssl.selfSigned) {
    items.push({ color: '#ca8a04', priority: 'Média', text: 'Substitua o certificado auto-assinado por um certificado emitido por CA reconhecida (ex: Let\'s Encrypt — gratuito) para eliminar avisos de segurança nos navegadores.' })
  }
  if (threat?.isTor || (threat?.listedCount ?? 0) > 0) {
    items.push({ color: '#dc2626', priority: 'Urgente', text: `IP listado em ${threat?.listedCount} lista(s) de bloqueio ou identificado como nó Tor. Investigue possível comprometimento e considere solicitar remoção das listas.` })
  }
  if (analysis.findings.some(f => f.service === 'SSH')) {
    items.push({ color: '#0284c7', priority: 'Baixa', text: 'No serviço SSH: desabilite autenticação por senha e use exclusivamente chaves RSA/Ed25519. Implemente fail2ban para bloquear brute force. Mova para porta não padrão se possível.' })
  }

  items.push({ color: '#6b7280', priority: 'Padrão', text: 'Implemente monitoramento contínuo com alertas para novas conexões nos serviços expostos. Configure firewall (iptables/nftables/cloud security groups) com política padrão de bloqueio.' })
  items.push({ color: '#6b7280', priority: 'Padrão', text: 'Mantenha todos os serviços atualizados. A grande maioria dos ataques bem-sucedidos exploram vulnerabilidades com patches disponíveis há meses ou anos.' })
  items.push({ color: '#6b7280', priority: 'Padrão', text: 'Implemente autenticação em dois fatores (2FA/MFA) em todos os serviços com acesso remoto, especialmente SSH, RDP, VPN e painéis administrativos.' })

  return items.map((item, i) => `
    <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px;padding:12px 14px;background:#f9fafb;border:1px solid #e5e7eb;border-left:4px solid ${item.color};border-radius:0 6px 6px 0">
      <div style="width:24px;height:24px;border-radius:50%;background:${item.color};color:white;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;flex-shrink:0">${i + 1}</div>
      <div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:${item.color};font-weight:700;margin-bottom:3px">${item.priority}</div>
        <div style="font-size:12px;color:#374151;line-height:1.6">${item.text}</div>
      </div>
    </div>
  `).join('')
}

function sectionNum(hasSsl: boolean, hasThreat: boolean, which: 'rec'): string {
  let n = 4
  if (hasSsl) n++
  if (hasThreat) n++
  return String(n)
}

export function generateReport(input: ReportInput): string {
  const { client, scan, analysis, ssl, threat, baseline } = input

  const totalCves = analysis.findings.reduce((s, f) => s + f.vuln.cves.length, 0)
  const delta = baseline ? analysis.score - baseline.score : null
  const currentPorts = new Set(scan.open.map(p => p.port))
  const basePorts = baseline ? new Set(baseline.scan.open.map(p => p.port)) : new Set<number>()
  const resolved = baseline ? baseline.scan.open.filter(p => !currentPorts.has(p.port)) : []
  const added = baseline ? scan.open.filter(p => !basePorts.has(p.port)) : []

  const sslSection = ssl && !ssl.error
  const threatSection = threat && !threat.error

  const sortedFindings = [...analysis.findings].sort(
    (a, b) => RISK_ORDER.indexOf(a.vuln.risk) - RISK_ORDER.indexOf(b.vuln.risk)
  )

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Relatório de Segurança — ${esc(scan.host)}</title>
<style>
@page { size: A4; margin: 18mm 15mm 18mm 15mm; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #111827; background: white; font-size: 13px; line-height: 1.5; }
a { color: inherit; text-decoration: none; }

/* ─── COVER ─── */
.cover { page-break-after: always; }
.cover-top { background: #0f172a; color: white; padding: 36px 40px 28px; }
.cover-brand { font-size: 14px; font-weight: 800; letter-spacing: 2px; color: #38bdf8; text-transform: uppercase; }
.cover-title { font-size: 26px; font-weight: 800; color: white; margin-top: 10px; line-height: 1.2; }
.cover-sub { font-size: 13px; color: #94a3b8; margin-top: 6px; }
.cover-body { padding: 36px 40px 28px; }
.meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px 40px; margin-bottom: 36px; }
.meta-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; font-weight: 600; margin-bottom: 3px; }
.meta-value { font-size: 15px; font-weight: 700; color: #111827; }
.meta-value.sm { font-size: 13px; font-weight: 400; color: #374151; }
.divider { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }

/* Score area */
.score-wrap { text-align: center; margin: 8px 0 28px; }
.score-flex { display: flex; justify-content: center; align-items: center; gap: 40px; }
.score-arrow { font-size: 36px; font-weight: 900; }
.score-sub { font-size: 11px; color: #6b7280; margin-top: 6px; }

/* Pills */
.pills { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }
.pill { border: 1px solid #e5e7eb; border-radius: 20px; padding: 10px 22px; text-align: center; background: #f9fafb; }
.pill-num { font-size: 28px; font-weight: 900; font-family: monospace; line-height: 1; }
.pill-lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; font-weight: 600; margin-top: 3px; }

/* ─── SECTIONS ─── */
.section { margin-bottom: 28px; }
.sec-head { background: #0f172a; color: white; padding: 9px 14px; border-radius: 6px 6px 0 0; display: flex; align-items: center; gap: 10px; }
.sec-num { width: 22px; height: 22px; background: #38bdf8; color: #0f172a; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 11px; flex-shrink: 0; }
.sec-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
.sec-body { border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 6px 6px; padding: 16px; }

.page-break { page-break-before: always; }

/* ─── EXEC SUMMARY ─── */
.kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 18px; }
.kpi { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px; text-align: center; }
.kpi-num { font-size: 32px; font-weight: 900; font-family: monospace; line-height: 1; }
.kpi-lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; font-weight: 600; margin-top: 4px; }

/* Risk bars */
.bar-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.bar-lbl { width: 52px; font-size: 11px; font-weight: 600; text-align: right; flex-shrink: 0; }
.bar-bg { flex: 1; background: #f3f4f6; border-radius: 4px; height: 14px; overflow: hidden; }
.bar-fill { height: 14px; border-radius: 4px; }
.bar-cnt { width: 18px; font-size: 11px; font-weight: 700; font-family: monospace; text-align: right; flex-shrink: 0; }

/* Comparison */
.cmp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 18px; }
.cmp-col { border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; }
.cmp-head { padding: 8px 12px; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
.cmp-row { padding: 7px 12px; border-top: 1px solid #f3f4f6; font-size: 12px; display: flex; align-items: center; gap: 8px; }
.tag-new { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; padding: 1px 6px; border-radius: 10px; font-size: 10px; font-weight: 700; }
.tag-res { background: #d1fae5; color: #065f46; border: 1px solid #6ee7b7; padding: 1px 6px; border-radius: 10px; font-size: 10px; font-weight: 700; }

/* ─── TABLE ─── */
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { background: #f9fafb; border-bottom: 2px solid #e5e7eb; padding: 8px 10px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; font-weight: 600; }
td { border-bottom: 1px solid #f3f4f6; padding: 8px 10px; vertical-align: middle; }
tr:last-child td { border-bottom: none; }
.mono { font-family: monospace; }
.port-cell { font-family: monospace; font-weight: 700; color: #0284c7; font-size: 13px; }
.svc-cell { font-weight: 600; }
.banner-cell { font-family: monospace; font-size: 10px; color: #6b7280; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ─── FINDINGS ─── */
.finding { border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 14px; overflow: hidden; page-break-inside: avoid; }
.find-head { padding: 10px 14px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.find-svc { font-weight: 700; font-size: 14px; }
.find-port { font-family: monospace; font-size: 11px; background: #f3f4f6; padding: 2px 8px; border-radius: 4px; color: #475569; }
.find-body { padding: 12px 14px; background: #fafafa; border-top: 1px solid #f3f4f6; }
.issue { display: flex; align-items: flex-start; gap: 7px; margin-bottom: 7px; font-size: 12px; color: #374151; }
.dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; margin-top: 5px; }
.cves { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0; }
.cve { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; font-family: monospace; }
.fix-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 4px; padding: 10px 12px; font-size: 12px; color: #166534; margin-top: 10px; }
.fix-lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; color: #15803d; margin-bottom: 4px; }
.banner-box { font-family: monospace; font-size: 11px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 6px 10px; color: #64748b; margin-bottom: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ─── SSL ─── */
.ssl-grid { display: grid; grid-template-columns: 80px 1fr; gap: 20px; align-items: start; }
.grade { font-size: 56px; font-weight: 900; font-family: monospace; line-height: 1; text-align: center; }
.ssl-row { display: flex; gap: 8px; font-size: 12px; margin-bottom: 6px; }
.ssl-k { color: #6b7280; width: 80px; flex-shrink: 0; }

/* ─── THREAT ─── */
.th-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 14px; }
.flags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.flag-danger { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; }
.flag-ok { background: #d1fae5; color: #065f46; border: 1px solid #6ee7b7; padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; }

/* ─── RECS ─── */
.rec { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 12px; padding: 12px 14px; background: #f9fafb; border: 1px solid #e5e7eb; border-left: 4px solid; border-radius: 0 6px 6px 0; }
.rec-num { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 11px; color: white; flex-shrink: 0; }
.rec-pri { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; margin-bottom: 3px; }
.rec-text { font-size: 12px; color: #374151; line-height: 1.6; }

/* ─── DISCLAIMER ─── */
.disclaimer { margin-top: 28px; padding: 12px 14px; background: #fffbeb; border: 1px solid #fcd34d; border-radius: 6px; font-size: 11px; color: #92400e; }

/* ─── FOOTER ─── */
.footer { margin-top: 32px; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 10px; color: #9ca3af; display: flex; justify-content: space-between; }

@media print {
  .no-print { display: none !important; }
}
</style>
</head>
<body>

<!-- ═══════════════ COVER PAGE ═══════════════ -->
<div class="cover">
  <div class="cover-top">
    <div class="cover-brand">&#128274; MySpeed Security</div>
    <div class="cover-title">Relatório de Análise de<br>Segurança de Rede</div>
    <div class="cover-sub">Auditoria de Exposição de Portas e Avaliação de Vulnerabilidades</div>
  </div>
  <div class="cover-body">
    <div class="meta-grid">
      <div>
        <div class="meta-label">Cliente</div>
        <div class="meta-value">${esc(client.name || 'Não informado')}</div>
      </div>
      <div>
        <div class="meta-label">Data do Relatório</div>
        <div class="meta-value sm">${esc(client.date)}</div>
      </div>
      <div>
        <div class="meta-label">Analista Responsável</div>
        <div class="meta-value">${esc(client.analyst || 'Não informado')}</div>
      </div>
      <div>
        <div class="meta-label">Alvo Analisado</div>
        <div class="meta-value sm">${esc(scan.host)}${scan.ip !== scan.host ? ` <span style="color:#6b7280;font-size:11px;font-weight:400">(${esc(scan.ip)})</span>` : ''}</div>
      </div>
    </div>

    <hr class="divider">

    <div class="score-wrap">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;font-weight:600;margin-bottom:18px">
        ${baseline ? 'Score de Segurança — Antes vs Depois' : 'Score de Segurança Atual'}
      </div>
      ${baseline
        ? `<div class="score-flex">
            <div>
              ${gauge(baseline.score, 120)}
              <div class="score-sub">Antes<br><small>${esc(baseline.date)}</small></div>
            </div>
            <div class="score-arrow" style="color:${delta! >= 0 ? '#16a34a' : '#dc2626'}">
              ${delta! >= 0 ? '&#9650;' : '&#9660;'}&nbsp;${Math.abs(delta!)}
            </div>
            <div>
              ${gauge(analysis.score, 120)}
              <div class="score-sub">Depois<br><small>${esc(client.date)}</small></div>
            </div>
          </div>`
        : gauge(analysis.score, 150)
      }
    </div>

    <hr class="divider">

    <div class="pills">
      <div class="pill">
        <div class="pill-num" style="color:${scan.open.length > 5 ? '#ea580c' : scan.open.length > 0 ? '#0284c7' : '#16a34a'}">${scan.open.length}</div>
        <div class="pill-lbl">Portas Abertas</div>
      </div>
      <div class="pill">
        <div class="pill-num" style="color:${analysis.counts.critical > 0 ? '#dc2626' : '#16a34a'}">${analysis.counts.critical}</div>
        <div class="pill-lbl">Críticas</div>
      </div>
      <div class="pill">
        <div class="pill-num" style="color:${analysis.counts.high > 0 ? '#ea580c' : '#16a34a'}">${analysis.counts.high}</div>
        <div class="pill-lbl">Alto Risco</div>
      </div>
      <div class="pill">
        <div class="pill-num">${totalCves}</div>
        <div class="pill-lbl">CVEs Conhecidos</div>
      </div>
      ${baseline ? `
      <div class="pill">
        <div class="pill-num" style="color:#16a34a">${resolved.length}</div>
        <div class="pill-lbl">Resolvidos</div>
      </div>
      <div class="pill">
        <div class="pill-num" style="color:${added.length > 0 ? '#ea580c' : '#16a34a'}">${added.length}</div>
        <div class="pill-lbl">Novos</div>
      </div>` : ''}
    </div>
  </div>
</div>

<!-- ═══════════════ SECTION 1: SUMÁRIO EXECUTIVO ═══════════════ -->
<div class="section page-break">
  <div class="sec-head">
    <div class="sec-num">1</div>
    <div class="sec-title">Sumário Executivo</div>
  </div>
  <div class="sec-body">
    <div class="kpi-row">
      <div class="kpi">
        <div class="kpi-num" style="color:${scoreColor(analysis.score)}">${analysis.score}</div>
        <div class="kpi-lbl">Score de Segurança</div>
      </div>
      <div class="kpi">
        <div class="kpi-num" style="color:${analysis.counts.critical + analysis.counts.high > 0 ? '#dc2626' : '#16a34a'}">${analysis.counts.critical + analysis.counts.high}</div>
        <div class="kpi-lbl">Riscos Crit./Altos</div>
      </div>
      <div class="kpi">
        <div class="kpi-num">${scan.open.length}</div>
        <div class="kpi-lbl">Serviços Expostos</div>
      </div>
      <div class="kpi">
        <div class="kpi-num">${totalCves}</div>
        <div class="kpi-lbl">CVEs Referenciados</div>
      </div>
    </div>

    ${execSummary(scan, analysis, baseline, resolved, added, delta)}

    <div style="margin-top:16px">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;font-weight:600;margin-bottom:10px">Distribuição de Risco</div>
      ${RISK_ORDER.map(r => {
        const count = analysis.counts[r]
        const maxCount = Math.max(...(Object.values(analysis.counts) as number[]), 1)
        const pct = (count / maxCount) * 100
        return `<div class="bar-row">
          <span class="bar-lbl" style="color:${RISK_COLOR[r]}">${RISK_LABEL[r]}</span>
          <div class="bar-bg"><div class="bar-fill" style="width:${pct.toFixed(1)}%;background:${RISK_COLOR[r]}"></div></div>
          <span class="bar-cnt" style="color:${count > 0 ? RISK_COLOR[r] : '#9ca3af'}">${count}</span>
        </div>`
      }).join('')}
    </div>

    ${baseline ? `
    <div class="cmp-grid">
      <div class="cmp-col">
        <div class="cmp-head" style="background:#fee2e2;color:#991b1b">Antes — ${esc(baseline.date)}</div>
        ${baseline.scan.open.length === 0
          ? '<div class="cmp-row" style="color:#6b7280">Nenhuma porta</div>'
          : baseline.scan.open.map(p => {
              const isResolved = !currentPorts.has(p.port)
              return `<div class="cmp-row">${isResolved ? '<span class="tag-res">RESOLVIDO</span>' : '<span style="color:#6b7280">&#9679;</span>'} <span class="mono" style="font-weight:700">${p.port}</span> ${esc(p.service)}</div>`
            }).join('')}
      </div>
      <div class="cmp-col">
        <div class="cmp-head" style="background:#d1fae5;color:#065f46">Depois — ${esc(client.date)}</div>
        ${scan.open.length === 0
          ? '<div class="cmp-row" style="color:#16a34a">&#10003; Nenhuma porta exposta</div>'
          : scan.open.map(p => {
              const isNew = !basePorts.has(p.port)
              return `<div class="cmp-row">${isNew ? '<span class="tag-new">NOVO</span>' : '<span style="color:#6b7280">&#9679;</span>'} <span class="mono" style="font-weight:700">${p.port}</span> ${esc(p.service)}</div>`
            }).join('')}
      </div>
    </div>` : ''}
  </div>
</div>

<!-- ═══════════════ SECTION 2: RESULTADOS DO SCAN ═══════════════ -->
<div class="section">
  <div class="sec-head">
    <div class="sec-num">2</div>
    <div class="sec-title">Resultados do Scan de Portas</div>
  </div>
  <div class="sec-body">
    <p style="font-size:11px;color:#6b7280;margin-bottom:12px">
      Portas escaneadas: <strong>${scan.total}</strong> &nbsp;&#183;&nbsp;
      Abertas: <strong>${scan.open.length}</strong> &nbsp;&#183;&nbsp;
      Fechadas/filtradas: <strong>${scan.total - scan.open.length}</strong>
    </p>

    ${scan.open.length === 0
      ? `<div style="text-align:center;padding:28px;color:#16a34a">
           <div style="font-size:36px;margin-bottom:8px">&#10003;</div>
           <div style="font-weight:700;font-size:15px">Nenhuma porta aberta detectada</div>
           <div style="font-size:11px;color:#6b7280;margin-top:4px">O host apresenta excelente postura de segurança perimetral.</div>
         </div>`
      : `<table>
           <thead>
             <tr>
               <th>Porta</th>
               <th>Serviço</th>
               <th>Risco</th>
               <th>Banner</th>
               ${baseline ? '<th>Status</th>' : ''}
             </tr>
           </thead>
           <tbody>
             ${sortedFindings.map(f => {
               const isNew = baseline ? !basePorts.has(f.port) : false
               return `<tr>
                 <td class="port-cell">${f.port}/tcp</td>
                 <td class="svc-cell">${esc(f.service)}</td>
                 <td>${badge(f.vuln.risk)}</td>
                 <td class="banner-cell">${f.banner ? esc(f.banner) : '—'}</td>
                 ${baseline ? `<td>${isNew ? '<span class="tag-new">NOVO</span>' : '<span style="color:#6b7280;font-size:11px">&#9679;</span>'}</td>` : ''}
               </tr>`
             }).join('')}
           </tbody>
         </table>
         ${resolved.length > 0 ? `
           <div style="margin-top:14px;padding:10px 14px;background:#d1fae5;border:1px solid #6ee7b7;border-radius:6px;font-size:12px">
             <strong style="color:#065f46">&#10003; Portas corrigidas desde a linha de base:</strong>
             ${resolved.map(p => `<span class="tag-res" style="margin-left:6px">${p.port}/${esc(p.service)}</span>`).join('')}
           </div>` : ''}
       `}
  </div>
</div>

<!-- ═══════════════ SECTION 3: ANÁLISE POR SERVIÇO ═══════════════ -->
<div class="section page-break">
  <div class="sec-head">
    <div class="sec-num">3</div>
    <div class="sec-title">Análise de Vulnerabilidades por Serviço</div>
  </div>
  <div class="sec-body">
    ${sortedFindings.length === 0
      ? `<div style="text-align:center;padding:24px;color:#16a34a;font-weight:600;font-size:14px">&#10003; Nenhum serviço exposto identificado.</div>`
      : sortedFindings.map(f => {
          const color = RISK_COLOR[f.vuln.risk]
          return `
            <div class="finding" style="border-left:4px solid ${color}">
              <div class="find-head" style="background:${color}12">
                <span class="find-svc">${esc(f.service)}</span>
                <span class="find-port">:${f.port}</span>
                ${badge(f.vuln.risk)}
              </div>
              <div class="find-body">
                ${f.banner ? `<div class="banner-box">Banner: ${esc(f.banner)}</div>` : ''}
                <div>
                  ${f.vuln.issues.map(iss => `
                    <div class="issue">
                      <div class="dot" style="background:${color}"></div>
                      <span>${esc(iss)}</span>
                    </div>`).join('')}
                </div>
                ${f.vuln.cves.length > 0 ? `
                  <div class="cves">
                    ${f.vuln.cves.map(cve => `<span class="cve">${esc(cve)}</span>`).join('')}
                  </div>` : ''}
                <div class="fix-box">
                  <div class="fix-lbl">&#10003; Recomendação</div>
                  ${esc(f.vuln.fix)}
                </div>
              </div>
            </div>`
        }).join('')}
  </div>
</div>

${sslSection ? `
<!-- ═══════════════ SECTION 4: SSL/TLS ═══════════════ -->
<div class="section">
  <div class="sec-head">
    <div class="sec-num">4</div>
    <div class="sec-title">Certificado SSL/TLS</div>
  </div>
  <div class="sec-body">
    <div class="ssl-grid">
      <div>
        <div class="grade" style="color:${ssl!.grade === 'A+' || ssl!.grade === 'A' ? '#16a34a' : ssl!.grade === 'B' ? '#ca8a04' : ssl!.grade === 'C' ? '#ea580c' : '#dc2626'}">${ssl!.grade}</div>
        <div style="font-size:10px;color:#6b7280;text-align:center;margin-top:4px">Nota TLS</div>
      </div>
      <div>
        <div class="ssl-row"><span class="ssl-k">Protocolo:</span> <strong>${esc(ssl!.protocol)}</strong></div>
        <div class="ssl-row"><span class="ssl-k">Validade:</span> <strong style="color:${ssl!.expired ? '#dc2626' : ssl!.daysUntilExpiry < 30 ? '#ca8a04' : '#16a34a'}">${ssl!.expired ? '&#9888; EXPIRADO' : ssl!.daysUntilExpiry + ' dias restantes'}</strong></div>
        <div class="ssl-row"><span class="ssl-k">Emissor:</span> ${esc(ssl!.issuer?.O ?? ssl!.issuer?.CN ?? '—')}</div>
        <div class="ssl-row"><span class="ssl-k">Cipher:</span> <span class="mono" style="font-size:11px">${esc(ssl!.cipher?.name ?? '—')}</span></div>
        ${ssl!.selfSigned ? '<div class="ssl-row"><span style="color:#dc2626;font-weight:600">&#9888; Certificado auto-assinado</span></div>' : ''}
      </div>
    </div>
    ${ssl!.issues?.length > 0 ? `
      <div style="margin-top:16px;padding-top:12px;border-top:1px solid #e5e7eb">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;font-weight:600;margin-bottom:10px">Problemas Identificados</div>
        ${ssl!.issues.map(iss => {
          const col = iss.severity === 'critical' ? '#dc2626' : iss.severity === 'high' ? '#ea580c' : iss.severity === 'medium' ? '#ca8a04' : '#0284c7'
          return `<div class="issue"><div class="dot" style="background:${col}"></div><span>${esc(iss.message)}</span></div>`
        }).join('')}
      </div>` : `<div style="margin-top:14px;color:#16a34a;font-size:12px">&#10003; Nenhum problema crítico de certificado identificado.</div>`}
  </div>
</div>` : ''}

${threatSection ? `
<!-- ═══════════════ SECTION ${sslSection ? '5' : '4'}: THREAT INTELLIGENCE ═══════════════ -->
<div class="section">
  <div class="sec-head">
    <div class="sec-num">${sslSection ? '5' : '4'}</div>
    <div class="sec-title">Inteligência de Ameaças</div>
  </div>
  <div class="sec-body">
    ${threat!.ipInfo ? `
    <div class="th-grid">
      <div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;font-weight:600;margin-bottom:8px">Informações do IP</div>
        <div class="ssl-row"><span class="ssl-k">IP:</span> <strong class="mono">${esc(threat!.ip)}</strong></div>
        <div class="ssl-row"><span class="ssl-k">Localização:</span> ${esc([threat!.ipInfo.city, threat!.ipInfo.country].filter(Boolean).join(', '))}</div>
        <div class="ssl-row"><span class="ssl-k">Provedor:</span> ${esc(threat!.ipInfo.org)}</div>
      </div>
      <div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;font-weight:600;margin-bottom:8px">Status de Ameaça</div>
        <div class="flags">
          ${threat!.isTor ? '<span class="flag-danger">&#9888; Nó Tor</span>' : ''}
          ${(threat!.listedCount ?? 0) > 0 ? `<span class="flag-danger">&#9888; DNSBL: ${threat!.listedCount} lista(s)</span>` : ''}
          ${!threat!.isTor && (threat!.listedCount ?? 0) === 0 ? '<span class="flag-ok">&#10003; Não listado em blacklists</span>' : ''}
        </div>
      </div>
    </div>` : ''}
    ${(threat!.dnsbl ?? []).some(d => d.listed) ? `
      <div style="padding-top:12px;border-top:1px solid #e5e7eb">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;font-weight:600;margin-bottom:8px">Listas Negras com Ocorrência</div>
        ${(threat!.dnsbl ?? []).filter(d => d.listed).map(d => `
          <div class="issue">
            <div class="dot" style="background:#dc2626"></div>
            <span><strong>${esc(d.name)}</strong> — ${esc(d.description)}</span>
          </div>`).join('')}
      </div>` : ''}
  </div>
</div>` : ''}

<!-- ═══════════════ SECTION ${sectionNum(!!sslSection, !!threatSection, 'rec')}: RECOMENDAÇÕES ═══════════════ -->
<div class="section">
  <div class="sec-head">
    <div class="sec-num" style="background:#fbbf24;color:#78350f">${sectionNum(!!sslSection, !!threatSection, 'rec')}</div>
    <div class="sec-title">Recomendações e Plano de Ação</div>
  </div>
  <div class="sec-body">
    ${recommendations(analysis, ssl ?? null, threat ?? null)}
    <div class="disclaimer">
      <strong>&#9888; Aviso Legal:</strong> Este relatório foi gerado para fins de auditoria autorizada e análise de segurança defensiva.
      Execute scans apenas em sistemas para os quais você possui autorização expressa por escrito.
      As recomendações devem ser avaliadas no contexto específico do ambiente antes da implementação.
    </div>
  </div>
</div>

<div class="footer">
  <span>MySpeed Security Report &mdash; ${esc(scan.host)} &mdash; ${esc(client.date)}</span>
  <span>Analista: ${esc(client.analyst || '—')} &nbsp;|&nbsp; Cliente: ${esc(client.name || '—')}</span>
</div>

<script>
  window.addEventListener('load', function() { setTimeout(function() { window.print() }, 600) })
</script>
</body>
</html>`
}
