import { Search, User } from 'lucide-react'
import QuarterlyOverview from '../components/QuarterlyOverview'
import SubscriptionsCard from '../components/SubscriptionsCard'
import AvgOrderCard from '../components/AvgOrderCard'
import CalendarCard from '../components/CalendarCard'
import LatestReleases from '../components/LatestReleases'
import AssetGenerated from '../components/AssetGenerated'

export default function Dashboard() {
  return (
    <div>
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-xs text-dark-muted mb-1">Dashboard / Overview</p>
          <h1 className="text-3xl font-bold text-white">Hello Thomas,</h1>
          <p className="text-sm text-purple-400 mt-1">
            <a href="#" className="underline">Click here</a> to setup your double authentication.
          </p>
        </div>

        <div className="flex items-center gap-4">
          {/* Search */}
          <div className="flex items-center gap-2 bg-dark-card border border-dark-border rounded-xl px-4 py-2.5 text-sm text-dark-muted w-64">
            <Search size={16} />
            <span>Click here to search</span>
          </div>
          {/* Avatar */}
          <div className="w-10 h-10 rounded-full border border-dark-border flex items-center justify-center">
            <User size={20} className="text-dark-muted" />
          </div>
          {/* Edit dashboard */}
          <button className="bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors">
            Edit dashboard
          </button>
        </div>
      </div>

      {/* Dashboard grid */}
      <div className="grid grid-cols-12 gap-4">
        {/* Row 1 */}
        <div className="col-span-4 row-span-2">
          <QuarterlyOverview />
        </div>
        <div className="col-span-4">
          <SubscriptionsCard />
        </div>
        <div className="col-span-4">
          <AvgOrderCard />
        </div>

        {/* Row 2 */}
        <div className="col-span-4">
          <CalendarCard />
        </div>
        <div className="col-span-4 row-span-3">
          <LatestReleases />
        </div>

        {/* Row 3 */}
        <div className="col-span-8">
          <AssetGenerated />
        </div>
      </div>
    </div>
  )
}
