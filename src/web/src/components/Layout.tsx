import { Outlet, Link, useNavigate } from 'react-router-dom';

export function Layout() {
  const navigate = useNavigate();

  function handleLogout() {
    localStorage.removeItem('itsm_token');
    navigate('/login');
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <nav style={{ width: 220, background: '#1a1a2e', color: '#fff', padding: 20 }}>
        <h2 style={{ margin: '0 0 24px' }}>ITSM1</h2>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          <li style={{ marginBottom: 12 }}>
            <Link to="/" style={{ color: '#ccc', textDecoration: 'none' }}>Dashboard</Link>
          </li>
          <li style={{ marginBottom: 12 }}>
            <Link to="/incidents" style={{ color: '#ccc', textDecoration: 'none' }}>Incidents</Link>
          </li>
        </ul>
        <button onClick={handleLogout} style={{ marginTop: 'auto', background: 'none', color: '#ccc', border: '1px solid #ccc', padding: '6px 12px', cursor: 'pointer' }}>
          Logout
        </button>
      </nav>
      <main style={{ flex: 1, padding: 24, background: '#f5f5f5' }}>
        <Outlet />
      </main>
    </div>
  );
}
