import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { useToast } from '../components/Toast';
import { useDebounce } from '../hooks/useDebounce';

interface Incident {
  id: string;
  number: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  impact: string;
  urgency: string;
  category: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  slaBreached: boolean;
  assignedTo?: { id: string; firstName: string; lastName: string } | null;
  reportedBy?: { id: string; firstName: string; lastName: string } | null;
  team?: { id: string; name: string } | null;
}

const STATUSES = ['NEW', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CLOSED', 'CANCELLED'];
const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const IMPACTS = ['HIGH', 'MEDIUM', 'LOW'];
const URGENCIES = ['HIGH', 'MEDIUM', 'LOW'];

export function IncidentsPage() {
  const { toast } = useToast();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState<Incident | null>(null);
  const [showEdit, setShowEdit] = useState<Incident | null>(null);

  function fetchIncidents() {
    const params: Record<string, string> = {};
    if (debouncedSearch) params.search = debouncedSearch;
    if (filterStatus) params.status = filterStatus;
    if (filterPriority) params.priority = filterPriority;
    api.get('/incidents', { params })
      .then(({ data }) => setIncidents(data.data))
      .catch(() => { setIncidents([]); toast('error', 'Failed to load incidents'); })
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchIncidents(); }, [debouncedSearch, filterStatus, filterPriority]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Incidents</h1>
          <p className="page-subtitle">Manage and track IT incidents</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Incident</button>
      </div>

      <div className="filter-bar">
        <input className="form-input search-input" placeholder="Search incidents..." value={search} onChange={e => setSearch(e.target.value)} />
        <select className="form-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <select className="form-select" value={filterPriority} onChange={e => setFilterPriority(e.target.value)}>
          <option value="">All Priorities</option>
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div className="card">
        {loading ? (
          <div className="loading-spinner">Loading incidents...</div>
        ) : incidents.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">⚡</div>
            <div className="empty-state-text">No incidents found</div>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>Create First Incident</button>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Title</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Assigned To</th>
                  <th>SLA</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map(inc => (
                  <tr key={inc.id} className="clickable" onClick={() => setShowDetail(inc)}>
                    <td className="td-primary">{inc.number}</td>
                    <td>{inc.title}</td>
                    <td><span className={`badge badge-${inc.priority.toLowerCase()}`}>{inc.priority}</span></td>
                    <td><span className={`badge badge-${inc.status.toLowerCase()}`}>{inc.status.replace('_', ' ')}</span></td>
                    <td>{inc.assignedTo ? `${inc.assignedTo.firstName} ${inc.assignedTo.lastName}` : '—'}</td>
                    <td>{inc.slaBreached ? <span className="badge badge-critical">Breached</span> : <span className="badge badge-low">OK</span>}</td>
                    <td style={{ fontSize: 'var(--text-xs)' }}>{new Date(inc.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreate && <IncidentFormModal onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); fetchIncidents(); }} />}
      {showDetail && <IncidentDetailModal incident={showDetail} onClose={() => setShowDetail(null)} onEdit={() => { setShowEdit(showDetail); setShowDetail(null); }} onRefresh={fetchIncidents} />}
      {showEdit && <IncidentFormModal incident={showEdit} onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); fetchIncidents(); }} />}
    </div>
  );
}

