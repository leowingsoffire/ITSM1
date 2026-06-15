export default function CalendarCard() {
  const events = [
    { time: '9:30 – 10:30 AM', title: 'Backlog Refinement', color: '#3ecf8e' },
    { time: '10:30 – 11:30 AM', title: 'DS Status – Process', color: '#7c5bf5' },
  ]

  return (
    <div className="glass-card rounded-2xl p-5 h-full">
      <h3 className="text-white font-semibold mb-4 text-[15px]">Calendar</h3>

      <div className="flex gap-4">
        {/* Events list */}
        <div className="flex-1 space-y-3">
          {events.map((e, i) => (
            <div key={i} className="flex items-start gap-3 group">
              <span
                className="mt-1.5 w-2 h-2 rounded-full shrink-0"
                style={{ background: e.color, boxShadow: `0 0 6px ${e.color}50` }}
              />
              <div className="flex-1">
                <p className="text-[11px] text-dark-muted">{e.time}</p>
                <p className="text-sm text-white font-medium">{e.title}</p>
              </div>
              <button className="text-xs text-emerald-400 hover:text-emerald-300 font-medium opacity-70 group-hover:opacity-100 transition-opacity">
                Join
              </button>
            </div>
          ))}
        </div>

        {/* Day highlight */}
        <div className="text-center px-3">
          {/* Decorative arcs matching reference */}
          <div className="flex justify-center mb-1.5">
            <svg width="70" height="18" viewBox="0 0 70 18">
              {[0, 1, 2, 3, 4].map((i) => (
                <path
                  key={i}
                  d={`M${8 + i * 12},16 Q${14 + i * 12},2 ${20 + i * 12},16`}
                  fill="none"
                  stroke="#8b85a0"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  opacity={0.4 + i * 0.1}
                />
              ))}
            </svg>
          </div>
          <p className="text-[11px] text-dark-muted">Thursday</p>
          <p className="text-4xl font-bold text-white leading-none my-0.5">16th</p>
          <p className="text-sm text-dark-muted/70">April</p>
        </div>
      </div>
    </div>
  )
}
