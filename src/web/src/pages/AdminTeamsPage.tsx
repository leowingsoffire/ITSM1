import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { useToast } from '../components/Toast';
import { SkeletonCards } from '../components/Skeleton';

interface Team {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  _count?: { members: number };
  members?: Array<{ id: string; firstName: string; lastName: string; role: string }>;
}

export function AdminTeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState<Team | null>(null);
  const [showDetail, setShowDetail] = useState<Team | null>(null);

  function fetchData() {
    api.get('/admin/teams')
      .then(({ data }) => setTeams(data.data))
      .catch(() => setTeams([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchData(); }, []);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Team Management</h1>
          <p className="page-subtitle">Organize agents into support teams</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Team</button>
      </div>

      {loading ? (
        <SkeletonCards count={4} />
      ) : teams.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">⬡</div>
            <div className="empty-state-text">No teams found</div>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>Create First Team</button>
          </div>
        </div>
      ) : (
        <div className="team-grid">
          {teams.map(t => (
            <div key={t.id} className="team-card" onClick={() => setShowDetail(t)}>
              <div className="team-card-body">
                <div className="team-card-info">
                  <h3 className="team-card-name">{t.name}</h3>
                  <p className="text-sm text-muted">{t.description || 'No description'}</p>
                </div>
                <div className="team-card-count">
                  <div className="team-card-number">{t._count?.members ?? 0}</div>
                  <div className="text-xs text-muted">members</div>
                </div>
              </div>
              <div className="team-card-actions">
                <button className="btn btn-sm btn-outline" onClick={e => { e.stopPropagation(); setShowEdit(t); }}>Edit</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && <TeamFormModal onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); fetchData(); }} />}
      {showEdit && <TeamFormModal team={showEdit} onClose={() => setShowEdit(null)} onSaved={() => { setShowEdit(null); fetchData(); }} />}
      {showDetail && <TeamDetailModal team={showDetail} onClose={() => setShowDetail(null)} />}
    </div>
  );
}

function TeamFormModal({ team, onClose, onSaved }: { team?: Team; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(team?.name || '');
  const [description, setDescription] = useState(team?.description || '');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { name, description: description || undefined };
      if (team) {
        await api.patch(`/admin/teams/${team.id}`, payload);
      } else {
        await api.post('/admin/teams', payload);
      }
      onSaved();
    } catch {
      toast('error', 'Failed to save team');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{team ? 'Edit Team' : 'New Team'}</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Team Name *</label>
              <input className="form-input" value={name} onChange={e => setName(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea className="form-textarea" value={description} onChange={e => setDescription(e.target.value)} style={{ minHeight: 80 }} />
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : team ? 'Update' : 'Create Team'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function TeamDetailModal({ team, onClose }: { team: Team; onClose: () => void }) {
  const [members, setMembers] = useState<Array<{ id: string; firstName: string; lastName: string; email: string; role: string }>>([]);

  useEffect(() => {
    api.get(`/admin/teams/${team.id}`).then(({ data }) => {
      setMembers(data.data?.members || []);
    }).catch(() => {});
  }, [team.id]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{team.name}</h2>
            <p className="text-sm text-muted">{team.description || 'No description'}</p>
          </div>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, marginBottom: 12 }}>Team Members ({members.length})</h3>
          {members.length === 0 ? (
            <p className="text-sm text-muted">No members in this team.</p>
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead>
                <tbody>
                  {members.map(m => (
                    <tr key={m.id}>
                      <td>{m.firstName} {m.lastName}</td>
                      <td>{m.email}</td>
                      <td><span className={`badge badge-${m.role.toLowerCase()}`}>{m.role.replace('_', ' ')}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
