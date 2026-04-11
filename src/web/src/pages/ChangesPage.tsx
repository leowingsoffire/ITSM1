import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { useToast } from '../components/Toast';
import { useDebounce } from '../hooks/useDebounce';
import { Pagination } from '../components/Pagination';
import { SkeletonTable } from '../components/Skeleton';
import { exportToCsv } from '../utils/exportCsv';
import { useConfirm } from '../components/ConfirmDialog';

interface ChangeRequest {
  id: string;
  number: string;
  title: string;
  description: string;
  type: string;
  status: string;
  priority: string;
  risk: string;
  impact: string;
  category: string | null;
  reason: string | null;
  implementationPlan: string | null;
  backoutPlan: string | null;
  testPlan: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  createdAt: string;
  closedAt: string | null;
  requester?: { firstName: string; lastName: string } | null;
  assignedTo?: { firstName: string; lastName: string } | null;
  assignedTeam?: { name: string } | null;
  approvals?: Array<{ id: string; status: string; comments?: string | null; decidedAt?: string | null; approver: { firstName: string; lastName: string } }>;
  comments?: Array<{ id: string; content: string; isPublic: boolean; createdAt: string; author: { firstName: string; lastName: string } }>;
  incidents?: Array<{ id: string; number: string; title: string; status: string }>;
  _count?: { approvals: number };
}

const TYPES = ['STANDARD', 'NORMAL', 'EMERGENCY'];
const STATUSES = ['NEW', 'PLANNING', 'AWAITING_APPROVAL', 'APPROVED', 'SCHEDULED', 'IMPLEMENTING', 'COMPLETED', 'FAILED', 'CANCELLED'];
const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const RISKS = ['HIGH', 'MEDIUM', 'LOW'];

export function ChangesPage() {
  const { toast } = useToast();
  const [items, setItems] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(20);
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState<ChangeRequest | null>(null);

  function fetchData() {
    const params: Record<string, string> = {};
    if (debouncedSearch) params.search = debouncedSearch;
    if (filterStatus) params.status = filterStatus;
    if (filterType) params.type = filterType;
    if (filterPriority) params.priority = filterPriority;
    params.page = String(page);
    params.limit = String(limit);
    api.get('/changes', { params })
      .then(({ data }) => { setItems(data.data); setTotalPages(data.pagination?.totalPages || 1); setTotal(data.pagination?.total || 0); })
      .catch(() => { setItems([]); toast('error', 'Failed to load changes'); })
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchData(); }, [debouncedSearch, filterStatus, filterType, filterPriority, page, limit]);
  useEffect(() => { setPage(1); }, [debouncedSearch, filterStatus, filterType, filterPriority]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Change Management</h1>
          <p className="page-subtitle">Plan, approve, and implement changes</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Change</button>
      </div>

      <div className="filter-bar">
        <input className="form-input search-input" placeholder="Search changes..." value={search} onChange={e => setSearch(e.target.value)} />
        <select className="form-select" value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">All Types</option>
          {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="form-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <select className="form-select" value={filterPriority} onChange={e => setFilterPriority(e.target.value)}>
          <option value="">All Priorities</option>
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <button className="btn btn-outline btn-export" onClick={() => exportToCsv('changes', ['Number','Title','Type','Status','Priority','Risk','Requester','Scheduled Start','Created'], items.map(c => [c.number, c.title, c.type, c.status, c.priority, c.risk, c.requester ? `${c.requester.firstName} ${c.requester.lastName}` : '', c.scheduledStart ? new Date(c.scheduledStart).toLocaleDateString() : '', new Date(c.createdAt).toLocaleDateString()]))}>Export CSV</button>
      </div>

      <div className="card">
        {loading ? (
          <SkeletonTable rows={6} cols={8} />
        ) : items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">⟳</div>
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
                  <th>Scheduled</th>
                </tr>
              </thead>
              <tbody>
                {items.map(c => (
                  <tr key={c.id} className="clickable" onClick={() => {
                    api.get(`/changes/${c.id}`).then(({ data }) => setShowDetail(data.data)).catch(() => toast('error', 'Failed to load details'));
                  }}>
                    <td className="td-primary">{c.number}</td>
                    <td>{c.title}</td>
                    <td><span className={`badge badge-${c.type.toLowerCase()}`}>{c.type}</span></td>
                    <td><span className={`badge badge-${c.priority.toLowerCase()}`}>{c.priority}</span></td>
                    <td><span className={`badge badge-${c.risk.toLowerCase()}`}>{c.risk}</span></td>
                    <td><span className={`badge badge-${c.status.toLowerCase().replace(/_/g, '-')}`}>{c.status.replace(/_/g, ' ')}</span></td>
                    <td>{c.requester ? `${c.requester.firstName} ${c.requester.lastName}` : '—'}</td>
                    <td style={{ fontSize: 'var(--text-xs)' }}>{c.scheduledStart ? new Date(c.scheduledStart).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} totalPages={totalPages} total={total} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
          </div>
        )}
      </div>

      {showCreate && <ChangeFormModal onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); fetchData(); }} />}
      {showDetail && <ChangeDetailModal change={showDetail} onClose={() => setShowDetail(null)} onRefresh={fetchData} />}
    </div>
  );
}

