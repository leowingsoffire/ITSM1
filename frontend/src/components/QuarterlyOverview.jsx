export default function QuarterlyOverview() {
  const metrics = [
    { color: '#3ecf8e', pct: '26.9%', delta: '↑ 856', label: 'New orders', arc: 85 },
    { color: '#7c5bf5', pct: '56.2%', delta: '↑ 1,892', label: 'Completed sales', arc: 200 },
    { color: '#38bdf8', pct: '45.9%', delta: '↑ 3,985', label: 'Page views', arc: 165 },
  ]

  return (
    <div className="bg-dark-card border border-dark-border rounded-2xl p-6 row-span-2">
      <h3 className="text-white font-semibold mb-6">Quarterly Overview</h3>

      {/* Donut chart */}
      <div className="flex items-center gap-6">
        <svg width="120" height="120" viewBox="0 0 120 120" className="shrink-0">
          {metrics.map((m, i) => {
            const r = 50 - i * 10
            const circ = 2 * Math.PI * r
            return (
              <circle
                key={i}
                cx="60"
                cy="60"
                r={r}
                fill="none"
                stroke={m.color}
                strokeWidth="8"
                strokeDasharray={`${(m.arc / 360) * circ} ${circ}`}
                strokeDashoffset={circ * 0.25}
                strokeLinecap="round"
                className="opacity-90"
              />
            )
          })}
        </svg>

        <div className="space-y-5">
          {metrics.map((m, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ background: m.color }} />
              <div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-white">{m.pct}</span>
                  <span className="text-xs text-emerald-400">{m.delta}</span>
                </div>
                <p className="text-xs text-dark-muted">{m.label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
