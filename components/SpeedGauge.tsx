'use client'

import { useEffect, useRef } from 'react'
import { formatSpeed } from '@/lib/utils'

interface Props {
  value: number
  maxValue?: number
  label?: string
  color?: string
  size?: number
}

export default function SpeedGauge({ value, maxValue = 1000, label = 'Mbps', color = '#00d4ff', size = 220 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)
  const currentRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr
    canvas.height = size * dpr
    ctx.scale(dpr, dpr)

    const cx = size / 2
    const cy = size / 2
    const r = size / 2 - 16
    const startAngle = Math.PI * 0.75
    const endAngle = Math.PI * 2.25
    const totalArc = endAngle - startAngle

    const draw = (val: number) => {
      ctx.clearRect(0, 0, size, size)

      // Background arc
      ctx.beginPath()
      ctx.arc(cx, cy, r, startAngle, endAngle)
      ctx.strokeStyle = '#1a2744'
      ctx.lineWidth = 10
      ctx.lineCap = 'round'
      ctx.stroke()

      // Colored tick marks
      const ticks = 40
      for (let i = 0; i <= ticks; i++) {
        const pct = i / ticks
        const angle = startAngle + pct * totalArc
        const isMain = i % 8 === 0
        const tickLen = isMain ? 12 : 6
        const x1 = cx + (r - 14) * Math.cos(angle)
        const y1 = cy + (r - 14) * Math.sin(angle)
        const x2 = cx + (r - 14 - tickLen) * Math.cos(angle)
        const y2 = cy + (r - 14 - tickLen) * Math.sin(angle)
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        const hue = pct < 0.5 ? `#00d4ff` : pct < 0.8 ? `#ffd700` : `#ff4d4d`
        ctx.strokeStyle = hue
        ctx.lineWidth = isMain ? 2 : 1
        ctx.globalAlpha = 0.5
        ctx.stroke()
        ctx.globalAlpha = 1
      }

      // Value arc (gradient)
      const pct = Math.min(val / maxValue, 1)
      if (pct > 0) {
        const gradient = ctx.createLinearGradient(
          cx + r * Math.cos(startAngle), cy + r * Math.sin(startAngle),
          cx + r * Math.cos(startAngle + pct * totalArc), cy + r * Math.sin(startAngle + pct * totalArc)
        )
        gradient.addColorStop(0, '#7b2fff')
        gradient.addColorStop(0.5, color)
        gradient.addColorStop(1, pct > 0.8 ? '#ff4d4d' : color)

        ctx.beginPath()
        ctx.arc(cx, cy, r, startAngle, startAngle + pct * totalArc)
        ctx.strokeStyle = gradient
        ctx.lineWidth = 10
        ctx.lineCap = 'round'
        ctx.shadowColor = color
        ctx.shadowBlur = 12
        ctx.stroke()
        ctx.shadowBlur = 0
      }

      // Needle
      const needleAngle = startAngle + pct * totalArc
      const needleLen = r - 24
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(needleAngle)
      ctx.beginPath()
      ctx.moveTo(-6, 0)
      ctx.lineTo(needleLen, 0)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.shadowColor = color
      ctx.shadowBlur = 8
      ctx.stroke()
      ctx.restore()

      // Center dot
      ctx.beginPath()
      ctx.arc(cx, cy, 7, 0, Math.PI * 2)
      ctx.fillStyle = '#1a2744'
      ctx.fill()
      ctx.beginPath()
      ctx.arc(cx, cy, 4, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.shadowColor = color
      ctx.shadowBlur = 10
      ctx.fill()
      ctx.shadowBlur = 0
    }

    const target = value
    const animate = () => {
      const diff = target - currentRef.current
      if (Math.abs(diff) < 0.5) {
        currentRef.current = target
        draw(currentRef.current)
        return
      }
      currentRef.current += diff * 0.12
      draw(currentRef.current)
      animRef.current = requestAnimationFrame(animate)
    }

    cancelAnimationFrame(animRef.current)
    animate()

    return () => cancelAnimationFrame(animRef.current)
  }, [value, maxValue, color, size])

  const { value: fVal, unit } = formatSpeed(value)

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <canvas
          ref={canvasRef}
          style={{ width: size, height: size }}
          className="absolute inset-0"
        />
        <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ paddingTop: size * 0.15 }}>
          <span className="text-4xl font-bold mono text-white leading-none">{fVal}</span>
          <span className="text-sm text-gray-400 mt-1">{unit}</span>
          {label && <span className="text-xs text-gray-600 mt-1 uppercase tracking-wider">{label}</span>}
        </div>
      </div>
    </div>
  )
}
