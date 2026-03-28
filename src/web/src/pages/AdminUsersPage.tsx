import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../components/Toast';
import { useDebounce } from '../hooks/useDebounce';
import { Pagination } from '../components/Pagination';
import { useConfirm } from '../components/ConfirmDialog';
import { SkeletonTable } from '../components/Skeleton';
import { exportToCsv } from '../utils/exportCsv';

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
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [filterRole, setFilterRole] = useState('');
  const [editUser, setEditUser] = useState<User | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(20);

  function fetchData() {
    const params: Record<string, string> = {};
    if (debouncedSearch) params.search = debouncedSearch;
    if (filterRole) params.role = filterRole;
    params.page = String(page);
    params.limit = String(limit);
    api.get('/admin/users', { params })
      .then(({ data }) => { setUsers(data.data); setTotalPages(data.pagination?.totalPages || 1); setTotal(data.pagination?.total || 0); })
      .catch(() => { setUsers([]); toast('error', 'Failed to load users'); })
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchData(); }, [debouncedSearch, filterRole, page, limit]);
  useEffect(() => { setPage(1); }, [debouncedSearch, filterRole]);

  async function toggleActive(user: User) {
    if (user.isActive) {
      const ok = await confirm({
        title: 'Deactivate User',
        message: `Are you sure you want to deactivate ${user.firstName} ${user.lastName}? They will lose access to the system.`,
        confirmText: 'Deactivate',
        variant: 'danger',
      });
      if (!ok) return;
    }
    try {
      await api.patch(`/admin/users/${user.id}`, { isActive: !user.isActive });
      toast('success', `User ${!user.isActive ? 'activated' : 'deactivated'}`);
      fetchData();
    } catch { toast('error', 'Failed to update user'); }
  }

  async function changeRole(user: User, role: string) {
    try {
      await api.patch(`/admin/users/${user.id}`, { role });
      toast('success', `Role updated to ${role.replace('_', ' ')}`);
      fetchData();
    } catch { toast('error', 'Failed to change role'); }
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
        <button className="btn btn-outline btn-export" onClick={() => exportToCsv('users', ['Name','Email','Role','Team','Status','Joined'], users.map(u => [`${u.firstName} ${u.lastName}`, u.email, u.role, u.team?.name || '', u.isActive ? 'Active' : 'Inactive', new Date(u.createdAt).toLocaleDateString()]))}>Export CSV</button>
      </div>

      <div className="card">
        {loading ? (
          <SkeletonTable rows={6} cols={7} />
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
            <Pagination page={page} totalPages={totalPages} total={total} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
          </div>
        )}
      </div>
    </div>
  );
}

