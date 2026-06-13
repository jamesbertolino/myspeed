import { NextRequest, NextResponse } from 'next/server'
import dns from 'dns/promises'

export const runtime = 'nodejs'

async function getTXT(name: string): Promise<string[]> {
  try {
    const records = await dns.resolveTxt(name)
    return records.map(r => r.join(''))
  } catch { return [] }
}

async function getMX(domain: string) {
  try { return await dns.resolveMx(domain) } catch { return [] }
}

async function checkDNSSEC(domain: string): Promise<boolean> {
  try {
    const res = await fetch(`https://dns.google/resolve?name=${domain}&type=DNSKEY`)
    const data = await res.json()
    return !!(data.Answer?.length)
  } catch { return false }
}

async function checkDNSBL(ip: string): Promise<Array<{ list: string; listed: boolean }>> {
  const reversed = ip.split('.').reverse().join('.')
  const lists = [
    'zen.spamhaus.org',
    'bl.spamcop.net',
    'dnsbl.sorbs.net',
    'b.barracudacentral.org',
  ]
  return Promise.all(lists.map(async list => {
    try {
      await dns.resolve4(`${reversed}.${list}`)
      return { list, listed: true }
    } catch {
      return { list, listed: false }
    }
  }))
}

async function checkTorExit(ip: string): Promise<boolean> {
  try {
    const reversed = ip.split('.').reverse().join('.')
    await dns.resolve4(`${reversed}.dnsel.torproject.org`)
    return true
  } catch { return false }
}

function parseSPF(record: string): { valid: boolean; mechanisms: string[]; issues: string[] } {
  const issues: string[] = []
  if (!record.startsWith('v=spf1')) { issues.push('SPF inválido: não começa com v=spf1'); return { valid: false, mechanisms: [], issues } }
  const parts = record.split(' ').filter(Boolean)
  const mechanisms = parts.slice(1)
  if (mechanisms.some(m => m === '+all' || m === 'all')) issues.push('Mecanismo "+all" permite qualquer remetente — altamente inseguro')
  if (!mechanisms.some(m => m.startsWith('-all') || m.startsWith('~all'))) issues.push('Sem diretiva "-all" ou "~all" no final')
  return { valid: issues.length === 0, mechanisms, issues }
}

function parseDMARC(record: string): { valid: boolean; policy: string; pct: number; issues: string[] } {
  const issues: string[] = []
  if (!record.startsWith('v=DMARC1')) { issues.push('DMARC inválido'); return { valid: false, policy: 'none', pct: 0, issues } }
  const tags: Record<string, string> = {}
  record.split(';').forEach(part => {
    const [k, v] = part.trim().split('=')
    if (k && v) tags[k.trim()] = v.trim()
  })
  const policy = tags['p'] ?? 'none'
  const pct = parseInt(tags['pct'] ?? '100')
  if (policy === 'none') issues.push('Política DMARC "none" — não protege contra spoofing')
  if (policy === 'quarantine' && pct < 100) issues.push(`Política aplicada apenas a ${pct}% dos emails`)
  if (!tags['rua']) issues.push('Sem endereço de relatório aggregate (rua) configurado')
  return { valid: policy !== 'none', policy, pct, issues }
}

const DKIM_SELECTORS = ['google', 'mail', 'default', 'smtp', 'email', 'k1', 's1', 's2', 'dkim', 'selector1', 'selector2']

async function checkDKIM(domain: string): Promise<{ selector: string; record: string }[]> {
  const found: { selector: string; record: string }[] = []
  await Promise.all(DKIM_SELECTORS.map(async sel => {
    const txts = await getTXT(`${sel}._domainkey.${domain}`)
    const dkim = txts.find(t => t.includes('v=DKIM1') || t.includes('p='))
    if (dkim) found.push({ selector: sel, record: dkim.slice(0, 80) + (dkim.length > 80 ? '…' : '') })
  }))
  return found
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const input = searchParams.get('domain') ?? ''
  const domain = input.replace(/^https?:\/\//, '').split('/')[0].toLowerCase()
  const checkIp = searchParams.get('ip')

  if (!domain && !checkIp) return NextResponse.json({ error: 'domain ou ip obrigatório' }, { status: 400 })

  // IP reputation check
  if (checkIp) {
    const [dnsbl, isTor] = await Promise.all([checkDNSBL(checkIp), checkTorExit(checkIp)])
    return NextResponse.json({ ip: checkIp, dnsbl, isTor })
  }

  const [spfRecords, dmarcRecords, dkimRecords, mxRecords, dnssec] = await Promise.all([
    getTXT(domain),
    getTXT(`_dmarc.${domain}`),
    checkDKIM(domain),
    getMX(domain),
    checkDNSSEC(domain),
  ])

  const spfRecord = spfRecords.find(r => r.startsWith('v=spf1')) ?? null
  const dmarcRecord = dmarcRecords.find(r => r.startsWith('v=DMARC1')) ?? null

  const spf = spfRecord ? parseSPF(spfRecord) : null
  const dmarc = dmarcRecord ? parseDMARC(dmarcRecord) : null

  const issues: Array<{ severity: 'critical' | 'high' | 'medium' | 'low'; message: string }> = []

  if (!spfRecord) issues.push({ severity: 'critical', message: 'SPF não configurado — domínio vulnerável a email spoofing' })
  else spf?.issues.forEach(m => issues.push({ severity: 'high', message: `SPF: ${m}` }))

  if (!dmarcRecord) issues.push({ severity: 'critical', message: 'DMARC não configurado — sem proteção contra phishing' })
  else dmarc?.issues.forEach(m => issues.push({ severity: 'medium', message: `DMARC: ${m}` }))

  if (dkimRecords.length === 0) issues.push({ severity: 'high', message: 'DKIM não detectado — emails não assinados digitalmente' })

  if (!dnssec) issues.push({ severity: 'medium', message: 'DNSSEC não habilitado — vulnerável a DNS spoofing' })

  if (mxRecords.length === 0) issues.push({ severity: 'low', message: 'Nenhum registro MX — domínio não recebe emails' })

  const score = Math.max(0, 100
    - (spfRecord ? 0 : 30)
    - (dmarcRecord ? 0 : 30)
    - (dkimRecords.length ? 0 : 20)
    - (dnssec ? 0 : 10)
    - (spf?.issues.length ?? 0) * 5
    - (dmarc?.issues.length ?? 0) * 5
  )

  return NextResponse.json({
    domain,
    spf: { record: spfRecord, ...spf },
    dmarc: { record: dmarcRecord, ...dmarc },
    dkim: dkimRecords,
    mx: mxRecords.sort((a, b) => a.priority - b.priority),
    dnssec,
    issues,
    score,
    scoreLabel: score >= 80 ? 'Excelente' : score >= 60 ? 'Bom' : score >= 40 ? 'Regular' : 'Crítico',
  })
}
