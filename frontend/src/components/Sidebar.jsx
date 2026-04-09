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

function SidebarLink({ item, compact }) {
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        `flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm transition-colors ${
          isActive
            ? 'bg-dark-accent/20 text-white font-medium'
            : 'text-dark-muted hover:text-white hover:bg-dark-hover'
        }`
      }
    >
      <item.icon size={18} />
      {!compact && <span>{item.label}</span>}
    </NavLink>
  )
}

export default function Sidebar() {
  return (
    <aside className="fixed top-0 left-0 h-screen w-60 bg-dark-sidebar border-r border-dark-border flex flex-col z-30">
      {/* Logo */}
      <div className="px-5 pt-5 pb-2 flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
      </div>
      <div className="px-5 pb-4 text-xs text-dark-muted">v.0.04</div>

      {/* Favourites */}
      <div className="px-4 flex-1 overflow-y-auto">
        <p className="text-xs text-dark-muted font-medium mb-2 px-1">Favourites</p>
        <div className="space-y-0.5 mb-4">
          {favourites.map((item) => (
            <SidebarLink key={item.to} item={item} />
          ))}
        </div>

        <div className="border-t border-dark-border my-4" />

        {/* Main menu */}
        <p className="text-xs text-dark-muted font-medium mb-2 px-1">Main menu</p>
        <div className="space-y-0.5 mb-4">
          {mainMenu.map((item) => (
            <SidebarLink key={item.to} item={item} />
          ))}
        </div>
      </div>

      {/* Bottom */}
      <div className="px-4 pb-5 space-y-0.5 border-t border-dark-border pt-3">
        {bottomMenu.map((item) => (
          <SidebarLink key={item.to} item={item} />
        ))}
      </div>
    </aside>
  )
}
