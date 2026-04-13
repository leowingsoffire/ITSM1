import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { Maximize2 } from 'lucide-react'

const data = [
  { name: 'Current', value: 180.70 },
  { name: 'Delta', value: 23.60 },
]
const COLORS = ['#7c5bf5', '#f43f5e']

export default function AvgOrderCard() {
  return (
    <div className="glass-card rounded-2xl p-5 flex flex-col justify-between relative overflow-hidden h-full">
      <div className="flex items-start justify-between">
        <h3 className="text-dark-muted text-sm font-medium">Avg. Order Value</h3>
        <Maximize2 size={14} className="text-dark-muted/50 hover:text-dark-muted transition-colors cursor-pointer" />
      </div>

      <div className="flex items-end justify-between mt-3">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-white tracking-tight">$182.70</span>
            <span className="text-[11px] text-rose-400 font-semibold">↓ 3.6%</span>
          </div>
          <p className="text-[11px] text-dark-muted/70 mt-1.5">Weekly <span className="text-dark-muted/40">▾</span></p>
        </div>

        <div className="w-20 h-16 relative">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                innerRadius={22}
                outerRadius={30}
                dataKey="value"
                startAngle={90}
                endAngle={-270}
                strokeWidth={0}
              >
                {data.map((_, i) => (
                  <Cell
                    key={i}
                    fill={COLORS[i]}
                    style={{ filter: i === 0 ? 'drop-shadow(0 0 4px rgba(124,91,245,0.4))' : 'none' }}
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Price pills */}
      <div className="flex gap-1.5 absolute top-5 right-10">
        <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-medium">$180.70</span>
        <span className="text-[10px] bg-rose-500/10 text-rose-400 border border-rose-500/20 px-2 py-0.5 rounded-full font-medium">-$23.60</span>
      </div>
    </div>
  )
}
