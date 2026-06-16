'use client'

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine
} from 'recharts'
import { latencyColor } from '@/lib/utils'

interface DataPoint { t: number; latency: number; label?: string }

interface Props {
  data: DataPoint[]
  height?: number
  showGrid?: boolean
  maxPoints?: number
}

const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ value: number }> }) => {
  if (!active || !payload?.length) return null
  const val = payload[0].value
  return (
    <div className="bg-[#0a1128] border border-[#1a2744] rounded-lg px-3 py-2 text-sm">
      <span className="font-bold mono" style={{ color: latencyColor(val) }}>{val.toFixed(1)} ms</span>
    </div>
  )
}

export default function LatencyChart({ data, height = 160, showGrid = false }: Props) {
  const values  = data.map(d => d.latency)
  const minVal  = Math.min(...values)
  const maxVal  = Math.max(...values)
  const range   = Math.max(maxVal - minVal, 1)
  // padding: 30% do range, mínimo 2 ms de cada lado
  const pad     = Math.max(range * 0.3, 2)
  const yMin    = Math.max(0, Math.floor(minVal - pad))
  const yMax    = Math.ceil(maxVal + pad)

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
        {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#1a2744" />}
        <XAxis dataKey="t" hide />
        <YAxis
          domain={[yMin, yMax]}
          tick={{ fill: '#4a5568', fontSize: 10 }}
          tickFormatter={v => `${v}`}
        />
        <Tooltip content={<CustomTooltip />} />
        {50 >= yMin && 50 <= yMax && (
          <ReferenceLine y={50} stroke="#ffd700" strokeDasharray="4 4" strokeOpacity={0.3} />
        )}
        {100 >= yMin && 100 <= yMax && (
          <ReferenceLine y={100} stroke="#ff4d4d" strokeDasharray="4 4" strokeOpacity={0.3} />
        )}
        <Line
          type="monotone"
          dataKey="latency"
          stroke="#00d4ff"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: '#00d4ff', stroke: '#050a1a', strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
