import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { useToast } from '../components/Toast';
import { useDebounce } from '../hooks/useDebounce';
import { Pagination } from '../components/Pagination';
import { SkeletonTable } from '../components/Skeleton';
import { exportToCsv } from '../utils/exportCsv';
import { useConfirm } from '../components/ConfirmDialog';

interface ProblemRecord {
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
  isKnownError: boolean;
  createdAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  createdBy?: { firstName: string; lastName: string } | null;
  assignedTo?: { firstName: string; lastName: string } | null;
  assignedTeam?: { name: string } | null;
  comments?: Array<{ id: string; content: string; isPublic: boolean; createdAt: string; author: { firstName: string; lastName: string } }>;
  incidents?: Array<{ id: string; number: string; title: string; status: string }>;
  _count?: { incidents: number };
}

const STATUSES = ['NEW', 'INVESTIGATING', 'ROOT_CAUSE_IDENTIFIED', 'KNOWN_ERROR', 'RESOLVED', 'CLOSED'];
const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

export function ProblemsPage() {
  const { toast } = useToast();
  const [items, setItems] = useState<ProblemRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(20);
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState<ProblemRecord | null>(null);

  function fetchData() {
    const params: Record<string, string> = {};
    if (debouncedSearch) params.search = debouncedSearch;
    if (filterStatus) params.status = filterStatus;
    if (filterPriority) params.priority = filterPriority;
    params.page = String(page);
    params.limit = String(limit);
    api.get('/problems', { params })
      .then(({ data }) => { setItems(data.data); setTotalPages(data.pagination?.totalPages || 1); setTotal(data.pagination?.total || 0); })
      .catch(() => { setItems([]); toast('error', 'Failed to load problems'); })
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchData(); }, [debouncedSearch, filterStatus, filterPriority, page, limit]);
  useEffect(() => { setPage(1); }, [debouncedSearch, filterStatus, filterPriority]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Problem Management</h1>
          <p className="page-subtitle">Identify root causes and eliminate recurring incidents</p>
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
        <button className="btn btn-outline btn-export" onClick={() => exportToCsv('problems', ['Number','Title','Status','Priority','Known Error','Incidents','Created'], items.map(p => [p.number, p.title, p.status, p.priority, p.isKnownError ? 'Yes' : 'No', String(p._count?.incidents ?? 0), new Date(p.createdAt).toLocaleDateString()]))}>Export CSV</button>
      </div>

      <div className="card">
        {loading ? (
          <SkeletonTable rows={6} cols={7} />
        ) : items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🔍</div>
            <div className="empty-state-text">No problem records found</div>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>Create First Problem</button>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Known Error</th>
                  <th>Incidents</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {items.map(p => (
                  <tr key={p.id} className="clickable" onClick={() => {
                    api.get(`/problems/${p.id}`).then(({ data }) => setShowDetail(data.data)).catch(() => toast('error', 'Failed to load details'));
                  }}>
                    <td className="td-primary">{p.number}</td>
                    <td>{p.title}</td>
                    <td><span className={`badge badge-${p.status.toLowerCase().replace(/_/g, '-')}`}>{p.status.replace(/_/g, ' ')}</span></td>
                    <td><span className={`badge badge-${p.priority.toLowerCase()}`}>{p.priority}</span></td>
                    <td>{p.isKnownError ? <span className="badge badge-known-error">KE</span> : '—'}</td>
                    <td>{p._count?.incidents ?? 0}</td>
                    <td style={{ fontSize: 'var(--text-xs)' }}>{new Date(p.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} totalPages={totalPages} total={total} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
          </div>
        )}
      </div>

      {showCreate && <ProblemFormModal onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); fetchData(); }} />}
      {showDetail && <ProblemDetailModal problem={showDetail} onClose={() => setShowDetail(null)} onRefresh={fetchData} />}
    </div>
  );
}

