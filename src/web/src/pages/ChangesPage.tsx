import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { useToast } from '../components/Toast';
import { useDebounce } from '../hooks/useDebounce';
import { Pagination } from '../components/Pagination';

interface ChangeRequest {
  id: string;
  number: string;
  title: string;
  description: string;
  justification: string | null;
  status: string;
  type: string;
  priority: string;
  risk: string;
  impact: string;
  implementationPlan: string | null;
  rollbackPlan: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  createdAt: string;
  approvedAt: string | null;
  closedAt: string | null;
  requester?: { id: string; firstName: string; lastName: string } | null;
  assignedTo?: { id: string; firstName: string; lastName: string } | null;
}

const STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SCHEDULED', 'IMPLEMENTING', 'COMPLETED', 'FAILED', 'CANCELLED'];
const TYPES = ['STANDARD', 'NORMAL', 'EMERGENCY'];
const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const RISKS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const IMPACTS = ['HIGH', 'MEDIUM', 'LOW'];

export function ChangesPage() {
  const { toast } = useToast();
  const [changes, setChanges] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState<ChangeRequest | null>(null);
  const [showEdit, setShowEdit] = useState<ChangeRequest | null>(null);

  function fetchChanges() {
    const params: Record<string, string> = {};
    if (debouncedSearch) params.search = debouncedSearch;
    if (filterStatus) params.status = filterStatus;
    if (filterType) params.type = filterType;
    params.page = String(page);
    params.limit = '20';
    api.get('/changes', { params })
      .then(({ data }) => { setChanges(data.data); setTotalPages(data.pagination?.totalPages || 1); })
      .catch(() => { setChanges([]); toast('error', 'Failed to load change requests'); })
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchChanges(); }, [debouncedSearch, filterStatus, filterType, page]);
  useEffect(() => { setPage(1); }, [debouncedSearch, filterStatus, filterType]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Change Management</h1>
          <p className="page-subtitle">Manage requests for change (RFC)</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Change Request</button>
      </div>

      <div className="filter-bar">
        <input className="form-input search-input" placeholder="Search changes..." value={search} onChange={e => setSearch(e.target.value)} />
        <select className="form-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <select className="form-select" value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">All Types</option>
          {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div className="card">
        {loading ? (
          <div className="loading-spinner">Loading changes...</div>
        ) : changes.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">△</div>
            <div className="empty-state-text">No change requests found</div>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>Create First Change</button>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Title</th>
                  <th>Type</th>
                  <th>Priority</th>
                  <th>Risk</th>
                  <th>Status</th>
                  <th>Requester</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {changes.map(chg => (
                  <tr key={chg.id} className="clickable" onClick={() => setShowDetail(chg)}>
                    <td className="td-primary">{chg.number}</td>
                    <td>{chg.title}</td>
                    <td><span className={`badge badge-${chg.type.toLowerCase()}`}>{chg.type}</span></td>
                    <td><span className={`badge badge-${chg.priority.toLowerCase()}`}>{chg.priority}</span></td>
                    <td><span className={`badge badge-${chg.risk.toLowerCase()}`}>{chg.risk}</span></td>
                    <td><span className={`badge badge-${chg.status.toLowerCase()}`}>{chg.status.replace(/_/g, ' ')}</span></td>
                    <td>{chg.requester ? `${chg.requester.firstName} ${chg.requester.lastName}` : '—'}</td>
                    <td style={{ fontSize: 'var(--text-xs)' }}>{new Date(chg.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        )}
      </div>

      {showCreate && <ChangeFormModal onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); fetchChanges(); }} />}
      {showDetail && <ChangeDetailModal change={showDetail} onClose={() => setShowDetail(null)} onEdit={() => { setShowEdit(showDetail); setShowDetail(null); }} onRefresh={fetchChanges} />}
      {showEdit && <ChangeFormModal change={showEdit} onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); fetchChanges(); }} />}
    </div>
  );
}

