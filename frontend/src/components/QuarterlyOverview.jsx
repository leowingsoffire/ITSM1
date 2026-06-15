export default function QuarterlyOverview() {
  const metrics = [
    { color: '#3ecf8e', pct: '26.9%', delta: '↑ 856', label: 'New orders', arc: 85, ring: 50 },
    { color: '#7c5bf5', pct: '56.2%', delta: '↑ 1,892', label: 'Completed sales', arc: 200, ring: 40 },
    { color: '#38bdf8', pct: '45.9%', delta: '↑ 3,985', label: 'Page views', arc: 165, ring: 30 },
  ]

  return (
    <div className="glass-card rounded-2xl p-6 h-full">
      <h3 className="text-white font-semibold mb-6 text-[15px]">Quarterly Overview</h3>

      {/* Donut chart */}
      <div className="flex items-center gap-6">
        <div className="relative shrink-0">
          <svg width="130" height="130" viewBox="0 0 130 130">
            {/* Background rings */}
            {metrics.map((m, i) => {
              const r = m.ring
              return (
                <circle
                  key={`bg-${i}`}
                  cx="65"
                  cy="65"
                  r={r}
                  fill="none"
                  stroke={m.color}
                  strokeWidth="9"
                  strokeLinecap="round"
                  opacity={0.08}
                />
              )
            })}
            {/* Filled arcs */}
            {metrics.map((m, i) => {
              const r = m.ring
              const circ = 2 * Math.PI * r
              return (
                <circle
                  key={i}
                  cx="65"
                  cy="65"
                  r={r}
                  fill="none"
                  stroke={m.color}
                  strokeWidth="9"
                  strokeDasharray={`${(m.arc / 360) * circ} ${circ}`}
                  strokeDashoffset={circ * 0.25}
                  strokeLinecap="round"
                  className="drop-shadow-sm"
                  style={{
                    filter: `drop-shadow(0 0 4px ${m.color}40)`,
                  }}
                />
              )
            })}
          </svg>
        </div>

        <div className="space-y-5">
          {metrics.map((m, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <span
                className="mt-1.5 w-2 h-2 rounded-full shrink-0"
                style={{ background: m.color, boxShadow: `0 0 6px ${m.color}60` }}
              />
              <div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-white">{m.pct}</span>
                  <span className="text-[11px] text-emerald-400 font-medium">{m.delta}</span>
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
