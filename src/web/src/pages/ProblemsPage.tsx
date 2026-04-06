import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { useToast } from '../components/Toast';
import { useDebounce } from '../hooks/useDebounce';
import { Pagination } from '../components/Pagination';

interface Problem {
  id: string;
  number: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  impact: string;
  category: string | null;
  rootCause: string | null;
  workaround: string | null;
  knownError: boolean;
  createdAt: string;
  resolvedAt: string | null;
  assignedTo?: { id: string; firstName: string; lastName: string } | null;
  createdBy?: { id: string; firstName: string; lastName: string } | null;
  relatedIncidents?: Array<{ id: string; number: string; title: string; status: string }>;
  _count?: { relatedIncidents: number };
}

const STATUSES = ['OPEN', 'INVESTIGATING', 'ROOT_CAUSE_IDENTIFIED', 'KNOWN_ERROR', 'RESOLVED', 'CLOSED'];
const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const IMPACTS = ['HIGH', 'MEDIUM', 'LOW'];

export function ProblemsPage() {
  const { toast } = useToast();
  const [problems, setProblems] = useState<Problem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState<Problem | null>(null);
  const [showEdit, setShowEdit] = useState<Problem | null>(null);

  function fetchProblems() {
    const params: Record<string, string> = {};
    if (debouncedSearch) params.search = debouncedSearch;
    if (filterStatus) params.status = filterStatus;
    if (filterPriority) params.priority = filterPriority;
    params.page = String(page);
    params.limit = '20';
    api.get('/problems', { params })
      .then(({ data }) => { setProblems(data.data); setTotalPages(data.pagination?.totalPages || 1); })
      .catch(() => { setProblems([]); toast('error', 'Failed to load problems'); })
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchProblems(); }, [debouncedSearch, filterStatus, filterPriority, page]);
  useEffect(() => { setPage(1); }, [debouncedSearch, filterStatus, filterPriority]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Problem Management</h1>
          <p className="page-subtitle">Track root causes and known errors</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Problem</button>
      </div>

      <div className="filter-bar">
        <input className="form-input search-input" placeholder="Search problems..." value={search} onChange={e => setSearch(e.target.value)} />
        <select className="form-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <select className="form-select" value={filterPriority} onChange={e => setFilterPriority(e.target.value)}>
          <option value="">All Priorities</option>
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div className="card">
        {loading ? (
          <div className="loading-spinner">Loading problems...</div>
        ) : problems.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">◈</div>
            <div className="empty-state-text">No problems found</div>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>Create First Problem</button>
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
                  <th>Known Error</th>
                  <th>Incidents</th>
                  <th>Assigned To</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {problems.map(prb => (
                  <tr key={prb.id} className="clickable" onClick={() => setShowDetail(prb)}>
                    <td className="td-primary">{prb.number}</td>
                    <td>{prb.title}</td>
                    <td><span className={`badge badge-${prb.priority.toLowerCase()}`}>{prb.priority}</span></td>
                    <td><span className={`badge badge-${prb.status.toLowerCase()}`}>{prb.status.replace(/_/g, ' ')}</span></td>
                    <td>{prb.knownError ? <span className="badge badge-critical">Yes</span> : <span className="badge badge-low">No</span>}</td>
                    <td>{prb._count?.relatedIncidents ?? 0}</td>
                    <td>{prb.assignedTo ? `${prb.assignedTo.firstName} ${prb.assignedTo.lastName}` : '—'}</td>
                    <td style={{ fontSize: 'var(--text-xs)' }}>{new Date(prb.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        )}
      </div>

      {showCreate && <ProblemFormModal onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); fetchProblems(); }} />}
      {showDetail && <ProblemDetailModal problem={showDetail} onClose={() => setShowDetail(null)} onEdit={() => { setShowEdit(showDetail); setShowDetail(null); }} onRefresh={fetchProblems} />}
      {showEdit && <ProblemFormModal problem={showEdit} onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); fetchProblems(); }} />}
    </div>
  );
}

