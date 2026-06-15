'use client'

import { useState, useEffect } from 'react'
import { X, FileDown, Shield, Lock, Globe, CheckCircle2 } from 'lucide-react'
import type { ScanResult, Analysis, SSLResult, ThreatResult, BaselineSnapshot } from '@/types/network'
import { generateReport } from '@/lib/reportGenerator'

interface Props {
  open: boolean
  onClose: () => void
  scan: ScanResult
  analysis: Analysis
  ssl?: SSLResult | null
  threat?: ThreatResult | null
  baseline?: BaselineSnapshot | null
}

export default function ReportModal({ open, onClose, scan, analysis, ssl, threat, baseline }: Props) {
  const [clientName, setClientName] = useState('')
  const [analystName, setAnalystName] = useState('')
  const [includeBaseline, setIncludeBaseline] = useState(true)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    setClientName(localStorage.getItem('report_client') ?? '')
    setAnalystName(localStorage.getItem('report_analyst') ?? '')
  }, [])

  if (!open) return null

  const totalCves = analysis.findings.reduce((s, f) => s + f.vuln.cves.length, 0)

  function handleGenerate() {
    setGenerating(true)
    localStorage.setItem('report_client', clientName)
    localStorage.setItem('report_analyst', analystName)

    const now = new Date()
    const date = now.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })

    const html = generateReport({
      client: { name: clientName, analyst: analystName, date },
      scan,
      analysis,
      ssl: ssl ?? null,
      threat: threat ?? null,
      baseline: includeBaseline && baseline ? baseline : null,
    })

    const win = window.open('', '_blank')
    if (win) {
      win.document.write(html)
      win.document.close()
    }

    setGenerating(false)
    onClose()
  }

  const checks: { icon: typeof Shield; label: string; color: string }[] = [
    { icon: Shield, label: `Score de segurança: ${analysis.score}/100`, color: '#00d4ff' },
    { icon: CheckCircle2, label: `${scan.open.length} porta${scan.open.length !== 1 ? 's' : ''} encontrada${scan.open.length !== 1 ? 's' : ''} (${analysis.counts.critical} crítica${analysis.counts.critical !== 1 ? 's' : ''})`, color: analysis.counts.critical > 0 ? '#ff4d4d' : '#00ff88' },
    ...(totalCves > 0 ? [{ icon: CheckCircle2 as typeof Shield, label: `${totalCves} CVE${totalCves !== 1 ? 's' : ''} referenciado${totalCves !== 1 ? 's' : ''}`, color: '#ff8c00' }] : []),
    ...(ssl && !ssl.error ? [{ icon: Lock, label: `Certificado SSL — Nota ${ssl.grade}`, color: '#00d4ff' }] : []),
    ...(threat && !threat.error ? [{ icon: Globe, label: `Inteligência de ameaças (${(threat.listedCount ?? 0) > 0 ? threat.listedCount + ' blacklists' : 'limpo'})`, color: (threat.listedCount ?? 0) > 0 ? '#ff4d4d' : '#00ff88' }] : []),
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md bg-[#050a1a] border border-[#1a2744] rounded-2xl shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1a2744]">
          <div className="flex items-center gap-2">
            <FileDown className="w-4 h-4 text-cyan-400" />
            <span className="font-bold text-white text-sm">Exportar Relatório PDF</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Form */}
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold block mb-1.5">Nome do Cliente</label>
              <input
                className="dark-input"
                placeholder="Ex: Empresa XYZ Ltda."
                value={clientName}
                onChange={e => setClientName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold block mb-1.5">Analista Responsável</label>
              <input
                className="dark-input"
                placeholder="Ex: João Silva"
                value={analystName}
                onChange={e => setAnalystName(e.target.value)}
              />
            </div>
          </div>

          {/* Baseline toggle */}
          {baseline && (
            <label className="flex items-center gap-3 cursor-pointer p-3 rounded-xl border border-[#1a2744] hover:border-cyan-500/30 transition-colors">
              <input
                type="checkbox"
                checked={includeBaseline}
                onChange={e => setIncludeBaseline(e.target.checked)}
                className="w-4 h-4 accent-cyan-400"
              />
              <div>
                <p className="text-sm font-semibold text-white">Incluir comparativo Antes / Depois</p>
                <p className="text-xs text-gray-500 mt-0.5">Linha de base salva em {baseline.date}</p>
              </div>
            </label>
          )}

          {/* Preview checklist */}
          <div className="bg-[#0a1128] rounded-xl p-3 border border-[#1a2744]">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-2">O relatório incluirá</p>
            <div className="space-y-1.5">
              {checks.map((c, i) => {
                const Icon = c.icon
                return (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: c.color }} />
                    <span className="text-gray-400">{c.label}</span>
                  </div>
                )
              })}
              <div className="flex items-center gap-2 text-xs">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-[#00ff88]" />
                <span className="text-gray-400">Recomendações e plano de ação</span>
              </div>
            </div>
          </div>

          <p className="text-xs text-gray-600">
            O relatório abrirá em uma nova aba. Use <strong className="text-gray-500">Ctrl+P</strong> (ou o diálogo de impressão automático) para salvar como PDF.
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3 px-5 pb-5">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-xl border border-[#1a2744] text-gray-400 hover:text-white text-sm font-semibold transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex-1 btn-cyan px-4 py-2 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <FileDown className="w-4 h-4" />
            {generating ? 'Gerando...' : 'Gerar PDF'}
          </button>
        </div>
      </div>
    </div>
  )
}
