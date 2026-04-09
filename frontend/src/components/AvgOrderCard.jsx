import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { Maximize2 } from 'lucide-react'

const data = [
  { name: 'Current', value: 180.70 },
  { name: 'Delta', value: 23.60 },
]
const COLORS = ['#7c5bf5', '#f43f5e']

export default function AvgOrderCard() {
  return (
    <div className="bg-dark-card border border-dark-border rounded-2xl p-5 flex flex-col justify-between relative overflow-hidden">
      <div className="flex items-start justify-between">
        <h3 className="text-dark-muted text-sm font-medium">Avg. Order Value</h3>
        <Maximize2 size={14} className="text-dark-muted" />
      </div>

      <div className="flex items-end justify-between mt-2">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-white">$182.70</span>
            <span className="text-xs text-rose-400 font-medium">↓ 3.6%</span>
          </div>
          <p className="text-xs text-dark-muted mt-1">Weekly ▾</p>
        </div>

        <div className="w-20 h-16">
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
                  <Cell key={i} fill={COLORS[i]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Price pills */}
      <div className="flex gap-1.5 absolute top-5 right-10">
        <span className="text-[10px] bg-dark-border text-emerald-400 px-1.5 py-0.5 rounded-full">$180.70</span>
        <span className="text-[10px] bg-dark-border text-rose-400 px-1.5 py-0.5 rounded-full">-$23.60</span>
      </div>
    </div>
  )
}
