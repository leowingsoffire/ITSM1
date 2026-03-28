import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { useToast } from '../components/Toast';
import { useDebounce } from '../hooks/useDebounce';
import { Pagination } from '../components/Pagination';
import { useConfirm } from '../components/ConfirmDialog';
import { SkeletonTable } from '../components/Skeleton';
import { exportToCsv } from '../utils/exportCsv';

interface ServiceRequest {
  id: string;
  number: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  category: string | null;
  createdAt: string;
  requester?: { firstName: string; lastName: string } | null;
  assignedTo?: { firstName: string; lastName: string } | null;
}

const STATUSES = ['SUBMITTED', 'APPROVED', 'IN_PROGRESS', 'FULFILLED', 'REJECTED', 'CANCELLED'];
const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

export function ServiceRequestsPage() {
  const { toast } = useToast();
  const [items, setItems] = useState<ServiceRequest[]>([]);
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
  const [showDetail, setShowDetail] = useState<ServiceRequest | null>(null);

  function fetchData() {
    const params: Record<string, string> = {};
    if (debouncedSearch) params.search = debouncedSearch;
    if (filterStatus) params.status = filterStatus;
    if (filterPriority) params.priority = filterPriority;
    params.page = String(page);
    params.limit = String(limit);
    api.get('/service-requests', { params })
      .then(({ data }) => { setItems(data.data); setTotalPages(data.pagination?.totalPages || 1); setTotal(data.pagination?.total || 0); })
      .catch(() => { setItems([]); toast('error', 'Failed to load service requests'); })
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchData(); }, [debouncedSearch, filterStatus, filterPriority, page, limit]);
  useEffect(() => { setPage(1); }, [debouncedSearch, filterStatus, filterPriority]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Service Requests</h1>
          <p className="page-subtitle">Track and fulfill service requests</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Request</button>
      </div>

      <div className="filter-bar">
        <input className="form-input search-input" placeholder="Search requests..." value={search} onChange={e => setSearch(e.target.value)} />
        <select className="form-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <select className="form-select" value={filterPriority} onChange={e => setFilterPriority(e.target.value)}>
          <option value="">All Priorities</option>
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <button className="btn btn-outline btn-export" onClick={() => exportToCsv('service-requests', ['Number','Title','Priority','Status','Requester','Assigned To','Created'], items.map(sr => [sr.number, sr.title, sr.priority, sr.status, sr.requester ? `${sr.requester.firstName} ${sr.requester.lastName}` : '', sr.assignedTo ? `${sr.assignedTo.firstName} ${sr.assignedTo.lastName}` : '', new Date(sr.createdAt).toLocaleDateString()]))}>Export CSV</button>
      </div>

      <div className="card">
        {loading ? (
          <SkeletonTable rows={6} cols={7} />
        ) : items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">✦</div>
            <div className="empty-state-text">No service requests found</div>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>Create First Request</button>
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
                  <th>Requester</th>
                  <th>Assigned To</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {items.map(sr => (
                  <tr key={sr.id} className="clickable" onClick={() => setShowDetail(sr)}>
                    <td className="td-primary">{sr.number}</td>
                    <td>{sr.title}</td>
                    <td><span className={`badge badge-${sr.priority.toLowerCase()}`}>{sr.priority}</span></td>
                    <td><span className={`badge badge-${sr.status.toLowerCase()}`}>{sr.status.replace('_', ' ')}</span></td>
                    <td>{sr.requester ? `${sr.requester.firstName} ${sr.requester.lastName}` : '—'}</td>
                    <td>{sr.assignedTo ? `${sr.assignedTo.firstName} ${sr.assignedTo.lastName}` : '—'}</td>
                    <td style={{ fontSize: 'var(--text-xs)' }}>{new Date(sr.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} totalPages={totalPages} total={total} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
          </div>
        )}
      </div>

      {showCreate && <SRFormModal onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); fetchData(); }} />}
      {showDetail && <SRDetailModal sr={showDetail} onClose={() => setShowDetail(null)} onRefresh={fetchData} />}
    </div>
  );
}

