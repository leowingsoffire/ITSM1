import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts'
import { Maximize2 } from 'lucide-react'

const data = [
  { v: 220 }, { v: 240 }, { v: 230 }, { v: 260 },
  { v: 255 }, { v: 270 }, { v: 278 },
]

function CustomDot(props) {
  const { cx, cy, index } = props
  if (index !== data.length - 1) return null
  return (
    <g>
      <circle cx={cx} cy={cy} r={6} fill="#1a1727" stroke="#7c5bf5" strokeWidth={2} />
      <circle cx={cx} cy={cy} r={2.5} fill="#7c5bf5" />
    </g>
  )
}

export default function SubscriptionsCard() {
  return (
    <div className="glass-card rounded-2xl p-5 flex flex-col justify-between relative overflow-hidden h-full">
      <div className="flex items-start justify-between">
        <h3 className="text-dark-muted text-sm font-medium">Subscriptions</h3>
        <Maximize2 size={14} className="text-dark-muted/50 hover:text-dark-muted transition-colors cursor-pointer" />
      </div>

      <div className="flex items-end justify-between mt-3">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-white tracking-tight">278</span>
            <span className="text-[11px] text-emerald-400 font-semibold">↑ 16.2%</span>
          </div>
          <p className="text-[11px] text-dark-muted/70 mt-1.5">Weekly <span className="text-dark-muted/40">▾</span></p>
        </div>

        <div className="w-28 h-16">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <defs>
                <linearGradient id="subGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#7c5bf5" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#7c5bf5" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip
                contentStyle={{ background: '#1a1727', border: '1px solid #2a2740', borderRadius: 8, fontSize: 12, color: '#e0dce8' }}
                cursor={{ stroke: '#7c5bf5', strokeWidth: 1, strokeDasharray: '4 4' }}
              />
              <Area type="monotone" dataKey="v" stroke="#7c5bf5" fill="url(#subGrad)" strokeWidth={2} dot={<CustomDot />} activeDot={{ r: 4, fill: '#7c5bf5', stroke: '#1a1727', strokeWidth: 2 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Pill badges */}
      <div className="flex gap-1.5 absolute top-5 right-10">
        <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-medium">+278</span>
        <span className="text-[10px] bg-dark-border/50 text-dark-muted px-2 py-0.5 rounded-full">-4</span>
      </div>
    </div>
  )
}
