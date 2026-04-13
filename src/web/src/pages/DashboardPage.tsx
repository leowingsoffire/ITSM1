import { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';
import { useNavigate } from 'react-router-dom';
import { SkeletonStats } from '../components/Skeleton';

interface DashboardData {
  summary: {
    openIncidents: number;
    criticalIncidents: number;
    pendingRequests: number;
    resolvedToday: number;
    slaBreaches: number;
    totalAssets: number;
    newIncidentsThisWeek: number;
    openChanges: number;
    openProblems: number;
    knownErrors: number;
    pendingApprovals: number;
  };
  charts: {
    incidentsByPriority: { critical: number; high: number; medium: number; low: number };
    incidentsByStatus: { new: number; inProgress: number; onHold: number; resolved: number; closed: number };
  };
  recentIncidents: Array<{ id: string; number: string; title: string; status: string; priority: string; createdAt: string; assignedTo?: { firstName: string; lastName: string } | null }>;
  recentRequests: Array<{ id: string; number: string; title: string; status: string; priority: string; createdAt: string; requester?: { firstName: string; lastName: string } | null }>;
  recentChanges: Array<{ id: string; number: string; title: string; status: string; type: string; createdAt: string }>;
  recentProblems: Array<{ id: string; number: string; title: string; status: string; priority: string; isKnownError: boolean; createdAt: string }>;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const navigate = useNavigate();

  const fetchData = useCallback((isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    api.get('/dashboard')
      .then(({ data: res }) => { setData(res.data); setLastUpdated(new Date()); })
      .catch(() => {})
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => fetchData(true), 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchData]);

  if (loading) return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Real-time overview of your IT service operations</p>
        </div>
      </div>
      <SkeletonStats count={6} />
    </div>
  );
  if (!data) return <div className="empty-state"><div className="empty-state-text">Unable to load dashboard data.</div></div>;

  const s = data.summary;
  const priorityMax = Math.max(data.charts.incidentsByPriority.critical, data.charts.incidentsByPriority.high, data.charts.incidentsByPriority.medium, data.charts.incidentsByPriority.low, 1);
  const statusMax = Math.max(data.charts.incidentsByStatus.new, data.charts.incidentsByStatus.inProgress, data.charts.incidentsByStatus.onHold, data.charts.incidentsByStatus.resolved, data.charts.incidentsByStatus.closed, 1);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Real-time overview of your IT service operations</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {autoRefresh && <div className="auto-refresh"><span className="auto-refresh-dot" />Auto-refresh</div>}
          {lastUpdated && <span className="text-xs text-muted">Updated {lastUpdated.toLocaleTimeString()}</span>}
          <button className={`refresh-btn${refreshing ? ' refreshing' : ''}`} onClick={() => fetchData(true)} disabled={refreshing}>
            <span className="refresh-icon">↻</span> {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button className={`btn btn-sm ${autoRefresh ? 'btn-success' : 'btn-outline'}`} onClick={() => setAutoRefresh(!autoRefresh)} data-tooltip="Auto-refresh every 30s">
            {autoRefresh ? '● Live' : '○ Live'}
          </button>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card stat-danger">
          <div className="stat-icon danger">⚡</div>
          <div className="stat-content">
            <div className="stat-label">Open Incidents</div>
            <div className="stat-value">{s.openIncidents}</div>
            <div className="stat-change">{s.criticalIncidents} critical</div>
          </div>
        </div>
        <div className="stat-card stat-warning">
          <div className="stat-icon warning">✦</div>
          <div className="stat-content">
            <div className="stat-label">Pending Requests</div>
            <div className="stat-value">{s.pendingRequests}</div>
          </div>
        </div>
        <div className="stat-card stat-success">
          <div className="stat-icon success">✓</div>
          <div className="stat-content">
            <div className="stat-label">Resolved Today</div>
            <div className="stat-value">{s.resolvedToday}</div>
          </div>
        </div>
        <div className="stat-card stat-danger">
          <div className="stat-icon danger">◉</div>
          <div className="stat-content">
            <div className="stat-label">SLA Breaches</div>
            <div className="stat-value">{s.slaBreaches}</div>
          </div>
        </div>
        <div className="stat-card stat-info">
          <div className="stat-icon info">◎</div>
          <div className="stat-content">
            <div className="stat-label">Active Assets</div>
            <div className="stat-value">{s.totalAssets}</div>
          </div>
        </div>
        <div className="stat-card stat-purple">
          <div className="stat-icon purple">↑</div>
          <div className="stat-content">
            <div className="stat-label">New This Week</div>
            <div className="stat-value">{s.newIncidentsThisWeek}</div>
            <div className="stat-change">incidents</div>
          </div>
        </div>
        <div className="stat-card stat-accent">
          <div className="stat-icon accent">⟳</div>
          <div className="stat-content">
            <div className="stat-label">Open Changes</div>
            <div className="stat-value">{s.openChanges}</div>
          </div>
        </div>
        <div className="stat-card stat-warning">
          <div className="stat-icon warning">⚠</div>
          <div className="stat-content">
            <div className="stat-label">Open Problems</div>
            <div className="stat-value">{s.openProblems}</div>
            <div className="stat-change">{s.knownErrors} known errors</div>
          </div>
        </div>
        <div className="stat-card stat-info">
          <div className="stat-icon info">✓</div>
          <div className="stat-content">
            <div className="stat-label">Pending Approvals</div>
            <div className="stat-value">{s.pendingApprovals}</div>
          </div>
        </div>
      </div>

      <div className="grid-2 mb-lg">
        <div className="card">
          <div className="card-header"><span className="card-title">Incidents by Priority</span></div>
          <div className="card-body">
            <div className="chart-bars">
              {([
                { label: 'Critical', value: data.charts.incidentsByPriority.critical, color: '#ef4444' },
                { label: 'High', value: data.charts.incidentsByPriority.high, color: '#f97316' },
                { label: 'Medium', value: data.charts.incidentsByPriority.medium, color: '#eab308' },
                { label: 'Low', value: data.charts.incidentsByPriority.low, color: '#10b981' },
              ]).map(b => (
                <div className="chart-bar" key={b.label}>
                  <div className="chart-bar-value">{b.value}</div>
                  <div className="chart-bar-fill" style={{ height: `${(b.value / priorityMax) * 100}%`, background: b.color }} />
                  <div className="chart-bar-label">{b.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title">Incidents by Status</span></div>
          <div className="card-body">
            <div className="chart-bars">
              {([
                { label: 'New', value: data.charts.incidentsByStatus.new, color: '#3b82f6' },
                { label: 'In Progress', value: data.charts.incidentsByStatus.inProgress, color: '#eab308' },
                { label: 'On Hold', value: data.charts.incidentsByStatus.onHold, color: '#ef4444' },
                { label: 'Resolved', value: data.charts.incidentsByStatus.resolved, color: '#10b981' },
                { label: 'Closed', value: data.charts.incidentsByStatus.closed, color: '#94a3b8' },
              ]).map(b => (
                <div className="chart-bar" key={b.label}>
                  <div className="chart-bar-value">{b.value}</div>
                  <div className="chart-bar-fill" style={{ height: `${(b.value / statusMax) * 100}%`, background: b.color }} />
                  <div className="chart-bar-label">{b.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <span className="card-title">Recent Incidents</span>
            <button className="btn btn-sm btn-outline" onClick={() => navigate('/incidents')}>View All →</button>
          </div>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr><th>Number</th><th>Title</th><th>Priority</th><th>Status</th><th>Created</th></tr>
              </thead>
              <tbody>
                {data.recentIncidents.map(inc => (
                  <tr key={inc.id} className="clickable" onClick={() => navigate('/incidents')}>
                    <td className="td-primary">{inc.number}</td>
                    <td>{inc.title}</td>
                    <td><span className={`badge badge-${inc.priority.toLowerCase()}`}>{inc.priority}</span></td>
                    <td><span className={`badge badge-${inc.status.toLowerCase()}`}>{inc.status.replace(/_/g, ' ')}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(inc.createdAt)}</td>
                  </tr>
                ))}
                {data.recentIncidents.length === 0 && (
                  <tr><td colSpan={5} className="text-muted" style={{ textAlign: 'center', padding: 24 }}>No recent incidents</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Recent Service Requests</span>
            <button className="btn btn-sm btn-outline" onClick={() => navigate('/service-requests')}>View All →</button>
          </div>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr><th>Number</th><th>Title</th><th>Priority</th><th>Status</th><th>Created</th></tr>
              </thead>
              <tbody>
                {data.recentRequests.map(sr => (
                  <tr key={sr.id} className="clickable" onClick={() => navigate('/service-requests')}>
                    <td className="td-primary">{sr.number}</td>
                    <td>{sr.title}</td>
                    <td><span className={`badge badge-${sr.priority.toLowerCase()}`}>{sr.priority}</span></td>
                    <td><span className={`badge badge-${sr.status.toLowerCase()}`}>{sr.status.replace(/_/g, ' ')}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(sr.createdAt)}</td>
                  </tr>
                ))}
                {data.recentRequests.length === 0 && (
                  <tr><td colSpan={5} className="text-muted" style={{ textAlign: 'center', padding: 24 }}>No recent requests</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <span className="card-title">Recent Changes</span>
            <button className="btn btn-sm btn-outline" onClick={() => navigate('/changes')}>View All →</button>
          </div>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr><th>Number</th><th>Title</th><th>Type</th><th>Status</th><th>Created</th></tr>
              </thead>
              <tbody>
                {data.recentChanges?.map(c => (
                  <tr key={c.id} className="clickable" onClick={() => navigate('/changes')}>
                    <td className="td-primary">{c.number}</td>
                    <td>{c.title}</td>
                    <td><span className={`badge badge-${c.type.toLowerCase()}`}>{c.type}</span></td>
                    <td><span className={`badge badge-${c.status.toLowerCase().replace(/_/g, '-')}`}>{c.status.replace(/_/g, ' ')}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(c.createdAt)}</td>
                  </tr>
                ))}
                {(!data.recentChanges || data.recentChanges.length === 0) && (
                  <tr><td colSpan={5} className="text-muted" style={{ textAlign: 'center', padding: 24 }}>No recent changes</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Recent Problems</span>
            <button className="btn btn-sm btn-outline" onClick={() => navigate('/problems')}>View All →</button>
          </div>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr><th>Number</th><th>Title</th><th>Priority</th><th>Status</th><th>Created</th></tr>
              </thead>
              <tbody>
                {data.recentProblems?.map(p => (
                  <tr key={p.id} className="clickable" onClick={() => navigate('/problems')}>
                    <td className="td-primary">{p.number}{p.isKnownError && <span className="badge badge-known-error" style={{ marginLeft: 4, fontSize: 9 }}>KE</span>}</td>
                    <td>{p.title}</td>
                    <td><span className={`badge badge-${p.priority.toLowerCase()}`}>{p.priority}</span></td>
                    <td><span className={`badge badge-${p.status.toLowerCase().replace(/_/g, '-')}`}>{p.status.replace(/_/g, ' ')}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(p.createdAt)}</td>
                  </tr>
                ))}
                {(!data.recentProblems || data.recentProblems.length === 0) && (
                  <tr><td colSpan={5} className="text-muted" style={{ textAlign: 'center', padding: 24 }}>No recent problems</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
