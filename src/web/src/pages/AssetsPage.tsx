import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/client';

interface Asset {
  id: string;
  assetTag: string;
  name: string;
  type: string;
  status: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  location: string | null;
  department: string | null;
  purchaseDate: string | null;
  warrantyExpiry: string | null;
  notes: string | null;
  createdAt: string;
  assignedTo?: { firstName: string; lastName: string } | null;
}

const TYPES = ['LAPTOP', 'DESKTOP', 'SERVER', 'NETWORK', 'PRINTER', 'PHONE', 'MONITOR', 'OTHER'];
const STATUSES = ['ACTIVE', 'INACTIVE', 'RETIRED', 'MAINTENANCE'];

export function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState<Asset | null>(null);

  function fetchData() {
    const params: Record<string, string> = {};
    if (search) params.search = search;
    if (filterType) params.type = filterType;
    if (filterStatus) params.status = filterStatus;
    api.get('/assets', { params })
      .then(({ data }) => setAssets(data.data))
      .catch(() => setAssets([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchData(); }, [search, filterType, filterStatus]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Assets / CMDB</h1>
          <p className="page-subtitle">Configuration Management Database</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Add Asset</button>
      </div>

      <div className="filter-bar">
        <input className="form-input search-input" placeholder="Search assets..." value={search} onChange={e => setSearch(e.target.value)} />
        <select className="form-select" value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">All Types</option>
          {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="form-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="card">
        {loading ? (
          <div className="loading-spinner">Loading...</div>
        ) : assets.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">💻</div>
            <div className="empty-state-text">No assets found</div>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>Add First Asset</button>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Asset Tag</th>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Manufacturer</th>
                  <th>Assigned To</th>
                  <th>Location</th>
                </tr>
              </thead>
              <tbody>
                {assets.map(a => (
                  <tr key={a.id} className="clickable" onClick={() => setShowDetail(a)}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{a.assetTag}</td>
                    <td>{a.name}</td>
                    <td><span className="badge badge-info" style={{ background: '#ebf8ff', color: '#2b6cb0' }}>{a.type}</span></td>
                    <td><span className={`badge badge-${a.status.toLowerCase()}`}>{a.status}</span></td>
                    <td>{a.manufacturer || '—'}</td>
                    <td>{a.assignedTo ? `${a.assignedTo.firstName} ${a.assignedTo.lastName}` : '—'}</td>
                    <td>{a.location || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreate && <AssetFormModal onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); fetchData(); }} />}
      {showDetail && <AssetDetailModal asset={showDetail} onClose={() => setShowDetail(null)} onRefresh={fetchData} />}
    </div>
  );
}

function AssetFormModal({ asset, onClose, onSaved }: { asset?: Asset; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: asset?.name || '',
    type: asset?.type || 'LAPTOP',
    status: asset?.status || 'ACTIVE',
    manufacturer: asset?.manufacturer || '',
    model: asset?.model || '',
    serialNumber: asset?.serialNumber || '',
    location: asset?.location || '',
    department: asset?.department || '',
    notes: asset?.notes || '',
  });
  const [saving, setSaving] = useState(false);

  function set(field: string, value: string) { setForm(f => ({ ...f, [field]: value })); }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, manufacturer: form.manufacturer || undefined, model: form.model || undefined, serialNumber: form.serialNumber || undefined, location: form.location || undefined, department: form.department || undefined, notes: form.notes || undefined };
      if (asset) {
        await api.patch(`/assets/${asset.id}`, payload);
      } else {
        await api.post('/assets', payload);
      }
      onSaved();
    } catch {
      alert('Failed to save asset');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{asset ? 'Edit Asset' : 'Add New Asset'}</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Name *</label>
              <input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} required />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Type</label>
                <select className="form-select" value={form.type} onChange={e => set('type', e.target.value)}>
                  {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Status</label>
                <select className="form-select" value={form.status} onChange={e => set('status', e.target.value)}>
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Manufacturer</label>
                <input className="form-input" value={form.manufacturer} onChange={e => set('manufacturer', e.target.value)} placeholder="e.g. Dell, HP, Lenovo" />
              </div>
              <div className="form-group">
                <label className="form-label">Model</label>
                <input className="form-input" value={form.model} onChange={e => set('model', e.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Serial Number</label>
                <input className="form-input" value={form.serialNumber} onChange={e => set('serialNumber', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Location</label>
                <input className="form-input" value={form.location} onChange={e => set('location', e.target.value)} placeholder="e.g. Office A, Floor 3" />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Department</label>
              <input className="form-input" value={form.department} onChange={e => set('department', e.target.value)} placeholder="e.g. IT, Finance, HR" />
            </div>
            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea className="form-textarea" value={form.notes} onChange={e => set('notes', e.target.value)} style={{ minHeight: 60 }} />
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : asset ? 'Update' : 'Add Asset'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function AssetDetailModal({ asset, onClose, onRefresh }: { asset: Asset; onClose: () => void; onRefresh: () => void }) {
  async function updateStatus(status: string) {
    try {
      await api.patch(`/assets/${asset.id}`, { status });
      onRefresh();
      onClose();
    } catch {}
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{asset.assetTag}</h2>
            <p className="text-sm text-muted">{asset.name}</p>
          </div>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="detail-grid">
            <div><div className="detail-label">Type</div><div className="detail-value">{asset.type}</div></div>
            <div><div className="detail-label">Status</div><div className="detail-value"><span className={`badge badge-${asset.status.toLowerCase()}`}>{asset.status}</span></div></div>
            <div><div className="detail-label">Manufacturer</div><div className="detail-value">{asset.manufacturer || '—'}</div></div>
            <div><div className="detail-label">Model</div><div className="detail-value">{asset.model || '—'}</div></div>
            <div><div className="detail-label">Serial Number</div><div className="detail-value">{asset.serialNumber || '—'}</div></div>
            <div><div className="detail-label">Location</div><div className="detail-value">{asset.location || '—'}</div></div>
            <div><div className="detail-label">Department</div><div className="detail-value">{asset.department || '—'}</div></div>
            <div><div className="detail-label">Assigned To</div><div className="detail-value">{asset.assignedTo ? `${asset.assignedTo.firstName} ${asset.assignedTo.lastName}` : 'Unassigned'}</div></div>
            <div><div className="detail-label">Purchase Date</div><div className="detail-value">{asset.purchaseDate ? new Date(asset.purchaseDate).toLocaleDateString() : '—'}</div></div>
            <div><div className="detail-label">Warranty Expiry</div><div className="detail-value">{asset.warrantyExpiry ? new Date(asset.warrantyExpiry).toLocaleDateString() : '—'}</div></div>
          </div>
          {asset.notes && <div style={{ marginTop: 16 }}><div className="detail-label">Notes</div><div className="detail-value" style={{ whiteSpace: 'pre-wrap' }}>{asset.notes}</div></div>}
          <div className="btn-group" style={{ marginTop: 20 }}>
            {asset.status === 'ACTIVE' && <button className="btn btn-outline" onClick={() => updateStatus('MAINTENANCE')}>Send to Maintenance</button>}
            {asset.status === 'MAINTENANCE' && <button className="btn btn-success" onClick={() => updateStatus('ACTIVE')}>Reactivate</button>}
            {asset.status !== 'RETIRED' && <button className="btn btn-danger" onClick={() => updateStatus('RETIRED')}>Retire</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
