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

  const doc  = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W    = 210
  const M    = 14          // margin
  const col  = W - M * 2
  let y      = 0

  // ── palette ──────────────────────────────────────────────────────────────
  const C = {
    navy:     '#0f172a',
    navyMid:  '#1e3a5f',
    text:     '#1e293b',
    muted:    '#475569',
    faint:    '#64748b',
    border:   '#cbd5e1',
    bg:       '#f8fafc',
    bgAlt:    '#f1f5f9',
    white:    '#ffffff',
    cyan:     '#0284c7',
    green:    '#16a34a',
    yellow:   '#b45309',
    red:      '#dc2626',
    purple:   '#7c3aed',
    accent:   '#0ea5e9',
  }

  const hex = (h: string): [number, number, number] => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ]
  const rgb   = (h: string) => hex(h)
  const color = (h: string) => doc.setTextColor(...rgb(h))
  const fill  = (h: string) => doc.setFillColor(...rgb(h))
  const draw  = (h: string) => doc.setDrawColor(...rgb(h))
  const lw    = (n: number) => doc.setLineWidth(n)

  const sigColor = (s: number) =>
    s >= -60 ? C.green : s >= -75 ? C.yellow : C.red

  const checkPage = (need = 20) => {
    if (y + need > 277) { doc.addPage(); y = M }
  }

  // ── HEADER ───────────────────────────────────────────────────────────────
  fill(C.navy); doc.rect(0, 0, W, 32, 'F')

  // accent line
  fill(C.accent); doc.rect(0, 29, W, 3, 'F')

  // logo
  color(C.white); doc.setFontSize(20); doc.setFont('helvetica', 'bold')
  doc.text('MySpeed', M, 14)
  color(C.accent); doc.setFontSize(9); doc.setFont('helvetica', 'normal')
  doc.text('Network Analyzer', M, 21)

  // right info
  color('#94c6e8'); doc.setFontSize(8)
  doc.text('Relatório WiFi', W - M, 11, { align: 'right' })
  color('#7fb3d3'); doc.setFontSize(7.5)
  doc.text(new Date().toLocaleString('pt-BR'), W - M, 17, { align: 'right' })
  const badge = isRealData ? 'Dados reais (scan)' : 'Dados manuais'
  doc.text(badge, W - M, 23, { align: 'right' })

  y = 38

  // ── RESUMO ────────────────────────────────────────────────────────────────
  const nets24 = networks.filter(n => n.band === '2.4')
  const nets5  = networks.filter(n => n.band === '5')

  const summaryItems = [
    { label: 'Redes 2.4 GHz',    value: String(nets24.length),    vcolor: C.cyan   },
    { label: 'Redes 5 GHz',      value: String(nets5.length),     vcolor: C.cyan   },
    { label: 'Melhor canal 2.4', value: `CH ${recommended24}`,    vcolor: C.green  },
    { label: 'Melhor canal 5',   value: `CH ${recommended5}`,     vcolor: C.green  },
  ]

  const cw = col / summaryItems.length
  fill(C.bg); draw(C.border); lw(0.3)
  doc.rect(M, y, col, 20, 'FD')

  summaryItems.forEach((item, i) => {
    const x = M + i * cw + cw / 2
    if (i > 0) {
      draw(C.border); lw(0.2)
      doc.line(M + i * cw, y + 3, M + i * cw, y + 17)
    }
    color(C.muted); doc.setFontSize(6.5); doc.setFont('helvetica', 'normal')
    doc.text(item.label.toUpperCase(), x, y + 8, { align: 'center' })
    color(item.vcolor); doc.setFontSize(14); doc.setFont('helvetica', 'bold')
    doc.text(item.value, x, y + 16, { align: 'center' })
  })
  y += 26

  // ── MAPAS DE CANAL ────────────────────────────────────────────────────────
  const mapEl24 = document.getElementById('wifi-channel-map-24')
  const mapEl5  = document.getElementById('wifi-channel-map-5')

  for (const [el, label] of [[mapEl24, '2.4 GHz'], [mapEl5, '5 GHz']] as const) {
    if (!el) continue
    checkPage(50)

    // section title
    fill(C.navyMid); doc.rect(M, y, col, 8, 'F')
    color(C.white); doc.setFontSize(9); doc.setFont('helvetica', 'bold')
    doc.text(`Mapa de Canais — ${label}`, M + 4, y + 5.5)
    y += 10

    try {
      const canvas = await html2canvas(el, {
        backgroundColor: '#050a1a',
        scale: 2,
        logging: false,
        useCORS: true,
      })
      const imgData = canvas.toDataURL('image/png')
      const imgH = (canvas.height / canvas.width) * col
      // white border around map
      fill(C.white); draw(C.border); lw(0.3)
      doc.rect(M, y, col, imgH + 4, 'FD')
      doc.addImage(imgData, 'PNG', M + 2, y + 2, col - 4, imgH)
      y += imgH + 10
    } catch {
      color(C.red); doc.setFontSize(8)
      doc.text('Mapa indisponível', M, y + 5)
      y += 10
    }
  }

  // ── TABELA DE REDES ────────────────────────────────────────────────────────
  const drawTable = (nets: WiFiNetwork[], band: string) => {
    if (nets.length === 0) return
    checkPage(30)

    // section header
    fill(C.navyMid); doc.rect(M, y, col, 8, 'F')
    color(C.white); doc.setFontSize(9); doc.setFont('helvetica', 'bold')
    doc.text(`Redes Detectadas — ${band}`, M + 4, y + 5.5)
    y += 10

    // col definitions: [label, width fraction, align]
    const cols: [string, number, 'left' | 'center' | 'right'][] = [
      ['SSID / Rede',  0.30, 'left'   ],
      ['Canal',        0.10, 'center' ],
      ['Sinal',        0.14, 'center' ],
      ['Qualidade',    0.14, 'center' ],
      ['Segurança',    0.15, 'left'   ],
      ['Largura',      0.10, 'center' ],
      ['Fabricante',   0.17, 'left'   ],
    ]

    const cellX = (i: number) => M + cols.slice(0, i).reduce((a, [, w]) => a + w * col, 0)
    const cellW = (i: number) => cols[i][1] * col

    // header row
    fill(C.bg); draw(C.border); lw(0.2)
    doc.rect(M, y, col, 6.5, 'FD')
    color(C.muted); doc.setFontSize(6.5); doc.setFont('helvetica', 'bold')
    cols.forEach(([label,, align], i) => {
      const x = align === 'center' ? cellX(i) + cellW(i) / 2
              : align === 'right'  ? cellX(i) + cellW(i) - 1
              : cellX(i) + 2
      doc.text(label.toUpperCase(), x, y + 4.3, { align })
    })
    y += 6.5

    nets.forEach((net, idx) => {
      checkPage(8)
      const rowH = 7
      fill(idx % 2 === 0 ? C.white : C.bg)
      draw(C.border); lw(0.1)
      doc.rect(M, y, col, rowH, 'FD')

      const sigPct = Math.max(0, Math.min(100, ((net.signal + 100) / 70) * 100))
      const quality = sigPct > 60 ? 'Ótimo' : sigPct > 35 ? 'Bom' : sigPct > 15 ? 'Fraco' : 'Ruim'
      const qColor  = sigPct > 60 ? C.green : sigPct > 35 ? C.yellow : C.red

      const vals: [string, number, 'left' | 'center' | 'right', string][] = [
        [net.ssid || '(oculto)',           0, 'left',   C.text   ],
        [String(net.channel),              1, 'center', C.cyan   ],
        [`${net.signal} dBm`,              2, 'center', sigColor(net.signal)],
        [quality,                          3, 'center', qColor   ],
        [net.security || '—',              4, 'left',   C.muted  ],
        [net.width ? `${net.width} MHz` : '—', 5, 'center', C.muted],
        [(net.vendor || '—').slice(0, 18), 6, 'left',   C.faint  ],
      ]

      vals.forEach(([val, ci, align, c]) => {
        color(c); doc.setFontSize(7); doc.setFont('helvetica', align === 'left' && ci === 0 ? 'bold' : 'normal')
        const x = align === 'center' ? cellX(ci) + cellW(ci) / 2
                : align === 'right'  ? cellX(ci) + cellW(ci) - 1
                : cellX(ci) + 2
        doc.text(String(val).slice(0, 24), x, y + 4.5, { align })
      })
      y += rowH
    })

    // bottom border
    draw(C.border); lw(0.3)
    doc.line(M, y, M + col, y)
    y += 6
  }

  drawTable(nets24, '2.4 GHz')
  drawTable(nets5,  '5 GHz')

  // ── ANÁLISE IA ─────────────────────────────────────────────────────────────
  if (aiAnalysis) {
    checkPage(40)

    // header
    fill(C.purple); doc.rect(M, y, col, 8, 'F')
    color(C.white); doc.setFontSize(9); doc.setFont('helvetica', 'bold')
    doc.text('Análise com IA', M + 4, y + 5.5)

    // score badge
    const scoreColor = aiAnalysis.score >= 75 ? C.green : aiAnalysis.score >= 50 ? C.yellow : C.red
    const scoreX = W - M - 18
    fill(C.white); draw(scoreColor); lw(0.5)
    doc.circle(scoreX, y + 4, 6, 'FD')
    color(scoreColor); doc.setFontSize(10); doc.setFont('helvetica', 'bold')
    doc.text(String(aiAnalysis.score), scoreX, y + 6.2, { align: 'center' })
    y += 10

    // score label + summary
    color(scoreColor); doc.setFontSize(7.5); doc.setFont('helvetica', 'bold')
    doc.text(aiAnalysis.scoreLabel, M, y + 4)
    y += 7

    fill(C.bg); draw(C.border); lw(0.2)
    const sumLines = doc.splitTextToSize(aiAnalysis.summary, col - 6)
    const sumH = sumLines.length * 4.2 + 6
    doc.rect(M, y, col, sumH, 'FD')
    color(C.text); doc.setFontSize(8); doc.setFont('helvetica', 'normal')
    doc.text(sumLines, M + 3, y + 5)
    y += sumH + 5

    // quick stats row
    fill(C.bg); draw(C.border); lw(0.2)
    doc.rect(M, y, col, 10, 'FD')
    const statsItems = [
      { label: 'Melhor 2.4 GHz', value: `CH ${aiAnalysis.bestChannel24}` },
      { label: 'Melhor 5 GHz',   value: `CH ${aiAnalysis.bestChannel5}` },
      { label: 'Congesto 2.4',   value: aiAnalysis.congestion24 === 'low' ? 'Baixo' : aiAnalysis.congestion24 === 'medium' ? 'Médio' : 'Alto',
        vcolor: aiAnalysis.congestion24 === 'low' ? C.green : aiAnalysis.congestion24 === 'medium' ? C.yellow : C.red },
      { label: 'Congesto 5 GHz', value: aiAnalysis.congestion5 === 'low' ? 'Baixo' : aiAnalysis.congestion5 === 'medium' ? 'Médio' : 'Alto',
        vcolor: aiAnalysis.congestion5 === 'low' ? C.green : aiAnalysis.congestion5 === 'medium' ? C.yellow : C.red },
    ]
    const sw = col / statsItems.length
    statsItems.forEach((s, i) => {
      const x = M + i * sw + sw / 2
      if (i > 0) { draw(C.border); lw(0.1); doc.line(M + i * sw, y + 1, M + i * sw, y + 9) }
      color(C.muted); doc.setFontSize(6); doc.setFont('helvetica', 'normal')
      doc.text(s.label.toUpperCase(), x, y + 4, { align: 'center' })
      color(s.vcolor ?? C.cyan); doc.setFontSize(8); doc.setFont('helvetica', 'bold')
      doc.text(s.value, x, y + 8.5, { align: 'center' })
    })
    y += 14

    // recommendations
    color(C.muted); doc.setFontSize(7); doc.setFont('helvetica', 'bold')
    doc.text('RECOMENDAÇÕES', M, y + 4)
    y += 7

    aiAnalysis.recommendations.forEach(rec => {
      const rColor = rec.priority === 'high' ? C.red : rec.priority === 'medium' ? C.yellow : C.green
      const rBg    = rec.priority === 'high' ? '#fff5f5' : rec.priority === 'medium' ? '#fffbeb' : '#f0fdf4'
      const rLabel = rec.priority === 'high' ? 'ALTA' : rec.priority === 'medium' ? 'MÉDIA' : 'BAIXA'

      const dlines  = doc.splitTextToSize(rec.detail, col - 28)
      const blockH  = Math.max(14, dlines.length * 4 + 10)
      checkPage(blockH + 3)

      fill(rBg); draw(rColor); lw(0.3)
      doc.rect(M, y, col, blockH, 'FD')

      // priority pill
      fill(rColor)
      doc.roundedRect(M + 2, y + 2, 13, 5, 1, 1, 'F')
      color(C.white); doc.setFontSize(6); doc.setFont('helvetica', 'bold')
      doc.text(rLabel, M + 8.5, y + 5.5, { align: 'center' })

      // title
      color(C.navy); doc.setFontSize(8); doc.setFont('helvetica', 'bold')
      doc.text(rec.title, M + 18, y + 5.5)

      // detail
      color(C.text); doc.setFontSize(7); doc.setFont('helvetica', 'normal')
      doc.text(dlines, M + 18, y + 10)

      y += blockH + 3
    })
  }

  // ── FOOTER ─────────────────────────────────────────────────────────────────
  const pages = (doc as unknown as { internal: { getNumberOfPages(): number } }).internal.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    fill(C.navy); doc.rect(0, 288, W, 9, 'F')
    color('#94c6e8'); doc.setFontSize(7); doc.setFont('helvetica', 'normal')
    doc.text('MySpeed — Network Analyzer', M, 293.5)
    doc.text(`Página ${p} / ${pages}`, W - M, 293.5, { align: 'right' })
  }

  doc.save(`wifi-report-${new Date().toISOString().slice(0, 10)}.pdf`)
}
