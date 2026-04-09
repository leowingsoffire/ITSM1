const releases = [
  {
    badge: 'LIVE EXP',
    badgeColor: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
    date: 'End 12 May 2024',
    title: 'A/B Test – Bundling in Product Details Page | above the fold',
    updated: 'Last updated Thu 16 April 2024',
    tag: 'OPTI',
  },
  {
    badge: 'RELEASED',
    badgeColor: 'bg-purple-500/20 text-purple-400 border border-purple-500/30',
    date: '',
    title: 'Customer Experience Enhancement Initiative – Stock availability',
    updated: 'Last updated Thu 16 April 2024',
    tag: 'JUMBO',
  },
  {
    badge: 'RELEASED',
    badgeColor: 'bg-purple-500/20 text-purple-400 border border-purple-500/30',
    date: '',
    title: 'Sustainability Initiative – Promote products that are sustainably prod...',
    updated: 'Last updated Thu 16 April 2024',
    tag: 'JUMBO',
  },
]

function Avatars() {
  return (
    <div className="flex -space-x-2">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="w-6 h-6 rounded-full border-2 border-dark-card bg-gradient-to-br from-purple-400 to-indigo-500"
          style={{ opacity: 0.6 + i * 0.1 }}
        />
      ))}
    </div>
  )
}

export default function LatestReleases() {
  return (
    <div className="bg-dark-card border border-dark-border rounded-2xl p-5 row-span-3">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-semibold">Latest Releases</h3>
        <span className="text-xs text-dark-muted">Latest ▾</span>
      </div>

      <div className="space-y-4">
        {releases.map((r, i) => (
          <div key={i} className="border border-dark-border rounded-xl p-4">
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${r.badgeColor}`}>
                  {r.badge}
                </span>
                {r.date && <span className="text-[10px] text-dark-muted">{r.date}</span>}
              </div>
              <Avatars />
            </div>
            <p className="text-sm text-white font-medium leading-snug mb-2">{r.title}</p>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-dark-muted">{r.updated}</span>
              <span className="text-xs font-bold text-dark-muted">{r.tag}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
