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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RISK_LABEL: Record<RiskLevel, string> = {
  critical: 'Crítico',
  high: 'Alto',
  medium: 'Médio',
  low: 'Baixo',
  info: 'Info',
}

const RISK_COLOR: Record<RiskLevel, string> = {
  critical: '#ff4d4d',
  high:     '#ff8c00',
  medium:   '#ffd700',
  low:      '#00d4ff',
  info:     '#6b7280',
}

const RISK_BG: Record<RiskLevel, string> = {
  critical: '#3d0000',
  high:     '#3d1a00',
  medium:   '#3d3300',
  low:      '#003d4d',
  info:     '#1a1a2e',
}

function scoreColor(s: number): string {
  if (s >= 80) return '#00c853'
  if (s >= 60) return '#00b0d4'
  if (s >= 40) return '#ffd600'
  if (s >= 20) return '#ff8c00'
  return '#ff4d4d'
}

function scoreLabel(s: number): string {
  if (s >= 80) return 'Bom'
  if (s >= 60) return 'Regular'
  if (s >= 40) return 'Ruim'
  if (s >= 20) return 'Crítico'
  return 'Comprometido'
}

function sslGradeColor(grade: string): string {
  if (grade === 'A+' || grade === 'A') return '#00c853'
  if (grade === 'B') return '#ffd600'
  if (grade === 'C') return '#ff8c00'
  return '#ff4d4d'
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ─── SVG Gauge ────────────────────────────────────────────────────────────────

function svgGauge(score: number, size: number = 120): string {
  const r = size * 0.38
  const cx = size / 2
  const cy = size / 2
  const circumference = 2 * Math.PI * r
  const filled = (score / 100) * circumference
  const col = scoreColor(score)
  const strokeW = size * 0.09
  const fontSize = size * 0.22

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" style="display:block;">
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#1e293b" stroke-width="${strokeW}"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
    stroke="${col}" stroke-width="${strokeW}"
    stroke-dasharray="${filled.toFixed(2)} ${circumference.toFixed(2)}"
    stroke-linecap="round"
    transform="rotate(-90 ${cx} ${cy})"/>
  <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central"
    font-family="system-ui,-apple-system,sans-serif"
    font-size="${fontSize}" font-weight="900" fill="${col}">${score}</text>
</svg>`
}

// ─── Badge helpers ────────────────────────────────────────────────────────────

function riskBadge(risk: RiskLevel): string {
  const col = RISK_COLOR[risk]
  const bg  = RISK_BG[risk]
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;background:${bg};color:${col};border:1px solid ${col}33;">${RISK_LABEL[risk]}</span>`
}

function cveBadge(cve: string): string {
  return `<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;background:#3d0000;color:#ff4d4d;border:1px solid #ff4d4d44;font-family:monospace;">${esc(cve)}</span>`
}

function tagBadge(label: string, color: string, bg: string): string {
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;background:${bg};color:${color};border:1px solid ${color}55;">${esc(label)}</span>`
}

// ─── Section header ───────────────────────────────────────────────────────────

function sectionHeader(num: string, title: string): string {
  return `<div class="section-header">
  <span class="section-num">${num}</span>
  <span class="section-title">${esc(title)}</span>
</div>`
}

// ─── Main generator ───────────────────────────────────────────────────────────

export function generateReport(input: ReportInput): string {
  const { client, scan, analysis, ssl, threat, baseline } = input

  const totalCves = analysis.findings.reduce((s, f) => s + f.vuln.cves.length, 0)
  const delta = baseline != null ? analysis.score - baseline.score : null

  // ── Page 1: Cover ────────────────────────────────────────────────────────────
  const coverScoreSection = baseline != null
    ? `<div class="cover-scores">
  <div class="cover-score-box">
    <p class="cover-score-label">Antes</p>
    ${svgGauge(baseline.score, 110)}
    <p class="cover-score-sub" style="color:${scoreColor(baseline.score)}">${scoreLabel(baseline.score)}</p>
    <p class="cover-score-date">${esc(baseline.date)}</p>
  </div>
  <div class="cover-score-arrow">
    <span style="color:${delta !== null && delta >= 0 ? '#00c853' : '#ff4d4d'};font-size:36px;font-weight:900;">${delta !== null && delta >= 0 ? '&#x2191;' : '&#x2193;'}</span>
    <p style="font-size:22px;font-weight:900;color:${delta !== null && delta >= 0 ? '#00c853' : '#ff4d4d'};">${delta !== null ? (delta >= 0 ? '+' : '') + delta : ''}</p>
    <p style="font-size:11px;color:#64748b;">pontos</p>
  </div>
  <div class="cover-score-box">
    <p class="cover-score-label">Depois</p>
    ${svgGauge(analysis.score, 110)}
    <p class="cover-score-sub" style="color:${scoreColor(analysis.score)}">${scoreLabel(analysis.score)}</p>
    <p class="cover-score-date">${esc(client.date)}</p>
  </div>
</div>`
    : `<div style="display:flex;justify-content:center;margin:24px 0;">
  ${svgGauge(analysis.score, 150)}
</div>
<p style="text-align:center;font-size:20px;font-weight:700;color:${scoreColor(analysis.score)};margin:0 0 4px;">${scoreLabel(analysis.score)}</p>
<p style="text-align:center;font-size:13px;color:#64748b;margin:0;">Score de Segurança</p>`

  const coverPage = `<div class="page">
<div class="cover-header">
  <div class="cover-logo">&#x1F6E1;</div>
  <h1 class="cover-title">RELATÓRIO DE ANÁLISE<br>DE SEGURANÇA DE REDE</h1>
  <p class="cover-subtitle">Avaliação de Vulnerabilidades e Exposição de Serviços</p>
</div>

<div class="cover-meta">
  <table class="cover-meta-table">
    <tr><td class="meta-label">Cliente</td><td class="meta-value">${esc(client.name || '—')}</td></tr>
    <tr><td class="meta-label">Analista</td><td class="meta-value">${esc(client.analyst || '—')}</td></tr>
    <tr><td class="meta-label">Data do Relatório</td><td class="meta-value">${esc(client.date)}</td></tr>
    <tr><td class="meta-label">Alvo Analisado</td><td class="meta-value mono">${esc(scan.host)}${scan.ip !== scan.host ? ` <span style="color:#64748b;">(${esc(scan.ip)})</span>` : ''}</td></tr>
  </table>
</div>

${coverScoreSection}

<div class="cover-summary">
  <div class="cover-summary-item">
    <span class="cover-summary-num">${scan.open.length}</span>
    <span class="cover-summary-label">Portas Abertas</span>
  </div>
  <div class="cover-summary-divider"></div>
  <div class="cover-summary-item">
    <span class="cover-summary-num" style="color:#ff4d4d;">${analysis.counts.critical}</span>
    <span class="cover-summary-label">Críticas</span>
  </div>
  <div class="cover-summary-divider"></div>
  <div class="cover-summary-item">
    <span class="cover-summary-num" style="color:#ff8c00;">${analysis.counts.high}</span>
    <span class="cover-summary-label">Altas</span>
  </div>
  <div class="cover-summary-divider"></div>
  <div class="cover-summary-item">
    <span class="cover-summary-num" style="color:#ffd700;">${totalCves}</span>
    <span class="cover-summary-label">CVEs Conhecidos</span>
  </div>
</div>

<div style="margin-top:32px;padding:16px;background:#0f172a;border-radius:8px;border:1px solid #1e3a5f;">
  <p style="font-size:11px;color:#64748b;margin:0;text-align:center;">
    CONFIDENCIAL — Este documento contém informações sensíveis de segurança. Distribua apenas para pessoal autorizado.
  </p>
</div>
</div>`

  // ── Page 2: Sumário Executivo ─────────────────────────────────────────────

  const execPage = `<div class="page" style="page-break-before:always;">
${sectionHeader('1.', 'Sumário Executivo')}

<p class="prose">
  Esta análise foi realizada em <strong>${esc(client.date)}</strong> no host <span class="mono">${esc(scan.host)}</span>
  (IP: <span class="mono">${esc(scan.ip)}</span>). Foram escaneadas <strong>${scan.scanned}</strong> portas,
  das quais <strong>${scan.open.length}</strong> estavam abertas e acessíveis.
</p>

<div class="exec-score-row">
  <div class="exec-gauge">
    ${svgGauge(analysis.score, 100)}
    <p class="exec-gauge-label" style="color:${scoreColor(analysis.score)}">${scoreLabel(analysis.score)}</p>
  </div>
  <div style="flex:1;">
    <h3 style="margin:0 0 12px;font-size:14px;color:#e2e8f0;">Distribuição de Riscos</h3>
    ${(['critical', 'high', 'medium', 'low', 'info'] as RiskLevel[]).map(r => {
      const count = analysis.counts[r]
      const pct = analysis.findings.length > 0 ? Math.round((count / analysis.findings.length) * 100) : 0
      return `<div style="margin-bottom:8px;">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;">
    <span style="font-size:12px;color:${RISK_COLOR[r]};width:50px;font-weight:600;">${RISK_LABEL[r]}</span>
    <div style="flex:1;background:#1e293b;border-radius:4px;height:8px;">
      <div style="width:${pct}%;background:${RISK_COLOR[r]};border-radius:4px;height:8px;"></div>
    </div>
    <span style="font-size:12px;color:${count > 0 ? RISK_COLOR[r] : '#64748b'};width:16px;text-align:right;font-weight:700;">${count}</span>
  </div>
</div>`
    }).join('')}
  </div>
</div>

<div class="info-grid">
  <div class="info-box">
    <h4 class="info-box-title">Avaliação Geral</h4>
    <p class="prose">
      ${analysis.counts.critical > 0
        ? `O host apresenta <strong style="color:#ff4d4d;">${analysis.counts.critical} serviço(s) crítico(s)</strong> que requerem atenção imediata. Esses serviços representam riscos graves de comprometimento.`
        : analysis.counts.high > 0
        ? `Foram identificados <strong style="color:#ff8c00;">${analysis.counts.high} serviço(s) de alto risco</strong>. Recomenda-se ação corretiva urgente.`
        : 'Nenhuma vulnerabilidade crítica ou alta foi identificada. O host apresenta uma postura de segurança razoável.'
      }
    </p>
  </div>
  ${baseline != null ? `<div class="info-box">
    <h4 class="info-box-title">Comparativo Antes/Depois</h4>
    <p class="prose">
      ${delta !== null && delta > 0
        ? `O score <strong style="color:#00c853;">melhorou ${delta} pontos</strong> (${baseline.score} &#x2192; ${analysis.score}).`
        : delta !== null && delta < 0
        ? `O score <strong style="color:#ff4d4d;">regrediu ${Math.abs(delta)} pontos</strong> (${baseline.score} &#x2192; ${analysis.score}).`
        : 'O score permaneceu inalterado em relação à linha de base.'
      }
    </p>
  </div>` : ''}
</div>

<h3 class="subsection-title">Portas Identificadas</h3>
<table class="data-table">
  <thead>
    <tr>
      <th>Porta</th>
      <th>Serviço</th>
      <th>Risco</th>
      <th>Banner</th>
      ${baseline != null ? '<th>Status</th>' : ''}
    </tr>
  </thead>
  <tbody>
    ${scan.open.map(p => {
      const finding = analysis.findings.find(f => f.port === p.port)
      const risk: RiskLevel = finding?.vuln.risk ?? 'info'
      let statusTag = ''
      if (baseline != null) {
        const wasOpen = baseline.scan.open.some(bp => bp.port === p.port)
        if (!wasOpen) statusTag = tagBadge('NOVO', '#00c853', '#003d1a')
      }
      return `<tr>
  <td class="mono" style="color:#00b0d4;font-weight:700;">${p.port}</td>
  <td style="font-weight:600;">${esc(p.service)}</td>
  <td>${riskBadge(risk)}</td>
  <td style="font-size:11px;color:#64748b;font-family:monospace;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.banner ? esc(p.banner) : '—'}</td>
  ${baseline != null ? `<td>${statusTag}</td>` : ''}
</tr>`
    }).join('')}
    ${baseline != null ? baseline.scan.open
      .filter(bp => !scan.open.some(p => p.port === bp.port))
      .map(bp => `<tr style="opacity:0.5;">
  <td class="mono" style="color:#64748b;font-weight:700;">${bp.port}</td>
  <td style="color:#64748b;">${esc(bp.service)}</td>
  <td>${riskBadge('info')}</td>
  <td style="color:#64748b;">—</td>
  <td>${tagBadge('RESOLVIDO', '#00c853', '#003d1a')}</td>
</tr>`).join('') : ''}
  </tbody>
</table>
</div>`

  // ── Page 3+: Service Analysis ──────────────────────────────────────────────

  const sortedFindings = [...analysis.findings].sort((a, b) => {
    const order: RiskLevel[] = ['critical', 'high', 'medium', 'low', 'info']
    return order.indexOf(a.vuln.risk) - order.indexOf(b.vuln.risk)
  })

  const serviceAnalysisPage = `<div class="page" style="page-break-before:always;">
${sectionHeader('2.', 'Análise Detalhada por Serviço')}

${sortedFindings.length === 0
  ? '<p class="prose" style="color:#00c853;">Nenhuma vulnerabilidade identificada nas portas escaneadas.</p>'
  : sortedFindings.map((f, idx) => {
    const rc = RISK_COLOR[f.vuln.risk]
    const bg = RISK_BG[f.vuln.risk]
    return `<div class="finding-card" style="border-left:4px solid ${rc};margin-bottom:20px;">
  <div class="finding-header" style="background:${bg};">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <span style="font-size:15px;font-weight:800;color:${rc};">2.${idx + 1}</span>
      <span style="font-size:15px;font-weight:700;color:#f1f5f9;">${esc(f.service)}</span>
      <span class="mono" style="font-size:12px;color:#00b0d4;background:#0f172a;padding:2px 8px;border-radius:4px;">:${f.port}</span>
      ${riskBadge(f.vuln.risk)}
    </div>
  </div>
  <div class="finding-body">
    ${f.banner ? `<div style="background:#0f172a;border-radius:6px;padding:8px 12px;font-family:monospace;font-size:11px;color:#94a3b8;margin-bottom:12px;word-break:break-all;">Banner: ${esc(f.banner)}</div>` : ''}
    <h4 style="font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 8px;">Problemas Identificados</h4>
    <ul style="margin:0 0 12px;padding-left:0;list-style:none;">
      ${f.vuln.issues.map(iss => `<li style="display:flex;align-items:flex-start;gap:8px;font-size:13px;color:#cbd5e1;margin-bottom:6px;">
        <span style="color:${rc};margin-top:1px;font-size:14px;line-height:1;">&#x26A0;</span>
        <span>${esc(iss)}</span>
      </li>`).join('')}
    </ul>
    ${f.vuln.cves.length > 0 ? `<div style="margin-bottom:12px;">
      <h4 style="font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 6px;">CVEs Referenciados</h4>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">${f.vuln.cves.map(cve => cveBadge(cve)).join('')}</div>
    </div>` : ''}
    <div style="background:#0f172a;border-radius:6px;padding:10px 14px;border-left:3px solid #00c853;">
      <h4 style="font-size:12px;color:#00c853;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 4px;">&#x2713; Recomendação</h4>
      <p style="font-size:13px;color:#cbd5e1;margin:0;">${esc(f.vuln.fix)}</p>
    </div>
  </div>
</div>`
  }).join('')}
</div>`

  // ── SSL + Threat page ──────────────────────────────────────────────────────

  let sslHtml = ''
  if (ssl && !ssl.error) {
    const gradeCol = sslGradeColor(ssl.grade)
    sslHtml = `${sectionHeader('3.', 'Certificado SSL/TLS')}
<div style="display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap;margin-bottom:16px;">
  <div style="text-align:center;min-width:80px;">
    <div style="font-size:52px;font-weight:900;color:${gradeCol};font-family:monospace;line-height:1;">${esc(ssl.grade)}</div>
    <div style="font-size:11px;color:#64748b;margin-top:4px;">Nota TLS</div>
  </div>
  <table style="border-collapse:collapse;font-size:13px;flex:1;">
    <tr><td style="padding:5px 12px 5px 0;color:#64748b;white-space:nowrap;">Host</td><td class="mono" style="color:#e2e8f0;">${esc(ssl.host)}</td></tr>
    <tr><td style="padding:5px 12px 5px 0;color:#64748b;">Protocolo</td><td class="mono" style="color:#e2e8f0;">${esc(ssl.protocol)}</td></tr>
    <tr><td style="padding:5px 12px 5px 0;color:#64748b;">Expiração</td>
      <td class="mono" style="color:${ssl.expired ? '#ff4d4d' : ssl.daysUntilExpiry < 30 ? '#ffd600' : '#00c853'};">
        ${ssl.expired ? 'EXPIRADO' : `${ssl.daysUntilExpiry} dias restantes`}
      </td>
    </tr>
    <tr><td style="padding:5px 12px 5px 0;color:#64748b;">Emissor</td><td style="color:#e2e8f0;">${esc(ssl.issuer?.O ?? ssl.issuer?.CN ?? '—')}</td></tr>
    <tr><td style="padding:5px 12px 5px 0;color:#64748b;">Cipher</td><td class="mono" style="color:#94a3b8;font-size:11px;">${esc(ssl.cipher?.name ?? '—')}</td></tr>
    ${ssl.selfSigned ? '<tr><td></td><td><span style="color:#ff8c00;font-size:12px;font-weight:600;">&#x26A0; Certificado auto-assinado</span></td></tr>' : ''}
  </table>
</div>
${ssl.issues && ssl.issues.length > 0 ? `<ul style="margin:0;padding-left:0;list-style:none;">
  ${ssl.issues.map(iss => {
    const col = iss.severity === 'critical' ? '#ff4d4d' : iss.severity === 'high' ? '#ff8c00' : iss.severity === 'medium' ? '#ffd600' : '#00b0d4'
    return `<li style="display:flex;align-items:flex-start;gap:8px;font-size:13px;color:#cbd5e1;margin-bottom:6px;">
    <span style="color:${col};">&#x26A0;</span><span>${esc(iss.message)}</span></li>`
  }).join('')}
</ul>` : `<p style="color:#00c853;font-size:13px;font-weight:600;">&#x2713; Nenhum problema identificado no certificado SSL/TLS.</p>`}`
  }

  let threatHtml = ''
  if (threat && !threat.error) {
    const riskLevel = threat.riskLevel as RiskLevel | undefined
    const riskCol = riskLevel ? RISK_COLOR[riskLevel] : '#6b7280'
    const riskBgCol = riskLevel ? RISK_BG[riskLevel] : '#1a1a2e'
    const riskLabelStr = riskLevel ? (RISK_LABEL[riskLevel] ?? threat.riskLevel ?? '') : (threat.riskLevel ?? '')
    const listedDnsbl = (threat.dnsbl ?? []).filter(d => d.listed)
    threatHtml = `${sectionHeader('4.', 'Inteligência de Ameaças')}
<div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:16px;align-items:flex-start;">
  <table style="border-collapse:collapse;font-size:13px;">
    <tr><td style="padding:5px 12px 5px 0;color:#64748b;">IP Analisado</td><td class="mono" style="color:#e2e8f0;">${esc(threat.ip)}</td></tr>
    ${threat.ipInfo ? `<tr><td style="padding:5px 12px 5px 0;color:#64748b;">Localização</td><td style="color:#e2e8f0;">${esc([threat.ipInfo.city, threat.ipInfo.region, threat.ipInfo.country].filter(Boolean).join(', '))}</td></tr>
    <tr><td style="padding:5px 12px 5px 0;color:#64748b;">Provedor (ASN)</td><td style="color:#e2e8f0;">${esc(threat.ipInfo.org)}</td></tr>` : ''}
    ${threat.riskLevel ? `<tr><td style="padding:5px 12px 5px 0;color:#64748b;">Nível de Risco</td><td>${tagBadge(riskLabelStr, riskCol, riskBgCol)}</td></tr>` : ''}
    ${threat.riskScore != null ? `<tr><td style="padding:5px 12px 5px 0;color:#64748b;">Score de Risco</td><td style="color:${riskCol};font-weight:700;">${threat.riskScore}/100</td></tr>` : ''}
  </table>
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;">
    ${threat.isTor ? tagBadge('Nó Tor Detectado', '#ff4d4d', '#3d0000') : ''}
    ${(threat.listedCount ?? 0) > 0 ? tagBadge(`DNSBL: ${threat.listedCount} lista(s)`, '#ff4d4d', '#3d0000') : ''}
    ${threat.listedCount === 0 && !threat.isTor ? tagBadge('IP Limpo', '#00c853', '#003d1a') : ''}
  </div>
</div>
${listedDnsbl.length > 0 ? `<table class="data-table">
  <thead><tr><th>Lista</th><th>Descrição</th></tr></thead>
  <tbody>${listedDnsbl.map(d => `<tr>
    <td style="color:#ff4d4d;font-weight:600;font-family:monospace;font-size:12px;">${esc(d.name)}</td>
    <td style="font-size:12px;">${esc(d.description)}</td>
  </tr>`).join('')}</tbody>
</table>` : ''}`
  }

  const extraPage = (sslHtml || threatHtml) ? `<div class="page" style="page-break-before:always;">
${sslHtml}
${sslHtml && threatHtml ? '<div style="margin-top:24px;border-top:1px solid #1e3a5f;padding-top:24px;"></div>' : ''}
${threatHtml}
</div>` : ''

  // ── Recommendations + Disclaimer ──────────────────────────────────────────

  const lastPage = `<div class="page" style="page-break-before:always;">
${sectionHeader('5.', 'Recomendações Gerais')}
<div style="display:grid;gap:12px;">
  ${[
    { num: '5.1', title: 'Princípio do Menor Privilégio — Firewall', body: 'Configure um firewall de borda bloqueando todas as portas desnecessárias. Permita apenas os serviços estritamente necessários, idealmente restringindo por endereços IP de origem conhecidos.', color: '#00b0d4' },
    { num: '5.2', title: 'Isolamento de Bancos de Dados', body: 'Bancos de dados (MySQL, PostgreSQL, MongoDB, Redis, etc.) nunca devem estar diretamente acessíveis pela internet. Utilize VPN corporativa ou tunelamento SSH para acesso remoto seguro.', color: '#7b2fff' },
    { num: '5.3', title: 'Autenticação Multifator (MFA)', body: 'Implemente autenticação em dois fatores em todos os serviços de acesso remoto: SSH (via TOTP/U2F), painéis web, VPNs e RDP. Isso reduz drasticamente o impacto de credenciais comprometidas.', color: '#00c853' },
    { num: '5.4', title: 'Monitoramento e Detecção de Intrusão', body: 'Implemente coleta centralizada de logs (SIEM) e configure alertas para tentativas de acesso suspeitas. Ferramentas como fail2ban, Suricata ou OSSEC podem automatizar a resposta a incidentes.', color: '#ffd600' },
    { num: '5.5', title: 'Gestão de Patches e Atualizações', body: 'Mantenha todos os serviços e sistemas operacionais atualizados. A maioria dos ataques bem-sucedidos explora vulnerabilidades conhecidas com patches disponíveis. Estabeleça um ciclo regular de atualizações.', color: '#ff8c00' },
    { num: '5.6', title: 'Criptografia em Trânsito', body: 'Desabilite protocolos sem criptografia (HTTP, FTP, Telnet, SMTP sem STARTTLS). Migre para HTTPS, SFTP e SSH. Configure TLS 1.2+ e desabilite TLS 1.0/1.1 e SSLv3.', color: '#ff4d4d' },
  ].map(r => `<div style="background:#0f172a;border-radius:8px;padding:14px 16px;border-left:3px solid ${r.color};">
    <h4 style="font-size:13px;font-weight:700;color:${r.color};margin:0 0 6px;">${r.num} ${esc(r.title)}</h4>
    <p style="font-size:13px;color:#94a3b8;margin:0;line-height:1.6;">${esc(r.body)}</p>
  </div>`).join('')}
</div>

<div class="disclaimer">
  <h4 style="font-size:12px;color:#64748b;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.05em;">Aviso Legal / Disclaimer</h4>
  <p style="font-size:11px;color:#475569;margin:0;line-height:1.7;">
    Este relatório foi gerado automaticamente pela plataforma MySpeed e destina-se exclusivamente a fins de auditoria de segurança autorizada.
    As informações contidas são baseadas em um scan técnico realizado em <strong>${esc(client.date)}</strong> e refletem o estado do alvo nesse momento.
    Postura de segurança pode mudar rapidamente; recomenda-se realizar avaliações periódicas.<br><br>
    A execução de scans de segurança em sistemas sem autorização expressa é ilegal na maioria das jurisdições.
    O responsável por este relatório declara ter obtido todas as permissões necessárias.
  </p>
</div>
</div>`

  // ── CSS ───────────────────────────────────────────────────────────────────

  const css = `
@page { size: A4; margin: 20mm 15mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Arial, sans-serif; font-size: 14px; color: #e2e8f0; background: #0d1526; }
.page { max-width: 170mm; margin: 0 auto; padding: 0; }
/* Cover */
.cover-header { background: linear-gradient(135deg,#0a1628 0%,#0d2040 50%,#0a1628 100%); border: 1px solid #1e3a5f; border-radius: 12px; padding: 36px 32px 28px; text-align: center; margin-bottom: 20px; }
.cover-logo { font-size: 48px; margin-bottom: 12px; }
.cover-title { font-size: 22px; font-weight: 900; color: #f1f5f9; letter-spacing: 0.05em; line-height: 1.25; margin: 0 0 8px; }
.cover-subtitle { font-size: 13px; color: #64748b; margin: 0; }
.cover-meta { background: #0f172a; border: 1px solid #1e3a5f; border-radius: 8px; padding: 16px 20px; margin-bottom: 20px; }
.cover-meta-table { border-collapse: collapse; width: 100%; font-size: 13px; }
.cover-meta-table tr td { padding: 6px 0; }
.cover-meta-table tr + tr td { border-top: 1px solid #1e293b; }
.meta-label { color: #64748b; padding-right: 16px; white-space: nowrap; font-weight: 500; vertical-align: top; }
.meta-value { color: #e2e8f0; font-weight: 600; }
.cover-scores { display: flex; align-items: center; justify-content: center; gap: 24px; margin: 20px 0; padding: 20px; background: #0f172a; border: 1px solid #1e3a5f; border-radius: 8px; }
.cover-score-box { text-align: center; }
.cover-score-label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; margin: 0 0 8px; }
.cover-score-sub { font-size: 14px; font-weight: 700; margin: 6px 0 2px; }
.cover-score-date { font-size: 11px; color: #475569; margin: 0; }
.cover-score-arrow { text-align: center; padding: 0 8px; }
.cover-summary { display: flex; background: #0f172a; border: 1px solid #1e3a5f; border-radius: 8px; overflow: hidden; margin: 16px 0 0; }
.cover-summary-item { flex: 1; text-align: center; padding: 16px 12px; }
.cover-summary-num { display: block; font-size: 32px; font-weight: 900; color: #00b0d4; font-family: monospace; line-height: 1; margin-bottom: 4px; }
.cover-summary-label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; }
.cover-summary-divider { width: 1px; background: #1e3a5f; }
/* Section headers */
.section-header { display: flex; align-items: center; gap: 12px; background: linear-gradient(90deg,#0d2040 0%,#0a1628 100%); border-left: 4px solid #00b0d4; border-radius: 0 6px 6px 0; padding: 12px 16px; margin: 0 0 20px; }
.section-num { font-size: 16px; font-weight: 900; color: #00b0d4; font-family: monospace; }
.section-title { font-size: 16px; font-weight: 700; color: #f1f5f9; letter-spacing: 0.02em; }
.subsection-title { font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; margin: 20px 0 10px; }
/* Prose */
.prose { font-size: 13px; color: #94a3b8; line-height: 1.7; margin: 0 0 16px; }
.prose strong { color: #e2e8f0; }
/* Exec */
.exec-score-row { display: flex; gap: 24px; align-items: flex-start; margin-bottom: 20px; padding: 16px; background: #0f172a; border: 1px solid #1e3a5f; border-radius: 8px; }
.exec-gauge { text-align: center; min-width: 100px; }
.exec-gauge-label { font-size: 13px; font-weight: 700; margin: 6px 0 0; }
.info-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(200px,1fr)); gap: 12px; margin-bottom: 20px; }
.info-box { background: #0f172a; border: 1px solid #1e3a5f; border-radius: 8px; padding: 14px; }
.info-box-title { font-size: 12px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 8px; }
/* Tables */
.data-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 16px; }
.data-table th { background: #0d2040; color: #64748b; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; padding: 10px 12px; text-align: left; border-bottom: 1px solid #1e3a5f; }
.data-table td { padding: 9px 12px; border-bottom: 1px solid #1e293b; color: #cbd5e1; vertical-align: middle; }
.data-table tr:last-child td { border-bottom: none; }
/* Findings */
.finding-card { background: #0f172a; border-radius: 8px; overflow: hidden; page-break-inside: avoid; }
.finding-header { padding: 12px 16px; }
.finding-body { padding: 14px 16px; }
/* Mono */
.mono { font-family: "SF Mono","Fira Code",Consolas,monospace; }
/* Disclaimer */
.disclaimer { margin-top: 32px; padding: 16px 20px; background: #0f172a; border: 1px solid #1e3a5f; border-radius: 8px; page-break-inside: avoid; }
/* Print */
@media print {
  body { background: #0d1526; }
  .finding-card, .disclaimer { page-break-inside: avoid; }
  .section-header, h3, h4 { page-break-after: avoid; }
}
`

  // ── Assemble ──────────────────────────────────────────────────────────────

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Relatório de Segurança — ${esc(scan.host)} — ${esc(client.date)}</title>
<style>${css}</style>
</head>
<body>
${coverPage}
${execPage}
${serviceAnalysisPage}
${extraPage}
${lastPage}
</body>
</html>`
}
