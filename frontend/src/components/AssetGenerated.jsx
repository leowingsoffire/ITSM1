import { AreaChart, Area, ResponsiveContainer, CartesianGrid, XAxis, YAxis, Tooltip, ReferenceDot } from 'recharts'
import { Download } from 'lucide-react'

const data = [
  { label: 'Jan', v: 80 }, { label: 'Feb', v: 120 }, { label: 'Mar', v: 100 },
  { label: 'Apr', v: 200 }, { label: 'May', v: 180 }, { label: 'Jun', v: 350 },
  { label: 'Jul', v: 600 }, { label: 'Aug', v: 550 }, { label: 'Sep', v: 750 },
  { label: 'Oct', v: 900 },
]

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-dark-card/95 backdrop-blur-sm border border-dark-border/60 rounded-lg px-3 py-2 shadow-card">
      <p className="text-[10px] text-dark-muted mb-0.5">{label}</p>
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-bold text-white">{(payload[0].value * 245.36).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        <span className="text-[10px] text-emerald-400 font-medium bg-emerald-500/10 px-1.5 py-0.5 rounded">+3.4%</span>
      </div>
    </div>
  )
}

export default function AssetGenerated() {
  return (
    <div className="glass-card rounded-2xl p-6">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="text-white font-semibold mb-1.5 text-[15px]">Asset Generated</h3>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-white tracking-tight">128,7K</span>
            <span className="text-[11px] text-emerald-400 font-semibold">↑ 18.3%</span>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-dark-muted/70 max-w-[220px] mb-5 leading-relaxed">
        Increasing the average order value fosters sustainable growth, amplifying revenue streams.
      </p>

      <div className="h-48 -mx-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="assetGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7c5bf5" stopOpacity={0.25} />
                <stop offset="60%" stopColor="#7c5bf5" stopOpacity={0.08} />
                <stop offset="100%" stopColor="#7c5bf5" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2740" strokeOpacity={0.5} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: '#8b85a0' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#8b85a0' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `$${v}`}
              width={40}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#7c5bf5', strokeWidth: 1, strokeDasharray: '4 4' }} />
            <Area
              type="monotone"
              dataKey="v"
              stroke="#7c5bf5"
              fill="url(#assetGrad)"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 5, fill: '#7c5bf5', stroke: '#1a1727', strokeWidth: 2 }}
            />
            <ReferenceDot x="Oct" y={900} r={5} fill="#7c5bf5" stroke="#1a1727" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Banner */}
      <div className="mt-5 bg-gradient-to-r from-purple-600/20 via-purple-500/10 to-transparent rounded-xl p-4 flex items-center gap-4 border border-purple-500/10">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500/30 to-purple-600/20 flex items-center justify-center shrink-0 shadow-glow-sm">
          <Download size={18} className="text-purple-300" />
        </div>
        <div>
          <p className="text-sm text-white font-medium">Get the extension</p>
          <button className="text-xs text-purple-300/80 underline decoration-purple-300/30 underline-offset-2 hover:text-purple-200 hover:decoration-purple-300 transition-colors">
            Install now
          </button>
        </div>
      </div>
    </div>
  )
}
