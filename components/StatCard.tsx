import { LucideIcon } from 'lucide-react'
import clsx from 'clsx'

interface Props {
  label: string
  value: string | number
  unit?: string
  icon?: LucideIcon
  color?: 'cyan' | 'green' | 'purple' | 'yellow' | 'red' | 'orange'
  sub?: string
  tag?: string
  tagColor?: string
  loading?: boolean
}

const colorMap = {
  cyan:   { text: 'text-[#00d4ff]', border: 'border-cyan-500/20',   glow: 'rgba(0,212,255,0.08)',   icon: 'bg-cyan-500/10 text-[#00d4ff]' },
  green:  { text: 'text-[#00ff88]', border: 'border-green-500/20',  glow: 'rgba(0,255,136,0.08)',   icon: 'bg-green-500/10 text-[#00ff88]' },
  purple: { text: 'text-[#7b2fff]', border: 'border-purple-500/20', glow: 'rgba(123,47,255,0.08)',  icon: 'bg-purple-500/10 text-[#7b2fff]' },
  yellow: { text: 'text-[#ffd700]', border: 'border-yellow-500/20', glow: 'rgba(255,215,0,0.08)',   icon: 'bg-yellow-500/10 text-[#ffd700]' },
  red:    { text: 'text-[#ff4d4d]', border: 'border-red-500/20',    glow: 'rgba(255,77,77,0.08)',   icon: 'bg-red-500/10 text-[#ff4d4d]' },
  orange: { text: 'text-[#ff8c00]', border: 'border-orange-500/20', glow: 'rgba(255,140,0,0.08)',   icon: 'bg-orange-500/10 text-[#ff8c00]' },
}

export default function StatCard({ label, value, unit, icon: Icon, color = 'cyan', sub, tag, tagColor, loading }: Props) {
  const c = colorMap[color]
  return (
    <div
      className={clsx('card p-5 rounded-xl relative overflow-hidden transition-all duration-300', c.border)}
      style={{ background: `radial-gradient(ellipse at top left, ${c.glow}, transparent 60%), #0a1128` }}
    >
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs text-gray-500 font-semibold uppercase tracking-wider">{label}</span>
        {Icon && (
          <div className={clsx('w-8 h-8 rounded-lg flex items-center justify-center', c.icon)}>
            <Icon className="w-4 h-4" />
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-end gap-1 mb-1">
          <div className="h-9 w-20 rounded bg-white/5 animate-pulse" />
          <div className="h-5 w-8 rounded bg-white/5 animate-pulse mb-1" />
        </div>
      ) : (
        <div className="flex items-end gap-1.5 mb-1">
          <span className={clsx('text-3xl md:text-4xl font-bold tracking-tight mono', c.text)}>{value}</span>
          {unit && <span className="text-sm text-gray-400 mb-1.5 font-medium">{unit}</span>}
        </div>
      )}

      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
      {tag && (
        <span className={clsx('tag mt-2', tagColor || 'tag-cyan')}>{tag}</span>
      )}
    </div>
  )
}
