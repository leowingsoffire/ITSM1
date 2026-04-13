import { Search, User, ChevronRight } from 'lucide-react'
import QuarterlyOverview from '../components/QuarterlyOverview'
import SubscriptionsCard from '../components/SubscriptionsCard'
import AvgOrderCard from '../components/AvgOrderCard'
import CalendarCard from '../components/CalendarCard'
import LatestReleases from '../components/LatestReleases'
import AssetGenerated from '../components/AssetGenerated'

export default function Dashboard() {
  return (
    <div className="animate-fade-in">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-dark-muted mb-2">
            <span>Dashboard</span>
            <ChevronRight size={12} />
            <span className="text-dark-muted/80">Overview</span>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight animate-slide-up">
            Hello Thomas,
          </h1>
          <p className="text-sm text-purple-400/90 mt-1.5">
            <a href="#" className="underline decoration-purple-400/40 underline-offset-2 hover:decoration-purple-400 transition-colors">
              Click here
            </a>
            {' '}to set up your double authentication.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="flex items-center gap-2.5 bg-dark-card/80 border border-dark-border/60 rounded-xl px-4 py-2.5 text-sm text-dark-muted w-56 hover:border-dark-border transition-colors cursor-pointer group">
            <Search size={15} className="text-dark-muted/70 group-hover:text-dark-muted transition-colors" />
            <span className="text-dark-muted/60 text-xs">Click here to search</span>
            <kbd className="ml-auto text-[10px] bg-dark-border/40 text-dark-muted/50 px-1.5 py-0.5 rounded font-mono">⌘K</kbd>
          </div>
          {/* Avatar */}
          <div className="w-10 h-10 rounded-full border border-dark-border/60 flex items-center justify-center hover:border-dark-accent/30 transition-colors cursor-pointer">
            <User size={18} className="text-dark-muted" />
          </div>
          {/* Edit dashboard */}
          <button className="bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-all duration-200 shadow-glow-sm hover:shadow-glow">
            Edit dashboard
          </button>
        </div>
      </div>

      {/* Dashboard grid */}
      <div className="grid grid-cols-12 gap-5">
        {/* Row 1 */}
        <div className="col-span-4 row-span-2 animate-slide-up" style={{ animationDelay: '0.05s' }}>
          <QuarterlyOverview />
        </div>
        <div className="col-span-4 animate-slide-up" style={{ animationDelay: '0.1s' }}>
          <SubscriptionsCard />
        </div>
        <div className="col-span-4 animate-slide-up" style={{ animationDelay: '0.15s' }}>
          <AvgOrderCard />
        </div>

        {/* Row 2 */}
        <div className="col-span-4 animate-slide-up" style={{ animationDelay: '0.2s' }}>
          <CalendarCard />
        </div>
        <div className="col-span-4 row-span-3 animate-slide-up" style={{ animationDelay: '0.25s' }}>
          <LatestReleases />
        </div>

        {/* Row 3 */}
        <div className="col-span-8 animate-slide-up" style={{ animationDelay: '0.3s' }}>
          <AssetGenerated />
        </div>
      </div>
    </div>
  )
}
