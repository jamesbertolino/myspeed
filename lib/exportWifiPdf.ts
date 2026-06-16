import type { WiFiNetwork } from '@/components/WiFiChannelMap'
import type { AIAnalysis } from '@/app/wifi/page'

export async function exportWifiPdf(
  networks: WiFiNetwork[],
  recommended24: number,
  recommended5: number,
  aiAnalysis: AIAnalysis | null,
  isRealData: boolean,
) {
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
    import('jspdf'),
    import('html2canvas'),
  ])

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = 210
  const margin = 14
  const col = W - margin * 2
  let y = 0

  // ── helpers ──────────────────────────────────────────────────────────────
  const hex = (h: string) => {
    const r = parseInt(h.slice(1, 3), 16)
    const g = parseInt(h.slice(3, 5), 16)
    const b = parseInt(h.slice(5, 7), 16)
    return [r, g, b] as [number, number, number]
  }
  const setColor = (h: string) => doc.setTextColor(...hex(h))
  const setFill  = (h: string) => doc.setFillColor(...hex(h))
  const setDraw  = (h: string) => doc.setDrawColor(...hex(h))

  const sigColor = (s: number) => s >= -60 ? '#00c853' : s >= -75 ? '#ffd600' : '#ff1744'

  // ── HEADER ───────────────────────────────────────────────────────────────
  setFill('#0a1128'); doc.rect(0, 0, W, 28, 'F')
  setColor('#00d4ff'); doc.setFontSize(18); doc.setFont('helvetica', 'bold')
  doc.text('MySpeed', margin, 13)
  setColor('#94a3b8'); doc.setFontSize(8); doc.setFont('helvetica', 'normal')
  doc.text('Network Analyzer — Relatório WiFi', margin, 19)
  setColor('#4a5568')
  doc.text(new Date().toLocaleString('pt-BR'), W - margin, 13, { align: 'right' })
  doc.text(isRealData ? 'Dados reais (scan)' : 'Dados manuais', W - margin, 19, { align: 'right' })
  y = 34

  // ── RESUMO ────────────────────────────────────────────────────────────────
  const nets24 = networks.filter(n => n.band === '2.4')
  const nets5  = networks.filter(n => n.band === '5')

  setFill('#0f1e3d'); doc.rect(margin, y, col, 18, 'F')
  setDraw('#1a2744'); doc.rect(margin, y, col, 18, 'S')

  const cols = [
    { label: 'Redes 2.4 GHz', value: String(nets24.length) },
    { label: 'Redes 5 GHz',   value: String(nets5.length) },
    { label: 'Melhor canal 2.4', value: `CH ${recommended24}` },
    { label: 'Melhor canal 5',   value: `CH ${recommended5}` },
  ]
  const cw = col / cols.length
  cols.forEach((c, i) => {
    const x = margin + i * cw + cw / 2
    setColor('#94a3b8'); doc.setFontSize(7); doc.setFont('helvetica', 'normal')
    doc.text(c.label, x, y + 6, { align: 'center' })
    setColor('#00d4ff'); doc.setFontSize(13); doc.setFont('helvetica', 'bold')
    doc.text(c.value, x, y + 14, { align: 'center' })
  })
  y += 24

  // ── captura do mapa de canais ─────────────────────────────────────────────
  const mapEl24 = document.getElementById('wifi-channel-map-24')
  const mapEl5  = document.getElementById('wifi-channel-map-5')

  for (const [el, label] of [[mapEl24, '2.4 GHz'], [mapEl5, '5 GHz']] as const) {
    if (!el) continue
    setColor('#e2e8f0'); doc.setFontSize(10); doc.setFont('helvetica', 'bold')
    doc.text(`Mapa de Canais — ${label}`, margin, y + 5)
    y += 8

    try {
      const canvas = await html2canvas(el, { backgroundColor: '#050a1a', scale: 2, logging: false })
      const imgData = canvas.toDataURL('image/png')
      const imgH = (canvas.height / canvas.width) * col
      doc.addImage(imgData, 'PNG', margin, y, col, imgH)
      y += imgH + 6
    } catch { /* pula se falhar */ }
  }

  // ── tabela de redes ────────────────────────────────────────────────────────
  const drawNetworkTable = (nets: WiFiNetwork[], band: string) => {
    if (nets.length === 0) return
    if (y > 240) { doc.addPage(); y = 14 }

    setColor('#e2e8f0'); doc.setFontSize(10); doc.setFont('helvetica', 'bold')
    doc.text(`Redes Detectadas — ${band}`, margin, y + 4)
    y += 8

    // header row
    setFill('#0f1e3d'); doc.rect(margin, y, col, 7, 'F')
    setColor('#94a3b8'); doc.setFontSize(7); doc.setFont('helvetica', 'bold')
    const hcols = [['SSID', 0.35], ['Canal', 0.12], ['Sinal', 0.12], ['Segurança', 0.16], ['Largura', 0.13], ['Fabricante', 0.12]]
    hcols.forEach(([h, w]) => {
      const x = margin + hcols.slice(0, hcols.indexOf([h, w])).reduce((a, [, ww]) => a + (ww as number) * col, 0)
      doc.text(String(h), x + 2, y + 4.5)
    })
    y += 7

    nets.forEach((net, i) => {
      if (y > 270) { doc.addPage(); y = 14 }
      const bg = i % 2 === 0 ? '#050a1a' : '#080e20'
      setFill(bg); doc.rect(margin, y, col, 6.5, 'F')
      setDraw('#1a2744'); doc.setLineWidth(0.1)
      doc.line(margin, y + 6.5, margin + col, y + 6.5)

      let x = margin
      const vals: [string, number, string][] = [
        [net.ssid || '(oculto)', 0.35, '#e2e8f0'],
        [String(net.channel), 0.12, '#00d4ff'],
        [`${net.signal} dBm`, 0.12, sigColor(net.signal)],
        [net.security || '—', 0.16, '#94a3b8'],
        [net.width ? `${net.width} MHz` : '—', 0.13, '#94a3b8'],
        [net.vendor || '—', 0.12, '#64748b'],
      ]
      vals.forEach(([val, w, color]) => {
        setColor(color); doc.setFontSize(7); doc.setFont('helvetica', 'normal')
        doc.text(String(val).slice(0, 22), x + 2, y + 4.3)
        x += (w as number) * col
      })
      y += 6.5
    })
    y += 4
  }

  drawNetworkTable(nets24, '2.4 GHz')
  drawNetworkTable(nets5,  '5 GHz')

  // ── análise IA ─────────────────────────────────────────────────────────────
  if (aiAnalysis) {
    if (y > 220) { doc.addPage(); y = 14 }

    setFill('#0f1e3d'); doc.rect(margin, y, col, 8, 'F')
    setColor('#c084fc'); doc.setFontSize(10); doc.setFont('helvetica', 'bold')
    doc.text('✦  Análise com IA', margin + 2, y + 5.5)

    const scoreColor = aiAnalysis.score >= 75 ? '#00c853' : aiAnalysis.score >= 50 ? '#ffd600' : '#ff1744'
    setColor(scoreColor); doc.setFontSize(18); doc.setFont('helvetica', 'bold')
    doc.text(String(aiAnalysis.score), W - margin - 2, y + 6.5, { align: 'right' })
    setColor('#94a3b8'); doc.setFontSize(7)
    doc.text(aiAnalysis.scoreLabel, W - margin - 2, y + 11, { align: 'right' })
    y += 12

    setColor('#cbd5e1'); doc.setFontSize(8); doc.setFont('helvetica', 'normal')
    const lines = doc.splitTextToSize(aiAnalysis.summary, col)
    doc.text(lines, margin, y)
    y += lines.length * 4 + 4

    aiAnalysis.recommendations.forEach(rec => {
      if (y > 270) { doc.addPage(); y = 14 }
      const rcolor = rec.priority === 'high' ? '#ff4d4d' : rec.priority === 'medium' ? '#ffd700' : '#00ff88'
      const bg2    = rec.priority === 'high' ? '#1a0a0a' : rec.priority === 'medium' ? '#1a1500' : '#0a1a0a'
      const label  = rec.priority === 'high' ? '● ALTA' : rec.priority === 'medium' ? '◐ MÉDIA' : '○ BAIXA'
      setFill(bg2); doc.rect(margin, y, col, 12, 'F')
      setColor(rcolor); doc.setFontSize(7.5); doc.setFont('helvetica', 'bold')
      doc.text(`${label}  ${rec.title}`, margin + 2, y + 4.5)
      setColor('#94a3b8'); doc.setFontSize(7); doc.setFont('helvetica', 'normal')
      const dlines = doc.splitTextToSize(rec.detail, col - 4)
      doc.text(dlines, margin + 2, y + 8.5)
      y += Math.max(12, dlines.length * 3.5 + 7) + 2
    })
  }

  // ── footer ─────────────────────────────────────────────────────────────────
  const pages = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    setFill('#050a1a'); doc.rect(0, 292, W, 8, 'F')
    setColor('#4a5568'); doc.setFontSize(7); doc.setFont('helvetica', 'normal')
    doc.text('MySpeed — Network Analyzer', margin, 296.5)
    doc.text(`Página ${p} / ${pages}`, W - margin, 296.5, { align: 'right' })
  }

  doc.save(`wifi-report-${new Date().toISOString().slice(0, 10)}.pdf`)
}