function ProblemFormModal({ problem, onClose, onSaved }: { problem?: Problem; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    title: problem?.title || '',
    description: problem?.description || '',
    priority: problem?.priority || 'MEDIUM',
    impact: problem?.impact || 'MEDIUM',
    category: problem?.category || '',
    rootCause: problem?.rootCause || '',
    workaround: problem?.workaround || '',
    status: problem?.status || 'OPEN',
  });
  const [saving, setSaving] = useState(false);

  function set(field: string, value: string) { setForm(f => ({ ...f, [field]: value })); }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { ...form };
      if (!payload.category) delete payload.category;
      if (!payload.rootCause) delete payload.rootCause;
      if (!payload.workaround) delete payload.workaround;
      if (!problem) delete payload.status;

      if (problem) {
        await api.patch(`/problems/${problem.id}`, payload);
      } else {
        await api.post('/problems', payload);
      }
      onSaved();
    } catch {
      toast('error', 'Failed to save problem');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{problem ? 'Edit Problem' : 'New Problem'}</h2>
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
              <div className="form-group">
                <label className="form-label">Impact</label>
                <select className="form-select" value={form.impact} onChange={e => set('impact', e.target.value)}>
                  {IMPACTS.map(i => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>
              {problem && (
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <select className="form-select" value={form.status} onChange={e => set('status', e.target.value)}>
                    {STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="form-group">
              <label className="form-label">Category</label>
              <input className="form-input" value={form.category} onChange={e => set('category', e.target.value)} placeholder="e.g. Network, Email, Hardware" />
            </div>
            <div className="form-group">
              <label className="form-label">Root Cause</label>
              <textarea className="form-textarea" value={form.rootCause} onChange={e => set('rootCause', e.target.value)} placeholder="Document the root cause analysis..." />
            </div>
            <div className="form-group">
              <label className="form-label">Workaround</label>
              <textarea className="form-textarea" value={form.workaround} onChange={e => set('workaround', e.target.value)} placeholder="Temporary workaround if available..." />
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : problem ? 'Update' : 'Create'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function ProblemDetailModal({ problem, onClose, onEdit, onRefresh }: { problem: Problem; onClose: () => void; onEdit: () => void; onRefresh: () => void }) {
  const { toast } = useToast();
  const [detail, setDetail] = useState<Problem>(problem);
  const [comments, setComments] = useState<Array<{ id: string; content: string; createdAt: string; author: { firstName: string; lastName: string } }>>([]);
  const [newComment, setNewComment] = useState('');

  useEffect(() => {
    api.get(`/problems/${problem.id}`).then(({ data }) => setDetail(data.data)).catch(() => {});
    api.get(`/admin/comments?problemId=${problem.id}`).then(({ data }) => setComments(data.data || [])).catch(() => {});
  }, [problem.id]);

  async function addComment(e: FormEvent) {
    e.preventDefault();
    if (!newComment.trim()) return;
    try {
      await api.post('/admin/comments', { content: newComment, problemId: problem.id });
      setNewComment('');
      api.get(`/admin/comments?problemId=${problem.id}`).then(({ data }) => setComments(data.data || [])).catch(() => {});
    } catch { toast('error', 'Failed to add comment'); }
  }

  async function updateStatus(status: string) {
    try {
      await api.patch(`/problems/${problem.id}`, { status });
      toast('success', `Problem ${status.toLowerCase().replace(/_/g, ' ')}`);
      onRefresh();
      onClose();
    } catch { toast('error', 'Failed to update status'); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{detail.number}</h2>
            <p className="text-sm text-muted">{detail.title}</p>
          </div>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="detail-grid">
            <div><div className="detail-label">Status</div><div className="detail-value"><span className={`badge badge-${detail.status.toLowerCase()}`}>{detail.status.replace(/_/g, ' ')}</span></div></div>
            <div><div className="detail-label">Priority</div><div className="detail-value"><span className={`badge badge-${detail.priority.toLowerCase()}`}>{detail.priority}</span></div></div>
            <div><div className="detail-label">Impact</div><div className="detail-value">{detail.impact}</div></div>
            <div><div className="detail-label">Category</div><div className="detail-value">{detail.category || '—'}</div></div>
            <div><div className="detail-label">Known Error</div><div className="detail-value">{detail.knownError ? <span className="badge badge-critical">Yes</span> : <span className="badge badge-low">No</span>}</div></div>
            <div><div className="detail-label">Assigned To</div><div className="detail-value">{detail.assignedTo ? `${detail.assignedTo.firstName} ${detail.assignedTo.lastName}` : 'Unassigned'}</div></div>
            <div><div className="detail-label">Created By</div><div className="detail-value">{detail.createdBy ? `${detail.createdBy.firstName} ${detail.createdBy.lastName}` : '—'}</div></div>
            <div><div className="detail-label">Created</div><div className="detail-value">{new Date(detail.createdAt).toLocaleString()}</div></div>
            {detail.resolvedAt && <div><div className="detail-label">Resolved</div><div className="detail-value">{new Date(detail.resolvedAt).toLocaleString()}</div></div>}
          </div>

          <div style={{ marginTop: 16 }}>
            <div className="detail-label">Description</div>
            <div className="detail-value" style={{ whiteSpace: 'pre-wrap' }}>{detail.description}</div>
          </div>

          {detail.rootCause && (
            <div style={{ marginTop: 16 }}>
              <div className="detail-label">Root Cause</div>
              <div className="detail-value" style={{ whiteSpace: 'pre-wrap', background: 'var(--bg-secondary)', padding: 12, borderRadius: 8 }}>{detail.rootCause}</div>
            </div>
          )}

          {detail.workaround && (
            <div style={{ marginTop: 16 }}>
              <div className="detail-label">Workaround</div>
              <div className="detail-value" style={{ whiteSpace: 'pre-wrap', background: 'var(--bg-secondary)', padding: 12, borderRadius: 8 }}>{detail.workaround}</div>
            </div>
          )}

          {detail.relatedIncidents && detail.relatedIncidents.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div className="detail-label">Related Incidents</div>
              <div className="table-container">
                <table className="data-table">
                  <thead><tr><th>Number</th><th>Title</th><th>Status</th></tr></thead>
                  <tbody>
                    {detail.relatedIncidents.map(inc => (
                      <tr key={inc.id}>
                        <td className="td-primary">{inc.number}</td>
                        <td>{inc.title}</td>
                        <td><span className={`badge badge-${inc.status.toLowerCase()}`}>{inc.status.replace(/_/g, ' ')}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="btn-group" style={{ marginTop: 20 }}>
            <button className="btn btn-outline" onClick={onEdit}>Edit</button>
            {detail.status === 'OPEN' && <button className="btn btn-accent" onClick={() => updateStatus('INVESTIGATING')}>Start Investigation</button>}
            {detail.status === 'INVESTIGATING' && <button className="btn btn-accent" onClick={() => updateStatus('ROOT_CAUSE_IDENTIFIED')}>Root Cause Found</button>}
            {detail.status === 'ROOT_CAUSE_IDENTIFIED' && <button className="btn btn-warning" onClick={() => updateStatus('KNOWN_ERROR')}>Mark Known Error</button>}
            {['INVESTIGATING', 'ROOT_CAUSE_IDENTIFIED', 'KNOWN_ERROR'].includes(detail.status) && <button className="btn btn-success" onClick={() => updateStatus('RESOLVED')}>Resolve</button>}
            {detail.status === 'RESOLVED' && <button className="btn btn-outline" onClick={() => updateStatus('CLOSED')}>Close</button>}
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