function ChangeFormModal({ change, onClose, onSaved }: { change?: ChangeRequest; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    title: change?.title || '',
    description: change?.description || '',
    justification: change?.justification || '',
    type: change?.type || 'NORMAL',
    priority: change?.priority || 'MEDIUM',
    risk: change?.risk || 'MEDIUM',
    impact: change?.impact || 'MEDIUM',
    implementationPlan: change?.implementationPlan || '',
    rollbackPlan: change?.rollbackPlan || '',
    scheduledStart: change?.scheduledStart?.slice(0, 16) || '',
    scheduledEnd: change?.scheduledEnd?.slice(0, 16) || '',
    status: change?.status || 'DRAFT',
  });
  const [saving, setSaving] = useState(false);

  function set(field: string, value: string) { setForm(f => ({ ...f, [field]: value })); }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { ...form };
      if (!payload.justification) delete payload.justification;
      if (!payload.implementationPlan) delete payload.implementationPlan;
      if (!payload.rollbackPlan) delete payload.rollbackPlan;
      if (!payload.scheduledStart) delete payload.scheduledStart;
      if (!payload.scheduledEnd) delete payload.scheduledEnd;
      if (!change) delete payload.status;

      if (change) {
        await api.patch(`/changes/${change.id}`, payload);
      } else {
        await api.post('/changes', payload);
      }
      onSaved();
    } catch {
      toast('error', 'Failed to save change request');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{change ? 'Edit Change Request' : 'New Change Request'}</h2>
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
            <div className="form-group">
              <label className="form-label">Business Justification</label>
              <textarea className="form-textarea" value={form.justification} onChange={e => set('justification', e.target.value)} placeholder="Why is this change needed?" />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Type</label>
                <select className="form-select" value={form.type} onChange={e => set('type', e.target.value)}>
                  {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Priority</label>
                <select className="form-select" value={form.priority} onChange={e => set('priority', e.target.value)}>
                  {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              {change && (
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <select className="form-select" value={form.status} onChange={e => set('status', e.target.value)}>
                    {STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Risk Level</label>
                <select className="form-select" value={form.risk} onChange={e => set('risk', e.target.value)}>
                  {RISKS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Impact</label>
                <select className="form-select" value={form.impact} onChange={e => set('impact', e.target.value)}>
                  {IMPACTS.map(i => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Implementation Plan</label>
              <textarea className="form-textarea" value={form.implementationPlan} onChange={e => set('implementationPlan', e.target.value)} placeholder="Steps to implement this change..." />
            </div>
            <div className="form-group">
              <label className="form-label">Rollback Plan</label>
              <textarea className="form-textarea" value={form.rollbackPlan} onChange={e => set('rollbackPlan', e.target.value)} placeholder="Steps to revert if the change fails..." />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Scheduled Start</label>
                <input className="form-input" type="datetime-local" value={form.scheduledStart} onChange={e => set('scheduledStart', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Scheduled End</label>
                <input className="form-input" type="datetime-local" value={form.scheduledEnd} onChange={e => set('scheduledEnd', e.target.value)} />
              </div>
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : change ? 'Update' : 'Create'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function ChangeDetailModal({ change, onClose, onEdit, onRefresh }: { change: ChangeRequest; onClose: () => void; onEdit: () => void; onRefresh: () => void }) {
  const { toast } = useToast();
  const [comments, setComments] = useState<Array<{ id: string; content: string; createdAt: string; author: { firstName: string; lastName: string } }>>([]);
  const [newComment, setNewComment] = useState('');

  useEffect(() => {
    api.get(`/admin/comments?changeRequestId=${change.id}`).then(({ data }) => setComments(data.data || [])).catch(() => {});
  }, [change.id]);

  async function addComment(e: FormEvent) {
    e.preventDefault();
    if (!newComment.trim()) return;
    try {
      await api.post('/admin/comments', { content: newComment, changeRequestId: change.id });
      setNewComment('');
      api.get(`/admin/comments?changeRequestId=${change.id}`).then(({ data }) => setComments(data.data || [])).catch(() => {});
    } catch { toast('error', 'Failed to add comment'); }
  }

  async function updateStatus(status: string) {
    try {
      await api.patch(`/changes/${change.id}`, { status });
      toast('success', `Change request ${status.toLowerCase().replace(/_/g, ' ')}`);
      onRefresh();
      onClose();
    } catch { toast('error', 'Failed to update status'); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{change.number}</h2>
            <p className="text-sm text-muted">{change.title}</p>
          </div>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="detail-grid">
            <div><div className="detail-label">Status</div><div className="detail-value"><span className={`badge badge-${change.status.toLowerCase()}`}>{change.status.replace(/_/g, ' ')}</span></div></div>
            <div><div className="detail-label">Type</div><div className="detail-value"><span className={`badge badge-${change.type.toLowerCase()}`}>{change.type}</span></div></div>
            <div><div className="detail-label">Priority</div><div className="detail-value"><span className={`badge badge-${change.priority.toLowerCase()}`}>{change.priority}</span></div></div>
            <div><div className="detail-label">Risk</div><div className="detail-value"><span className={`badge badge-${change.risk.toLowerCase()}`}>{change.risk}</span></div></div>
            <div><div className="detail-label">Impact</div><div className="detail-value">{change.impact}</div></div>
            <div><div className="detail-label">Requester</div><div className="detail-value">{change.requester ? `${change.requester.firstName} ${change.requester.lastName}` : '—'}</div></div>
            <div><div className="detail-label">Assigned To</div><div className="detail-value">{change.assignedTo ? `${change.assignedTo.firstName} ${change.assignedTo.lastName}` : 'Unassigned'}</div></div>
            <div><div className="detail-label">Created</div><div className="detail-value">{new Date(change.createdAt).toLocaleString()}</div></div>
            {change.scheduledStart && <div><div className="detail-label">Scheduled Start</div><div className="detail-value">{new Date(change.scheduledStart).toLocaleString()}</div></div>}
            {change.scheduledEnd && <div><div className="detail-label">Scheduled End</div><div className="detail-value">{new Date(change.scheduledEnd).toLocaleString()}</div></div>}
          </div>

          <div style={{ marginTop: 16 }}>
            <div className="detail-label">Description</div>
            <div className="detail-value" style={{ whiteSpace: 'pre-wrap' }}>{change.description}</div>
          </div>

          {change.justification && (
            <div style={{ marginTop: 16 }}>
              <div className="detail-label">Business Justification</div>
              <div className="detail-value" style={{ whiteSpace: 'pre-wrap' }}>{change.justification}</div>
            </div>
          )}

          {change.implementationPlan && (
            <div style={{ marginTop: 16 }}>
              <div className="detail-label">Implementation Plan</div>
              <div className="detail-value" style={{ whiteSpace: 'pre-wrap' }}>{change.implementationPlan}</div>
            </div>
          )}

          {change.rollbackPlan && (
            <div style={{ marginTop: 16 }}>
              <div className="detail-label">Rollback Plan</div>
              <div className="detail-value" style={{ whiteSpace: 'pre-wrap' }}>{change.rollbackPlan}</div>
            </div>
          )}

          <div className="btn-group" style={{ marginTop: 20 }}>
            <button className="btn btn-outline" onClick={onEdit}>Edit</button>
            {change.status === 'DRAFT' && <button className="btn btn-accent" onClick={() => updateStatus('SUBMITTED')}>Submit for Review</button>}
            {change.status === 'SUBMITTED' && <button className="btn btn-accent" onClick={() => updateStatus('UNDER_REVIEW')}>Start Review</button>}
            {change.status === 'UNDER_REVIEW' && <button className="btn btn-success" onClick={() => updateStatus('APPROVED')}>Approve</button>}
            {change.status === 'UNDER_REVIEW' && <button className="btn btn-danger" onClick={() => updateStatus('REJECTED')}>Reject</button>}
            {change.status === 'APPROVED' && <button className="btn btn-accent" onClick={() => updateStatus('SCHEDULED')}>Schedule</button>}
            {change.status === 'SCHEDULED' && <button className="btn btn-accent" onClick={() => updateStatus('IMPLEMENTING')}>Start Implementation</button>}
            {change.status === 'IMPLEMENTING' && <button className="btn btn-success" onClick={() => updateStatus('COMPLETED')}>Complete</button>}
            {change.status === 'IMPLEMENTING' && <button className="btn btn-danger" onClick={() => updateStatus('FAILED')}>Mark Failed</button>}
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