function IncidentFormModal({ incident, onClose, onSaved }: { incident?: Incident; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    title: incident?.title || '',
    description: incident?.description || '',
    priority: incident?.priority || 'MEDIUM',
    impact: incident?.impact || 'MEDIUM',
    urgency: incident?.urgency || 'MEDIUM',
    category: incident?.category || '',
    status: incident?.status || 'NEW',
  });
  const [saving, setSaving] = useState(false);

  function set(field: string, value: string) { setForm(f => ({ ...f, [field]: value })); }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (incident) {
        await api.patch(`/incidents/${incident.id}`, form);
      } else {
        await api.post('/incidents', form);
      }
      onSaved();
    } catch {
      toast('error', 'Failed to save incident');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{incident ? 'Edit Incident' : 'New Incident'}</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Title *</label>
              <input className="form-input" value={form.title} onChange={e => set('title', e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Description *</label>
              <textarea className="form-textarea" value={form.description} onChange={e => set('description', e.target.value)} required />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Priority</label>
                <select className="form-select" value={form.priority} onChange={e => set('priority', e.target.value)}>
                  {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              {incident && (
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <select className="form-select" value={form.status} onChange={e => set('status', e.target.value)}>
                    {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Impact</label>
                <select className="form-select" value={form.impact} onChange={e => set('impact', e.target.value)}>
                  {IMPACTS.map(i => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Urgency</label>
                <select className="form-select" value={form.urgency} onChange={e => set('urgency', e.target.value)}>
                  {URGENCIES.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Category</label>
              <input className="form-input" value={form.category} onChange={e => set('category', e.target.value)} placeholder="e.g. Network, Email, Hardware" />
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : incident ? 'Update' : 'Create'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function IncidentDetailModal({ incident, onClose, onEdit, onRefresh }: { incident: Incident; onClose: () => void; onEdit: () => void; onRefresh: () => void }) {
  const { toast } = useToast();
  const [comments, setComments] = useState<Array<{ id: string; content: string; createdAt: string; author: { firstName: string; lastName: string } }>>([]);
  const [newComment, setNewComment] = useState('');

  useEffect(() => {
    api.get(`/admin/comments?incidentId=${incident.id}`).then(({ data }) => setComments(data.data || [])).catch(() => {});
  }, [incident.id]);

  async function addComment(e: FormEvent) {
    e.preventDefault();
    if (!newComment.trim()) return;
    try {
      await api.post('/admin/comments', { content: newComment, incidentId: incident.id });
      setNewComment('');
      api.get(`/admin/comments?incidentId=${incident.id}`).then(({ data }) => setComments(data.data || [])).catch(() => {});
    } catch { toast('error', 'Failed to add comment'); }
  }

  async function updateStatus(status: string) {
    try {
      await api.patch(`/incidents/${incident.id}`, { status });
      toast('success', `Incident ${status.toLowerCase().replace('_', ' ')}`);
      onRefresh();
      onClose();
    } catch { toast('error', 'Failed to update status'); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{incident.number}</h2>
            <p className="text-sm text-muted">{incident.title}</p>
          </div>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="detail-grid">
            <div><div className="detail-label">Status</div><div className="detail-value"><span className={`badge badge-${incident.status.toLowerCase()}`}>{incident.status.replace('_', ' ')}</span></div></div>
            <div><div className="detail-label">Priority</div><div className="detail-value"><span className={`badge badge-${incident.priority.toLowerCase()}`}>{incident.priority}</span></div></div>
            <div><div className="detail-label">Impact</div><div className="detail-value">{incident.impact}</div></div>
            <div><div className="detail-label">Urgency</div><div className="detail-value">{incident.urgency}</div></div>
            <div><div className="detail-label">Category</div><div className="detail-value">{incident.category || '—'}</div></div>
            <div><div className="detail-label">SLA</div><div className="detail-value">{incident.slaBreached ? <span className="badge badge-critical">Breached</span> : <span className="badge badge-low">Within SLA</span>}</div></div>
            <div><div className="detail-label">Assigned To</div><div className="detail-value">{incident.assignedTo ? `${incident.assignedTo.firstName} ${incident.assignedTo.lastName}` : 'Unassigned'}</div></div>
            <div><div className="detail-label">Reported By</div><div className="detail-value">{incident.reportedBy ? `${incident.reportedBy.firstName} ${incident.reportedBy.lastName}` : '—'}</div></div>
            <div><div className="detail-label">Created</div><div className="detail-value">{new Date(incident.createdAt).toLocaleString()}</div></div>
            <div><div className="detail-label">Resolved</div><div className="detail-value">{incident.resolvedAt ? new Date(incident.resolvedAt).toLocaleString() : '—'}</div></div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div className="detail-label">Description</div>
            <div className="detail-value" style={{ whiteSpace: 'pre-wrap' }}>{incident.description}</div>
          </div>

          <div className="btn-group" style={{ marginTop: 20 }}>
            <button className="btn btn-outline" onClick={onEdit}>Edit</button>
            {incident.status === 'NEW' && <button className="btn btn-accent" onClick={() => updateStatus('IN_PROGRESS')}>Start Working</button>}
            {incident.status === 'IN_PROGRESS' && <button className="btn btn-success" onClick={() => updateStatus('RESOLVED')}>Resolve</button>}
            {incident.status === 'IN_PROGRESS' && <button className="btn btn-outline" onClick={() => updateStatus('ON_HOLD')}>Put On Hold</button>}
            {incident.status === 'ON_HOLD' && <button className="btn btn-accent" onClick={() => updateStatus('IN_PROGRESS')}>Resume</button>}
            {incident.status === 'RESOLVED' && <button className="btn btn-outline" onClick={() => updateStatus('CLOSED')}>Close</button>}
          </div>

          <div style={{ marginTop: 24 }}>
            <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, marginBottom: 12 }}>Comments</h3>
            <div className="comment-list">
              {comments.map(c => (
                <div key={c.id} className="comment-item">
                  <div className="comment-header">
                    <span className="comment-author">{c.author.firstName} {c.author.lastName}</span>
                    <span className="comment-date">{new Date(c.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="comment-body">{c.content}</div>
                </div>
              ))}
              {comments.length === 0 && <p className="text-sm text-muted">No comments yet.</p>}
            </div>
            <form onSubmit={addComment} style={{ marginTop: 12 }}>
              <textarea className="form-textarea" value={newComment} onChange={e => setNewComment(e.target.value)} placeholder="Add a comment..." style={{ minHeight: 60 }} />
              <div style={{ marginTop: 8, textAlign: 'right' }}>
                <button type="submit" className="btn btn-sm btn-primary" disabled={!newComment.trim()}>Add Comment</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