function SRFormModal({ sr, onClose, onSaved }: { sr?: ServiceRequest; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    title: sr?.title || '',
    description: sr?.description || '',
    priority: sr?.priority || 'MEDIUM',
    category: sr?.category || '',
    status: sr?.status || 'SUBMITTED',
  });
  const [saving, setSaving] = useState(false);

  function set(field: string, value: string) { setForm(f => ({ ...f, [field]: value })); }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (sr) {
        await api.patch(`/service-requests/${sr.id}`, form);
      } else {
        await api.post('/service-requests', form);
      }
      onSaved();
    } catch {
      toast('error', 'Failed to save request');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{sr ? 'Edit Request' : 'New Service Request'}</h2>
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
                <label className="form-label">Category</label>
                <input className="form-input" value={form.category} onChange={e => set('category', e.target.value)} placeholder="e.g. Software, Access, Equipment" />
              </div>
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : sr ? 'Update' : 'Submit Request'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function SRDetailModal({ sr, onClose, onRefresh }: { sr: ServiceRequest; onClose: () => void; onRefresh: () => void }) {
  const { toast } = useToast();
  const { confirm } = useConfirm();
  async function updateStatus(status: string) {
    if (status === 'REJECTED') {
      const ok = await confirm({ title: 'Reject Request', message: `Are you sure you want to reject ${sr.number}? The requester will be notified.`, confirmText: 'Reject', variant: 'danger' });
      if (!ok) return;
    }
    try {
      await api.patch(`/service-requests/${sr.id}`, { status });
      toast('success', `Request ${status.toLowerCase().replace('_', ' ')}`);
      onRefresh();
      onClose();
    } catch { toast('error', 'Failed to update status'); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{sr.number}</h2>
            <p className="text-sm text-muted">{sr.title}</p>
          </div>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="detail-grid">
            <div><div className="detail-label">Status</div><div className="detail-value"><span className={`badge badge-${sr.status.toLowerCase()}`}>{sr.status.replace('_', ' ')}</span></div></div>
            <div><div className="detail-label">Priority</div><div className="detail-value"><span className={`badge badge-${sr.priority.toLowerCase()}`}>{sr.priority}</span></div></div>
            <div><div className="detail-label">Category</div><div className="detail-value">{sr.category || '—'}</div></div>
            <div><div className="detail-label">Created</div><div className="detail-value">{new Date(sr.createdAt).toLocaleString()}</div></div>
            <div><div className="detail-label">Requester</div><div className="detail-value">{sr.requester ? `${sr.requester.firstName} ${sr.requester.lastName}` : '—'}</div></div>
            <div><div className="detail-label">Assigned To</div><div className="detail-value">{sr.assignedTo ? `${sr.assignedTo.firstName} ${sr.assignedTo.lastName}` : 'Unassigned'}</div></div>
          </div>
          <div style={{ marginTop: 16 }}>
            <div className="detail-label">Description</div>
            <div className="detail-value" style={{ whiteSpace: 'pre-wrap' }}>{sr.description}</div>
          </div>
          <div className="btn-group" style={{ marginTop: 20 }}>
            {sr.status === 'SUBMITTED' && <button className="btn btn-success" onClick={() => updateStatus('APPROVED')}>Approve</button>}
            {sr.status === 'SUBMITTED' && <button className="btn btn-danger" onClick={() => updateStatus('REJECTED')}>Reject</button>}
            {sr.status === 'APPROVED' && <button className="btn btn-accent" onClick={() => updateStatus('IN_PROGRESS')}>Start Work</button>}
            {sr.status === 'IN_PROGRESS' && <button className="btn btn-success" onClick={() => updateStatus('FULFILLED')}>Mark Fulfilled</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
