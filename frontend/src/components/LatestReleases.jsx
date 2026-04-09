const releases = [
  {
    badge: 'LIVE EXP',
    badgeColor: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25',
    date: 'End 12 May 2024',
    title: 'A/B Test – Bundling in Product Details Page | above the fold',
    updated: 'Last updated Thu 16 April 2024',
    tag: 'OPTI',
    tagColor: 'text-dark-muted',
  },
  {
    badge: 'RELEASED',
    badgeColor: 'bg-purple-500/15 text-purple-400 border border-purple-500/25',
    date: '',
    title: 'Customer Experience Enhancement Initiative – Stock availability',
    updated: 'Last updated Thu 16 April 2024',
    tag: 'JUMBO',
    tagColor: 'text-dark-muted',
  },
  {
    badge: 'RELEASED',
    badgeColor: 'bg-purple-500/15 text-purple-400 border border-purple-500/25',
    date: '',
    title: 'Sustainability Initiative – Promote products that are sustainably prod...',
    updated: 'Last updated Thu 16 April 2024',
    tag: 'JUMBO',
    tagColor: 'text-dark-muted',
  },
]

const avatarGradients = [
  'from-purple-400 to-indigo-500',
  'from-blue-400 to-cyan-500',
  'from-pink-400 to-rose-500',
  'from-amber-400 to-orange-500',
]

function Avatars() {
  return (
    <div className="flex -space-x-2">
      {avatarGradients.map((g, i) => (
        <div
          key={i}
          className={`w-7 h-7 rounded-full border-2 border-dark-card bg-gradient-to-br ${g} ring-1 ring-dark-border/30`}
          style={{ zIndex: avatarGradients.length - i }}
        />
      ))}
    </div>
  )
}

export default function LatestReleases() {
  return (
    <div className="glass-card rounded-2xl p-5 h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-semibold text-[15px]">Latest Releases</h3>
        <span className="text-[11px] text-dark-muted/60 hover:text-dark-muted cursor-pointer transition-colors">
          Latest <span className="text-dark-muted/40">▾</span>
        </span>
      </div>

      <div className="space-y-3">
        {releases.map((r, i) => (
          <div
            key={i}
            className="border border-dark-border/50 rounded-xl p-4 hover:border-dark-border-light/50 hover:bg-dark-hover/20 transition-all duration-200 group"
          >
            <div className="flex items-start justify-between mb-2.5">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${r.badgeColor}`}>
                  {r.badge}
                </span>
                {r.date && <span className="text-[10px] text-dark-muted/60">{r.date}</span>}
              </div>
              <Avatars />
            </div>
            <p className="text-sm text-white font-medium leading-snug mb-2.5 group-hover:text-white/90">
              {r.title}
            </p>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-dark-muted/50">{r.updated}</span>
              <span className={`text-[11px] font-bold ${r.tagColor}`}>{r.tag}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
