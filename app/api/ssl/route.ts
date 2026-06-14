import { NextRequest, NextResponse } from 'next/server'
import tls from 'tls'

export const runtime = 'nodejs'

interface CertInfo {
  host: string
  port: number
  subject: Record<string, string>
  issuer: Record<string, string>
  validFrom: string
  validTo: string
  daysUntilExpiry: number
  expired: boolean
  selfSigned: boolean
  protocol: string
  cipher: { name: string; version: string }
  keyType: string
  keyBits?: number
  sans: string[]
  serialNumber: string
  fingerprint: string
  issues: Array<{ severity: 'critical' | 'high' | 'medium' | 'low'; message: string }>
  grade: 'A+' | 'A' | 'B' | 'C' | 'F'
}

function gradeSSL(issues: CertInfo['issues'], protocol: string, daysLeft: number): CertInfo['grade'] {
  const hasCritical = issues.some(i => i.severity === 'critical')
  const hasHigh = issues.some(i => i.severity === 'high')
  if (hasCritical) return 'F'
  if (hasHigh || daysLeft < 14) return 'C'
  if (issues.some(i => i.severity === 'medium')) return 'B'
  if (protocol === 'TLSv1.3') return 'A+'
  return 'A'
}

function checkSSL(host: string, port: number): Promise<CertInfo> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host,
      port,
      servername: host,
      timeout: 10000,
      rejectUnauthorized: false,
    })

    socket.once('secureConnect', () => {
      try {
        const cert = socket.getPeerCertificate(true)
        const protocol = socket.getProtocol() ?? 'unknown'
        const cipher = socket.getCipher() ?? { name: 'unknown', version: 'unknown' }
        socket.destroy()

        if (!cert || !cert.subject) {
          reject(new Error('No certificate returned'))
          return
        }

        const validFrom = new Date(cert.valid_from)
        const validTo = new Date(cert.valid_to)
        const now = new Date()
        const daysUntilExpiry = Math.floor((validTo.getTime() - now.getTime()) / 86400000)
        const expired = daysUntilExpiry < 0
        const selfSigned = cert.issuer?.CN === cert.subject?.CN && !cert.issuer?.O

        const sans: string[] = []
        if (cert.subjectaltname) {
          cert.subjectaltname.split(', ').forEach(s => {
            if (s.startsWith('DNS:')) sans.push(s.slice(4))
            else if (s.startsWith('IP:')) sans.push(s.slice(3))
          })
        }

        const issues: CertInfo['issues'] = []

        if (expired) issues.push({ severity: 'critical', message: `Certificado expirado há ${Math.abs(daysUntilExpiry)} dias` })
        else if (daysUntilExpiry < 7) issues.push({ severity: 'critical', message: `Certificado expira em ${daysUntilExpiry} dias` })
        else if (daysUntilExpiry < 30) issues.push({ severity: 'high', message: `Certificado expira em ${daysUntilExpiry} dias — renovação urgente` })
        else if (daysUntilExpiry < 60) issues.push({ severity: 'medium', message: `Certificado expira em ${daysUntilExpiry} dias` })

        if (selfSigned) issues.push({ severity: 'high', message: 'Certificado auto-assinado — não confiável por browsers' })

        if (protocol === 'TLSv1' || protocol === 'TLSv1.1') {
          issues.push({ severity: 'critical', message: `Protocolo obsoleto: ${protocol} (suporte descontinuado)` })
        } else if (protocol === 'TLSv1.2') {
          issues.push({ severity: 'low', message: 'TLS 1.2 em uso — considere habilitar TLS 1.3' })
        }

        const cipherName = cipher.name ?? ''
        if (/RC4|MD5|NULL|EXPORT|DES(?!3)|anon/i.test(cipherName)) {
          issues.push({ severity: 'critical', message: `Cipher suite fraco/inseguro: ${cipherName}` })
        } else if (/3DES|CBC/i.test(cipherName)) {
          issues.push({ severity: 'medium', message: `Cipher com modo CBC pode ser vulnerável a BEAST/POODLE: ${cipherName}` })
        }

        const hostLower = host.toLowerCase()
        const coveredBySAN = sans.some(s => {
          if (s.startsWith('*.')) return hostLower.endsWith(s.slice(1))
          return s.toLowerCase() === hostLower
        })
        if (!coveredBySAN && sans.length > 0) {
          issues.push({ severity: 'high', message: `Host "${host}" não está coberto pelos SANs do certificado` })
        }

        const grade = gradeSSL(issues, protocol, daysUntilExpiry)

        resolve({
          host,
          port,
          subject: cert.subject as Record<string, string>,
          issuer: cert.issuer as Record<string, string>,
          validFrom: validFrom.toISOString(),
          validTo: validTo.toISOString(),
          daysUntilExpiry,
          expired,
          selfSigned,
          protocol,
          cipher: { name: cipherName, version: cipher.version ?? '' },
          keyType: (cert as unknown as Record<string, unknown>).bits ? 'RSA' : 'EC',
          keyBits: (cert as unknown as Record<string, unknown>).bits as number | undefined,
          sans,
          serialNumber: cert.serialNumber ?? '',
          fingerprint: cert.fingerprint256 ?? cert.fingerprint ?? '',
          issues,
          grade,
        })
      } catch (e) {
        socket.destroy()
        reject(e)
      }
    })

    socket.once('error', reject)
    socket.once('timeout', () => { socket.destroy(); reject(new Error('Connection timeout')) })
  })
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const host = searchParams.get('host')?.replace(/^https?:\/\//, '').split('/')[0] ?? ''
  const port = parseInt(searchParams.get('port') ?? '443')

  if (!host) return NextResponse.json({ error: 'host obrigatório' }, { status: 400 })

  try {
    const info = await checkSSL(host, port)
    return NextResponse.json(info)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `Falha ao conectar: ${msg}` }, { status: 502 })
  }
}
