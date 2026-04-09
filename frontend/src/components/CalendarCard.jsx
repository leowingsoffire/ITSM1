export default function CalendarCard() {
  const events = [
    { time: '9:30 – 10:30 AM', title: 'Backlog Refinement', color: '#3ecf8e' },
    { time: '10:30 – 11:30 AM', title: 'DS Status – Process', color: '#7c5bf5' },
  ]

  return (
    <div className="bg-dark-card border border-dark-border rounded-2xl p-5">
      <h3 className="text-white font-semibold mb-4">Calendar</h3>

      <div className="flex gap-4">
        {/* Events list */}
        <div className="flex-1 space-y-3">
          {events.map((e, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ background: e.color }} />
              <div className="flex-1">
                <p className="text-xs text-dark-muted">{e.time}</p>
                <p className="text-sm text-white font-medium">{e.title}</p>
              </div>
              <button className="text-xs text-emerald-400 hover:underline">Join</button>
            </div>
          ))}
        </div>

        {/* Day highlight */}
        <div className="text-center px-3">
          {/* Decorative arcs */}
          <div className="flex justify-center mb-1">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="w-3 h-4 border-t-2 border-dark-muted rounded-t-full mx-0.5" />
            ))}
          </div>
          <p className="text-xs text-dark-muted">Thursday</p>
          <p className="text-4xl font-bold text-white leading-none">16th</p>
          <p className="text-sm text-dark-muted">April</p>
        </div>
      </div>
    </div>
  )
}
