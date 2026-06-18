export type RiskLevel = 'critical' | 'high' | 'medium' | 'low' | 'info'

export interface VulnInfo {
  risk: RiskLevel
  issues: string[]
  cves: string[]
  fix: string
}

export interface ScanPort {
  port: number
  service: string
  banner?: string
}

export interface ScanResult {
  host: string
  ip: string
  open: ScanPort[]
  total: number
  scanned: number
}

export interface SSLResult {
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

export interface ThreatResult {
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

export interface Finding extends ScanPort {
  vuln: VulnInfo
}

export interface Analysis {
  findings: Finding[]
  counts: Record<RiskLevel, number>
  score: number
}

export interface BaselineSnapshot {
  scan: ScanResult
  score: number
  counts: Record<RiskLevel, number>
  date: string
}