function ProblemFormModal({ problem, onClose, onSaved }: { problem?: ProblemRecord; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    title: problem?.title || '',
    description: problem?.description || '',
    priority: problem?.priority || 'MEDIUM',
    impact: problem?.impact || 'MEDIUM',
    category: problem?.category || '',
  });
  const [saving, setSaving] = useState(false);

  function set(field: string, value: string) { setForm(f => ({ ...f, [field]: value })); }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        title: form.title,
        description: form.description,
        priority: form.priority,
        impact: form.impact,
      };
      if (form.category) payload.category = form.category;
      if (problem) {
        await api.patch(`/problems/${problem.id}`, payload);
      } else {
        await api.post('/problems', payload);
      }
      toast('success', problem ? 'Problem updated' : 'Problem created');
      onSaved();
    } catch {
      toast('error', 'Failed to save problem');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-md" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{problem ? 'Edit Problem' : 'New Problem Record'}</h2>
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
                  {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Category</label>
              <input className="form-input" value={form.category} onChange={e => set('category', e.target.value)} placeholder="e.g. Network, Database, Application" />
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : problem ? 'Update' : 'Create Problem'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function ProblemDetailModal({ problem, onClose, onRefresh }: { problem: ProblemRecord; onClose: () => void; onRefresh: () => void }) {
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const [comment, setComment] = useState('');
  const [rootCause, setRootCause] = useState(problem.rootCause || '');
  const [workaround, setWorkaround] = useState(problem.workaround || '');

  async function updateStatus(status: string) {
    try {
      await api.patch(`/problems/${problem.id}`, { status });
      toast('success', `Problem status updated`);
      onRefresh(); onClose();
    } catch { toast('error', 'Failed to update problem'); }
  }

  async function saveRootCause() {
    try {
      const payload: Record<string, unknown> = {};
      if (rootCause !== (problem.rootCause || '')) payload.rootCause = rootCause;
      if (workaround !== (problem.workaround || '')) payload.workaround = workaround;
      if (Object.keys(payload).length === 0) return;
      await api.patch(`/problems/${problem.id}`, payload);
      toast('success', 'Problem updated');
      onRefresh(); onClose();
    } catch { toast('error', 'Update failed'); }
  }

  async function toggleKnownError() {
    const newVal = !problem.isKnownError;
    const ok = newVal
      ? await confirm({ title: 'Mark as Known Error', message: `Mark ${problem.number} as a Known Error?`, confirmText: 'Yes, mark it' })
      : true;
    if (!ok) return;
    try {
      await api.patch(`/problems/${problem.id}`, { isKnownError: newVal, status: newVal ? 'KNOWN_ERROR' : 'INVESTIGATING' });
      toast('success', newVal ? 'Marked as Known Error' : 'Known Error flag removed');
      onRefresh(); onClose();
    } catch { toast('error', 'Update failed'); }
  }

  async function addComment() {
    if (!comment.trim()) return;
    try {
      await api.post('/admin/comments', { content: comment, problemId: problem.id });
      toast('success', 'Comment added');
      setComment('');
      onRefresh(); onClose();
    } catch { toast('error', 'Failed to add comment'); }
  }

  async function unlinkIncident(incidentId: string) {
    try {
      await api.post(`/problems/${problem.id}/unlink-incident`, { incidentId });
      toast('success', 'Incident unlinked');
      onRefresh(); onClose();
    } catch { toast('error', 'Failed to unlink'); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{problem.number} {problem.isKnownError && <span className="badge badge-known-error" style={{ marginLeft: 8 }}>Known Error</span>}</h2>
            <p className="text-sm text-muted">{problem.title}</p>
          </div>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="detail-grid">
            <div><div className="detail-label">Status</div><div className="detail-value"><span className={`badge badge-${problem.status.toLowerCase().replace(/_/g, '-')}`}>{problem.status.replace(/_/g, ' ')}</span></div></div>
            <div><div className="detail-label">Priority</div><div className="detail-value"><span className={`badge badge-${problem.priority.toLowerCase()}`}>{problem.priority}</span></div></div>
            <div><div className="detail-label">Created By</div><div className="detail-value">{problem.createdBy ? `${problem.createdBy.firstName} ${problem.createdBy.lastName}` : '—'}</div></div>
            <div><div className="detail-label">Assigned To</div><div className="detail-value">{problem.assignedTo ? `${problem.assignedTo.firstName} ${problem.assignedTo.lastName}` : 'Unassigned'}</div></div>
            <div><div className="detail-label">Created</div><div className="detail-value">{new Date(problem.createdAt).toLocaleString()}</div></div>
            <div><div className="detail-label">Resolved</div><div className="detail-value">{problem.resolvedAt ? new Date(problem.resolvedAt).toLocaleString() : '—'}</div></div>
          </div>

          <div style={{ marginTop: 16 }}><div className="detail-label">Description</div><div className="detail-value" style={{ whiteSpace: 'pre-wrap' }}>{problem.description}</div></div>

          {/* Root Cause & Workaround fields */}
          <div style={{ marginTop: 16 }}>
            <div className="form-group">
              <label className="form-label">Root Cause Analysis</label>
              <textarea className="form-textarea" value={rootCause} onChange={e => setRootCause(e.target.value)} placeholder="Document the root cause..." style={{ minHeight: 60 }} />
            </div>
            <div className="form-group">
              <label className="form-label">Workaround</label>
              <textarea className="form-textarea" value={workaround} onChange={e => setWorkaround(e.target.value)} placeholder="Temporary workaround if available..." style={{ minHeight: 60 }} />
            </div>
            {(rootCause !== (problem.rootCause || '') || workaround !== (problem.workaround || '')) && (
              <button className="btn btn-accent" onClick={saveRootCause} style={{ marginTop: 4 }}>Save Analysis</button>
            )}
          </div>

          {/* Related Incidents */}
          {problem.incidents && problem.incidents.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, marginBottom: 8 }}>Related Incidents ({problem.incidents.length})</h3>
              {problem.incidents.map(inc => (
                <div key={inc.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                  <span className="td-primary">{inc.number}</span>
                  <span>{inc.title}</span>
                  <span className={`badge badge-${inc.status.toLowerCase()}`}>{inc.status}</span>
                  <button className="btn btn-sm btn-outline" style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 8px' }} onClick={() => unlinkIncident(inc.id)}>Unlink</button>
                </div>
              ))}
            </div>
          )}

          {/* Comments */}
          {problem.comments && problem.comments.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, marginBottom: 8 }}>Activity</h3>
              {problem.comments.map(c => (
                <div key={c.id} className="comment-item">
                  <div className="comment-header">
                    <span style={{ fontWeight: 500 }}>{c.author.firstName} {c.author.lastName}</span>
                    {!c.isPublic && <span className="badge badge-info" style={{ fontSize: '10px' }}>Internal</span>}
                    <span className="text-xs text-muted">{new Date(c.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="comment-body">{c.content}</div>
                </div>
              ))}
            </div>
          )}

          {/* Add Comment */}
          <div style={{ marginTop: 16 }}>
            <div className="form-group">
              <div style={{ display: 'flex', gap: 8 }}>
                <textarea className="form-textarea" value={comment} onChange={e => setComment(e.target.value)} placeholder="Add a work note..." style={{ minHeight: 40, flex: 1 }} />
                <button className="btn btn-outline" onClick={addComment} disabled={!comment.trim()}>Post</button>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="btn-group" style={{ marginTop: 20 }}>
            {problem.status === 'NEW' && <button className="btn btn-primary" onClick={() => updateStatus('INVESTIGATING')}>Start Investigation</button>}
            {problem.status === 'INVESTIGATING' && (
              <>
                <button className="btn btn-accent" onClick={() => updateStatus('ROOT_CAUSE_IDENTIFIED')}>Root Cause Found</button>
                <button className="btn btn-warning" onClick={toggleKnownError}>{problem.isKnownError ? 'Remove KE Flag' : 'Mark Known Error'}</button>
              </>
            )}
            {problem.status === 'ROOT_CAUSE_IDENTIFIED' && (
              <>
                <button className="btn btn-success" onClick={() => updateStatus('RESOLVED')}>Resolve</button>
                <button className="btn btn-warning" onClick={toggleKnownError}>{problem.isKnownError ? 'Remove KE Flag' : 'Mark Known Error'}</button>
              </>
            )}
            {problem.status === 'KNOWN_ERROR' && <button className="btn btn-success" onClick={() => updateStatus('RESOLVED')}>Resolve</button>}
            {problem.status === 'RESOLVED' && <button className="btn btn-outline" onClick={() => updateStatus('CLOSED')}>Close</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