function ChangeFormModal({ change, onClose, onSaved }: { change?: ChangeRequest; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    title: change?.title || '',
    description: change?.description || '',
    type: change?.type || 'NORMAL',
    priority: change?.priority || 'MEDIUM',
    risk: change?.risk || 'MEDIUM',
    impact: change?.impact || 'MEDIUM',
    category: change?.category || '',
    reason: change?.reason || '',
    implementationPlan: change?.implementationPlan || '',
    backoutPlan: change?.backoutPlan || '',
    testPlan: change?.testPlan || '',
    scheduledStart: change?.scheduledStart?.slice(0, 16) || '',
    scheduledEnd: change?.scheduledEnd?.slice(0, 16) || '',
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
        type: form.type,
        priority: form.priority,
        risk: form.risk,
        impact: form.impact,
      };
      if (form.category) payload.category = form.category;
      if (form.reason) payload.reason = form.reason;
      if (form.implementationPlan) payload.implementationPlan = form.implementationPlan;
      if (form.backoutPlan) payload.backoutPlan = form.backoutPlan;
      if (form.testPlan) payload.testPlan = form.testPlan;
      if (form.scheduledStart) payload.scheduledStart = new Date(form.scheduledStart).toISOString();
      if (form.scheduledEnd) payload.scheduledEnd = new Date(form.scheduledEnd).toISOString();

      if (change) {
        await api.patch(`/changes/${change.id}`, payload);
      } else {
        await api.post('/changes', payload);
      }
      toast('success', change ? 'Change updated' : 'Change created');
      onSaved();
    } catch {
      toast('error', 'Failed to save change');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{change ? 'Edit Change' : 'New Change Request'}</h2>
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
              <div className="form-group">
                <label className="form-label">Risk</label>
                <select className="form-select" value={form.risk} onChange={e => set('risk', e.target.value)}>
                  {RISKS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Reason for Change</label>
              <textarea className="form-textarea" value={form.reason} onChange={e => set('reason', e.target.value)} placeholder="Business justification for this change" style={{ minHeight: 60 }} />
            </div>
            <div className="form-group">
              <label className="form-label">Implementation Plan</label>
              <textarea className="form-textarea" value={form.implementationPlan} onChange={e => set('implementationPlan', e.target.value)} placeholder="Step-by-step implementation plan" style={{ minHeight: 80 }} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Backout Plan</label>
                <textarea className="form-textarea" value={form.backoutPlan} onChange={e => set('backoutPlan', e.target.value)} placeholder="Rollback steps if change fails" style={{ minHeight: 60 }} />
              </div>
              <div className="form-group">
                <label className="form-label">Test Plan</label>
                <textarea className="form-textarea" value={form.testPlan} onChange={e => set('testPlan', e.target.value)} placeholder="How to validate the change" style={{ minHeight: 60 }} />
              </div>
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
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : change ? 'Update' : 'Submit Change'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function ChangeDetailModal({ change, onClose, onRefresh }: { change: ChangeRequest; onClose: () => void; onRefresh: () => void }) {
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const [comment, setComment] = useState('');
  const [approvalComment, setApprovalComment] = useState('');

  async function updateStatus(status: string) {
    try {
      await api.patch(`/changes/${change.id}`, { status });
      toast('success', `Change ${status.replace(/_/g, ' ').toLowerCase()}`);
      onRefresh();
      onClose();
    } catch { toast('error', 'Failed to update change'); }
  }

  async function submitApproval(status: 'APPROVED' | 'REJECTED') {
    if (status === 'REJECTED') {
      const ok = await confirm({ title: 'Reject Change', message: `Reject change ${change.number}?`, confirmText: 'Reject', variant: 'danger' });
      if (!ok) return;
    }
    try {
      await api.post(`/changes/${change.id}/approve`, { status, comments: approvalComment || undefined });
      toast('success', `Change ${status.toLowerCase()}`);
      onRefresh();
      onClose();
    } catch { toast('error', 'Failed to submit approval'); }
  }

  async function addComment() {
    if (!comment.trim()) return;
    try {
      await api.post('/admin/comments', { content: comment, changeRequestId: change.id });
      toast('success', 'Comment added');
      setComment('');
      onRefresh();
      onClose();
    } catch { toast('error', 'Failed to add comment'); }
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
            <div><div className="detail-label">Type</div><div className="detail-value"><span className={`badge badge-${change.type.toLowerCase()}`}>{change.type}</span></div></div>
            <div><div className="detail-label">Status</div><div className="detail-value"><span className={`badge badge-${change.status.toLowerCase().replace(/_/g, '-')}`}>{change.status.replace(/_/g, ' ')}</span></div></div>
            <div><div className="detail-label">Priority</div><div className="detail-value"><span className={`badge badge-${change.priority.toLowerCase()}`}>{change.priority}</span></div></div>
            <div><div className="detail-label">Risk</div><div className="detail-value"><span className={`badge badge-${change.risk.toLowerCase()}`}>{change.risk}</span></div></div>
            <div><div className="detail-label">Requester</div><div className="detail-value">{change.requester ? `${change.requester.firstName} ${change.requester.lastName}` : '—'}</div></div>
            <div><div className="detail-label">Assigned To</div><div className="detail-value">{change.assignedTo ? `${change.assignedTo.firstName} ${change.assignedTo.lastName}` : 'Unassigned'}</div></div>
            <div><div className="detail-label">Scheduled Start</div><div className="detail-value">{change.scheduledStart ? new Date(change.scheduledStart).toLocaleString() : '—'}</div></div>
            <div><div className="detail-label">Scheduled End</div><div className="detail-value">{change.scheduledEnd ? new Date(change.scheduledEnd).toLocaleString() : '—'}</div></div>
            <div><div className="detail-label">Created</div><div className="detail-value">{new Date(change.createdAt).toLocaleString()}</div></div>
            <div><div className="detail-label">Closed</div><div className="detail-value">{change.closedAt ? new Date(change.closedAt).toLocaleString() : '—'}</div></div>
          </div>

          {change.reason && <div style={{ marginTop: 16 }}><div className="detail-label">Reason for Change</div><div className="detail-value" style={{ whiteSpace: 'pre-wrap' }}>{change.reason}</div></div>}
          {change.implementationPlan && <div style={{ marginTop: 12 }}><div className="detail-label">Implementation Plan</div><div className="detail-value" style={{ whiteSpace: 'pre-wrap' }}>{change.implementationPlan}</div></div>}
          {change.backoutPlan && <div style={{ marginTop: 12 }}><div className="detail-label">Backout Plan</div><div className="detail-value" style={{ whiteSpace: 'pre-wrap' }}>{change.backoutPlan}</div></div>}
          {change.testPlan && <div style={{ marginTop: 12 }}><div className="detail-label">Test Plan</div><div className="detail-value" style={{ whiteSpace: 'pre-wrap' }}>{change.testPlan}</div></div>}

          {/* Approvals */}
          {change.approvals && change.approvals.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, marginBottom: 8 }}>Approvals</h3>
              {change.approvals.map(a => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <span className={`badge badge-${a.status.toLowerCase()}`}>{a.status}</span>
                  <span>{a.approver.firstName} {a.approver.lastName}</span>
                  {a.comments && <span className="text-sm text-muted">— {a.comments}</span>}
                  {a.decidedAt && <span className="text-xs text-muted" style={{ marginLeft: 'auto' }}>{new Date(a.decidedAt).toLocaleString()}</span>}
                </div>
              ))}
            </div>
          )}

          {/* Related Incidents */}
          {change.incidents && change.incidents.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, marginBottom: 8 }}>Related Incidents</h3>
              {change.incidents.map(inc => (
                <div key={inc.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                  <span className="td-primary">{inc.number}</span>
                  <span>{inc.title}</span>
                  <span className={`badge badge-${inc.status.toLowerCase()}`}>{inc.status}</span>
                </div>
              ))}
            </div>
          )}

          {/* Comments / Activity */}
          {change.comments && change.comments.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, marginBottom: 8 }}>Activity</h3>
              {change.comments.map(c => (
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
              <label className="form-label">Add Comment</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <textarea className="form-textarea" value={comment} onChange={e => setComment(e.target.value)} placeholder="Add a work note..." style={{ minHeight: 40, flex: 1 }} />
                <button className="btn btn-outline" onClick={addComment} disabled={!comment.trim()}>Post</button>
              </div>
            </div>
          </div>

          {/* Status Actions */}
          <div className="btn-group" style={{ marginTop: 20 }}>
            {change.status === 'NEW' && <button className="btn btn-accent" onClick={() => updateStatus('PLANNING')}>Start Planning</button>}
            {change.status === 'PLANNING' && <button className="btn btn-primary" onClick={() => updateStatus('AWAITING_APPROVAL')}>Submit for Approval</button>}
            {change.status === 'AWAITING_APPROVAL' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input className="form-input" value={approvalComment} onChange={e => setApprovalComment(e.target.value)} placeholder="Approval comment..." style={{ width: 200 }} />
                  <button className="btn btn-success" onClick={() => submitApproval('APPROVED')}>Approve</button>
                  <button className="btn btn-danger" onClick={() => submitApproval('REJECTED')}>Reject</button>
                </div>
              </>
            )}
            {change.status === 'APPROVED' && <button className="btn btn-accent" onClick={() => updateStatus('SCHEDULED')}>Schedule</button>}
            {change.status === 'SCHEDULED' && <button className="btn btn-primary" onClick={() => updateStatus('IMPLEMENTING')}>Begin Implementation</button>}
            {change.status === 'IMPLEMENTING' && (
              <>
                <button className="btn btn-success" onClick={() => updateStatus('COMPLETED')}>Mark Completed</button>
                <button className="btn btn-danger" onClick={() => updateStatus('FAILED')}>Mark Failed</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
