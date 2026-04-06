import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Pagination } from '../components/Pagination';

interface AuditLog {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  changes: string | null;
  createdAt: string;
  performedBy: { id: string; firstName: string; lastName: string; email: string };
}

const ENTITY_TYPES = ['Incident', 'ServiceRequest', 'ChangeRequest', 'Problem', 'Asset', 'KnowledgeArticle'];

export function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterEntity, setFilterEntity] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const params: Record<string, string> = { page: String(page), limit: '30' };
    if (filterEntity) params.entityType = filterEntity;
    api.get('/audit-logs', { params })
      .then(({ data }) => { setLogs(data.data); setTotalPages(data.pagination?.totalPages || 1); })
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  }, [page, filterEntity]);

  useEffect(() => { setPage(1); }, [filterEntity]);

  function formatChanges(changesStr: string | null): string {
    if (!changesStr) return '';
    try {
      const obj = JSON.parse(changesStr);
      return Object.entries(obj)
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join('\n');
    } catch {
      return changesStr;
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit Log</h1>
          <p className="page-subtitle">Track all changes across the system</p>
        </div>
      </div>

      <div className="filter-bar">
        <select className="form-select" value={filterEntity} onChange={e => setFilterEntity(e.target.value)}>
          <option value="">All Entity Types</option>
          {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div className="card">
        {loading ? (
          <div className="loading-spinner">Loading audit logs...</div>
        ) : logs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">◉</div>
            <div className="empty-state-text">No audit logs found</div>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Entity</th>
                  <th>Action</th>
                  <th>Performed By</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <>
                    <tr key={log.id} className={log.changes ? 'clickable' : ''} onClick={() => log.changes && setExpandedId(expandedId === log.id ? null : log.id)}>
                      <td style={{ fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' }}>
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td>
                        <span className="badge badge-medium">{log.entityType}</span>
                      </td>
                      <td>
                        <span className={`badge ${log.action.includes('DELETED') ? 'badge-critical' : log.action.includes('CREATED') ? 'badge-low' : 'badge-high'}`}>
                          {log.action.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td>{log.performedBy.firstName} {log.performedBy.lastName}</td>
                      <td>{log.changes ? '▸ View' : '—'}</td>
                    </tr>
                    {expandedId === log.id && log.changes && (
                      <tr key={`${log.id}-detail`}>
                        <td colSpan={5} style={{ background: 'var(--bg-secondary)', padding: 16 }}>
                          <pre style={{ margin: 0, fontSize: 'var(--text-xs)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                            {formatChanges(log.changes)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        )}
      </div>
    </div>
  );
}
