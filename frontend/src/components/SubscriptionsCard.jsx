import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts'
import { Maximize2 } from 'lucide-react'

const data = [
  { v: 220 }, { v: 240 }, { v: 230 }, { v: 260 },
  { v: 255 }, { v: 270 }, { v: 278 },
]

export default function SubscriptionsCard() {
  return (
    <div className="bg-dark-card border border-dark-border rounded-2xl p-5 flex flex-col justify-between relative overflow-hidden">
      <div className="flex items-start justify-between">
        <h3 className="text-dark-muted text-sm font-medium">Subscriptions</h3>
        <Maximize2 size={14} className="text-dark-muted" />
      </div>

      <div className="flex items-end justify-between mt-2">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-white">278</span>
            <span className="text-xs text-emerald-400 font-medium">↑ 16.2%</span>
          </div>
          <p className="text-xs text-dark-muted mt-1">Weekly ▾</p>
        </div>

        <div className="w-28 h-14">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <defs>
                <linearGradient id="subGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#7c5bf5" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#7c5bf5" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip
                contentStyle={{ background: '#1a1727', border: '1px solid #2a2740', borderRadius: 8, fontSize: 12, color: '#e0dce8' }}
              />
              <Area type="monotone" dataKey="v" stroke="#7c5bf5" fill="url(#subGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Pill badges */}
      <div className="flex gap-1.5 absolute top-5 right-10">
        <span className="text-[10px] bg-dark-border text-emerald-400 px-1.5 py-0.5 rounded-full">+278</span>
        <span className="text-[10px] bg-dark-border text-dark-muted px-1.5 py-0.5 rounded-full">-4</span>
      </div>
    </div>
  )
}
