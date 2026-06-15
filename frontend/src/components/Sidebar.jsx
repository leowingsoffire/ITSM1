import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  AppWindow,
  CalendarDays,
  PlusCircle,
  Archive,
  Settings,
  FileText,
  FileCode2,
  FolderOpen,
  Layers,
} from 'lucide-react'

const favourites = [
  { icon: FileText, label: 'Monthly reports', to: '/reports' },
  { icon: FileCode2, label: 'DS Documentation', to: '/docs' },
  { icon: FolderOpen, label: '2023 Test Reports', to: '/tests' },
]

const mainMenu = [
  { icon: LayoutDashboard, label: 'Dashboard', to: '/' },
  { icon: AppWindow, label: 'Applications', to: '/applications' },
  { icon: CalendarDays, label: 'Calendar', to: '/calendar' },
  { icon: PlusCircle, label: 'Add Function', to: '/add' },
]

const bottomMenu = [
  { icon: Archive, label: 'Archive', to: '/archive' },
  { icon: Settings, label: 'Settings', to: '/settings' },
]

function SidebarLink({ item }) {
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        `group relative flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition-all duration-200 ${
          isActive
            ? 'bg-dark-accent/15 text-white font-medium shadow-glow-sm'
            : 'text-dark-muted hover:text-white hover:bg-dark-hover/60'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {/* Active indicator bar */}
          {isActive && (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-dark-accent rounded-r-full" />
          )}
          <item.icon size={18} className={`transition-colors duration-200 ${isActive ? 'text-dark-accent-light' : 'group-hover:text-white'}`} />
          <span>{item.label}</span>
        </>
      )}
    </NavLink>
  )
}

export default function Sidebar() {
  return (
    <aside className="fixed top-0 left-0 h-screen w-60 bg-dark-sidebar/95 backdrop-blur-sm border-r border-dark-border/50 flex flex-col z-30">
      {/* Logo */}
      <div className="px-5 pt-5 pb-2 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 via-indigo-500 to-purple-700 flex items-center justify-center shadow-glow animate-glow-pulse">
          <Layers size={20} className="text-white" />
        </div>
        <div className="w-8 h-8 rounded-lg border border-dark-border/60 flex items-center justify-center ml-auto">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b85a0" strokeWidth="2" strokeLinecap="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 3v18" />
          </svg>
        </div>
      </div>
      <div className="px-5 pb-4 text-[10px] text-dark-muted/60 tracking-wider">v.0.04</div>

      {/* Favourites */}
      <div className="px-3 flex-1 overflow-y-auto">
        <p className="text-[10px] uppercase tracking-widest text-dark-muted/60 font-semibold mb-2 px-2">Favourites</p>
        <div className="space-y-0.5 mb-4">
          {favourites.map((item) => (
            <SidebarLink key={item.to} item={item} />
          ))}
        </div>

        <div className="border-t border-dark-border/40 mx-2 my-4" />

        {/* Main menu */}
        <p className="text-[10px] uppercase tracking-widest text-dark-muted/60 font-semibold mb-2 px-2">Main menu</p>
        <div className="space-y-0.5 mb-4">
          {mainMenu.map((item) => (
            <SidebarLink key={item.to} item={item} />
          ))}
        </div>
      </div>

      {/* Bottom */}
      <div className="px-3 pb-5 space-y-0.5 border-t border-dark-border/40 pt-3">
        {bottomMenu.map((item) => (
          <SidebarLink key={item.to} item={item} />
        ))}
      </div>
    </aside>
  )
}
