import { AreaChart, Area, ResponsiveContainer, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts'

const data = [
  { label: 'Jan', v: 80 }, { label: 'Feb', v: 120 }, { label: 'Mar', v: 100 },
  { label: 'Apr', v: 200 }, { label: 'May', v: 180 }, { label: 'Jun', v: 350 },
  { label: 'Jul', v: 600 }, { label: 'Aug', v: 550 }, { label: 'Sep', v: 750 },
  { label: 'Oct', v: 900 },
]

export default function AssetGenerated() {
  return (
    <div className="bg-dark-card border border-dark-border rounded-2xl p-6">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="text-white font-semibold mb-1">Asset Generated</h3>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-white">128,7K</span>
            <span className="text-xs text-emerald-400 font-medium">↑ 18.3%</span>
          </div>
        </div>
      </div>

      <p className="text-xs text-dark-muted max-w-[220px] mb-4 leading-relaxed">
        Increasing the average order value fosters sustainable growth, amplifying revenue streams.
      </p>

      <div className="h-44 -mx-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="assetGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7c5bf5" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#7c5bf5" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2740" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#8b85a0' }} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fontSize: 10, fill: '#8b85a0' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `$${v}`}
            />
            <Tooltip
              contentStyle={{
                background: '#1a1727',
                border: '1px solid #2a2740',
                borderRadius: 8,
                fontSize: 12,
                color: '#e0dce8',
              }}
            />
            <Area type="monotone" dataKey="v" stroke="#7c5bf5" fill="url(#assetGrad)" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Banner */}
      <div className="mt-4 bg-gradient-to-r from-purple-600/30 to-purple-400/10 rounded-xl p-4 flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-purple-500/30 flex items-center justify-center shrink-0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
        </div>
        <div>
          <p className="text-sm text-white font-medium">Get the extension</p>
          <button className="text-xs text-purple-300 underline">Install now</button>
        </div>
      </div>
    </div>
  )
}
