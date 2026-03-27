import { useEffect, useState } from 'react';
import { api } from '../api/client';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  team?: { name: string } | null;
}

const ROLES = ['ADMIN', 'MANAGER', 'AGENT', 'END_USER'];

export function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [editUser, setEditUser] = useState<User | null>(null);

  function fetchData() {
    const params: Record<string, string> = {};
    if (search) params.search = search;
    if (filterRole) params.role = filterRole;
    api.get('/admin/users', { params })
      .then(({ data }) => setUsers(data.data))
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchData(); }, [search, filterRole]);

  async function toggleActive(user: User) {
    try {
      await api.patch(`/admin/users/${user.id}`, { isActive: !user.isActive });
      fetchData();
    } catch {}
  }

  async function changeRole(user: User, role: string) {
    try {
      await api.patch(`/admin/users/${user.id}`, { role });
      fetchData();
    } catch {}
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">User Management</h1>
          <p className="page-subtitle">Manage user accounts and roles</p>
        </div>
      </div>

      <div className="filter-bar">
        <input className="form-input search-input" placeholder="Search users..." value={search} onChange={e => setSearch(e.target.value)} />
        <select className="form-select" value={filterRole} onChange={e => setFilterRole(e.target.value)}>
          <option value="">All Roles</option>
          {ROLES.map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
        </select>
      </div>

      <div className="card">
        {loading ? (
          <div className="loading-spinner">Loading...</div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Team</th>
                  <th>Status</th>
                  <th>Joined</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 500 }}>{u.firstName} {u.lastName}</td>
                    <td>{u.email}</td>
                    <td>
                      <select
                        className="form-select"
                        value={u.role}
                        onChange={e => changeRole(u, e.target.value)}
                        style={{ width: 'auto', padding: '2px 8px', fontSize: 'var(--text-xs)' }}
                      >
                        {ROLES.map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
                      </select>
                    </td>
                    <td>{u.team?.name || '—'}</td>
                    <td>
                      {u.isActive
                        ? <span className="badge badge-active">Active</span>
                        : <span className="badge badge-inactive">Inactive</span>
                      }
                    </td>
                    <td style={{ fontSize: 'var(--text-xs)' }}>{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td>
                      <button
                        className={`btn btn-sm ${u.isActive ? 'btn-outline' : 'btn-success'}`}
                        onClick={() => toggleActive(u)}
                      >
                        {u.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
