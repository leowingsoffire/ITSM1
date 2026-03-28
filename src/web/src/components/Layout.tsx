import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../hooks/useTheme';

type NavItem = { section: string } | { to: string; icon: string; label: string; adminOnly?: boolean };

const NAV_ITEMS: NavItem[] = [
  { section: 'Main' },
  { to: '/', icon: '⌘', label: 'Dashboard' },
  { section: 'Service Management' },
  { to: '/incidents', icon: '⚡', label: 'Incidents' },
  { to: '/service-requests', icon: '✦', label: 'Service Requests' },
  { section: 'Configuration' },
  { to: '/assets', icon: '◎', label: 'Assets / CMDB' },
  { to: '/knowledge', icon: '◈', label: 'Knowledge Base' },
  { section: 'Administration' },
  { to: '/admin/users', icon: '◉', label: 'Users', adminOnly: true },
  { to: '/admin/teams', icon: '⬡', label: 'Teams', adminOnly: true },
  { section: 'Account' },
  { to: '/profile', icon: '◑', label: 'My Profile' },
];

const ROUTE_LABELS: Record<string, string> = {
  '/': 'Dashboard',
  '/incidents': 'Incidents',
  '/service-requests': 'Service Requests',
  '/assets': 'Assets / CMDB',
  '/knowledge': 'Knowledge Base',
  '/admin/users': 'User Management',
  '/admin/teams': 'Team Management',
  '/profile': 'My Profile',
};

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'MANAGER';

  const visibleItems = NAV_ITEMS.filter((item, i, arr) => {
    if ('adminOnly' in item && item.adminOnly && !isAdmin) return false;
    if ('section' in item && !('to' in item)) {
      const nextItems = arr.slice(i + 1);
      const nextSection = nextItems.findIndex(n => 'section' in n && !('to' in n));
      const children = nextItems.slice(0, nextSection === -1 ? undefined : nextSection);
      return children.some(c => !('adminOnly' in c && c.adminOnly) || isAdmin);
    }
    return true;
  });

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const initials = user
    ? `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase() || user.email[0].toUpperCase()
    : '?';

  const currentLabel = ROUTE_LABELS[location.pathname] || 'Page';
  const isHome = location.pathname === '/';

  return (
    <div className="app-layout">
      <nav className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">IT</div>
          <div>
            <h1>ITSM1</h1>
            <small>Service Management</small>
          </div>
        </div>

        <div className="sidebar-nav">
          {visibleItems.map((item, i) =>
            'section' in item && !('to' in item) ? (
              <div key={i} className="sidebar-section">{item.section}</div>
            ) : 'to' in item ? (
              <NavLink
                key={item.to}
                to={item.to!}
                end={item.to === '/'}
                className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
              </NavLink>
            ) : null
          )}
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-avatar">{initials}</div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">
                {user ? `${user.firstName} ${user.lastName}` : 'User'}
              </div>
              <div className="sidebar-user-role">{user?.role?.replace('_', ' ') || ''}</div>
            </div>
          </div>
          <button className="sidebar-signout" onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </nav>
      <main className="main-content">
        <header className="top-header">
          <div className="top-header-left">
            <nav className="breadcrumbs">
              <a className="breadcrumb-item" href="#" onClick={e => { e.preventDefault(); navigate('/'); }}>Home</a>
              {!isHome && (
                <>
                  <span className="breadcrumb-sep">›</span>
                  <span className="breadcrumb-item active">{currentLabel}</span>
                </>
              )}
            </nav>
          </div>
          <div className="top-header-right">
            <button
              className="theme-toggle"
              onClick={toggleTheme}
              data-tooltip={theme === 'light' ? 'Dark mode' : 'Light mode'}
              aria-label="Toggle theme"
            >
              {theme === 'light' ? '🌙' : '☀️'}
            </button>
          </div>
        </header>
        <div className="main-content-body">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
