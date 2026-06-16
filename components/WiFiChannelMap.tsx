'use client'

import { useMemo } from 'react'
import { getChannelFrequency } from '@/lib/utils'

export interface WiFiNetwork {
  ssid: string
  channel: number
  signal: number
  band: '2.4' | '5'
  width?: 20 | 40 | 80 | 160
  security?: string
  bssid?: string
  vendor?: string
}

interface Props {
  band: '2.4' | '5'
  networks: WiFiNetwork[]
  highlight?: number
}

const CHANNELS_24 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
const CHANNELS_5 = [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165]
const NON_OVERLAP_24 = [1, 6, 11]
const NON_OVERLAP_5 = [36, 40, 44, 48, 149, 153, 157, 161]

const COLORS = ['#00d4ff', '#7b2fff', '#00ff88', '#ffd700', '#ff8c00', '#ff4d4d', '#e879f9', '#38bdf8']

export default function WiFiChannelMap({ band, networks, highlight }: Props) {
  const channels = band === '2.4' ? CHANNELS_24 : CHANNELS_5
  const nonOverlap = band === '2.4' ? NON_OVERLAP_24 : NON_OVERLAP_5
  const channelWidth24 = band === '2.4' ? 22 : 20

  const maxSignal = 0
  const minSignal = -100

  const svgH = 200
  const barAreaH = 120
  const padL = 32
  const padR = 12
  const padTop = 10

  const channelX = useMemo(() => {
    const w = 600 - padL - padR
    const step = w / (channels.length - 1 || 1)
    return channels.reduce((acc, ch, i) => {
      acc[ch] = padL + i * step
      return acc
    }, {} as Record<number, number>)
  }, [channels])

  const getBarX = (channel: number, width: number): [number, number] => {
    const freqSpan = band === '2.4' ? 83 : (CHANNELS_5[CHANNELS_5.length - 1] - CHANNELS_5[0]) * 5
    const totalW = 600 - padL - padR
    const mhzPerPx = freqSpan / totalW
    const pxW = width / mhzPerPx
    const cx = channelX[channel] ?? padL
    return [cx - pxW / 2, pxW]
  }

  const signalToY = (signal: number): number => {
    const pct = (signal - minSignal) / (maxSignal - minSignal)
    return padTop + barAreaH - pct * barAreaH
  }

  return (
    <div className="w-full">
      <svg viewBox={`0 0 600 ${svgH}`} className="w-full" style={{ height: svgH }}>
        {/* Grid lines */}
        {[-40, -60, -80].map(s => {
          const y = signalToY(s)
          return (
            <g key={s}>
              <line x1={padL} y1={y} x2={600 - padR} y2={y} stroke="#1a2744" strokeWidth={1} strokeDasharray="4 4" />
              <text x={padL - 4} y={y + 4} fill="#4a5568" fontSize={9} textAnchor="end">{s}</text>
            </g>
          )
        })}

        {/* Network bars */}
        {networks.filter(n => n.band === band).map((net, i) => {
          const w = net.width ?? (band === '2.4' ? channelWidth24 : 20)
          const [bx, bw] = getBarX(net.channel, w)
          const y = signalToY(net.signal)
          const h = signalToY(minSignal) - y
          const col = COLORS[i % COLORS.length]
          const isHighlight = highlight === net.channel
          return (
            <g key={`${net.bssid || net.ssid}-${i}`}>
              <rect
                x={bx} y={y}
                width={Math.max(bw, 4)} height={h}
                fill={col}
                fillOpacity={isHighlight ? 0.35 : 0.15}
                stroke={col}
                strokeOpacity={isHighlight ? 0.9 : 0.6}
                strokeWidth={isHighlight ? 2 : 1}
                rx={4}
              />
              {/* SSID label */}
              {bw > 20 && (
                <text
                  x={bx + bw / 2}
                  y={y + 14}
                  fill={col}
                  fontSize={9}
                  textAnchor="middle"
                  fontWeight="600"
                >
                  {net.ssid.length > 10 ? net.ssid.slice(0, 9) + '…' : net.ssid}
                </text>
              )}
            </g>
          )
        })}

        {/* Channel axis */}
        {channels.map(ch => {
          const x = channelX[ch]
          const isNonOverlap = nonOverlap.includes(ch)
          return (
            <g key={ch}>
              <line
                x1={x} y1={signalToY(minSignal)}
                x2={x} y2={signalToY(minSignal) + 6}
                stroke={isNonOverlap ? '#00d4ff' : '#2a3760'}
                strokeWidth={isNonOverlap ? 2 : 1}
              />
              <text
                x={x} y={signalToY(minSignal) + 16}
                fill={isNonOverlap ? '#00d4ff' : '#4a5568'}
                fontSize={band === '2.4' ? 9 : 8}
                textAnchor="middle"
                fontWeight={isNonOverlap ? '700' : '400'}
              >
                {ch}
              </text>
            </g>
          )
        })}

        {/* Axis line */}
        <line
          x1={padL} y1={signalToY(minSignal)}
          x2={600 - padR} y2={signalToY(minSignal)}
          stroke="#1a2744" strokeWidth={1}
        />
      </svg>

      {/* Legend */}
      {networks.filter(n => n.band === band).length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {networks.filter(n => n.band === band).map((net, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
              <span className="text-gray-400">{net.ssid}</span>
              <span className="text-gray-600">ch{net.channel} {net.signal}dBm</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
