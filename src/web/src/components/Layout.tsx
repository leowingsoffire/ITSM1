import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const NAV_ITEMS = [
  { section: 'Main' },
  { to: '/', icon: '📊', label: 'Dashboard' },
  { section: 'Service Management' },
  { to: '/incidents', icon: '🔥', label: 'Incidents' },
  { to: '/service-requests', icon: '📋', label: 'Service Requests' },
  { section: 'Configuration' },
  { to: '/assets', icon: '💻', label: 'Assets / CMDB' },
  { to: '/knowledge', icon: '📚', label: 'Knowledge Base' },
  { section: 'Administration' },
  { to: '/admin/users', icon: '👤', label: 'Users' },
  { to: '/admin/teams', icon: '👥', label: 'Teams' },
];

export function Layout() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const initials = user
    ? `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase() || user.email[0].toUpperCase()
    : '?';

  return (
    <div className="app-layout">
      <nav className="sidebar">
        <div className="sidebar-brand">
          <div>
            <h1>ITSM1</h1>
            <small>Service Management</small>
          </div>
        </div>

        <div className="sidebar-nav">
          {NAV_ITEMS.map((item, i) =>
            'section' in item && !('to' in item) ? (
              <div key={i} className="sidebar-section">{item.section}</div>
            ) : 'to' in item ? (
              <NavLink
                key={item.to}
                to={item.to!}
                end={item.to === '/'}
                className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
              >
                <span className="icon">{item.icon}</span>
                <span>{item.label}</span>
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
          <button className="btn btn-outline" style={{ width: '100%', color: '#ccc', borderColor: 'rgba(255,255,255,0.2)' }} onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </nav>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
