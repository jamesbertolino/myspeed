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
  const maxVal = Math.max(...data.map(d => d.latency), 100)

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
        {showGrid && (
          <CartesianGrid strokeDasharray="3 3" stroke="#1a2744" />
        )}
        <XAxis dataKey="t" hide />
        <YAxis domain={[0, maxVal * 1.2]} tick={{ fill: '#4a5568', fontSize: 10 }} />
        <Tooltip content={<CustomTooltip />} />
        <ReferenceLine y={50} stroke="#ffd700" strokeDasharray="4 4" strokeOpacity={0.3} />
        <ReferenceLine y={100} stroke="#ff4d4d" strokeDasharray="4 4" strokeOpacity={0.3} />
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
