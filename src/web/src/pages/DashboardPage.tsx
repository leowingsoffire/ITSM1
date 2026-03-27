import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useNavigate } from 'react-router-dom';

interface DashboardData {
  summary: {
    openIncidents: number;
    criticalIncidents: number;
    pendingRequests: number;
    resolvedToday: number;
    slaBreaches: number;
    totalAssets: number;
    newIncidentsThisWeek: number;
  };
  charts: {
    incidentsByPriority: { critical: number; high: number; medium: number; low: number };
    incidentsByStatus: { new: number; inProgress: number; onHold: number; resolved: number; closed: number };
  };
  recentIncidents: Array<{ id: string; number: string; title: string; status: string; priority: string; createdAt: string; assignedTo?: { firstName: string; lastName: string } | null }>;
  recentRequests: Array<{ id: string; number: string; title: string; status: string; priority: string; createdAt: string; requester?: { firstName: string; lastName: string } | null }>;
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/dashboard')
      .then(({ data: res }) => setData(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading-spinner">Loading dashboard...</div>;
  if (!data) return <div className="empty-state"><div className="empty-state-text">Unable to load dashboard data.</div></div>;

  const s = data.summary;
  const priorityMax = Math.max(data.charts.incidentsByPriority.critical, data.charts.incidentsByPriority.high, data.charts.incidentsByPriority.medium, data.charts.incidentsByPriority.low, 1);
  const statusMax = Math.max(data.charts.incidentsByStatus.new, data.charts.incidentsByStatus.inProgress, data.charts.incidentsByStatus.onHold, data.charts.incidentsByStatus.resolved, data.charts.incidentsByStatus.closed, 1);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Overview of your IT service operations</p>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon danger">🔥</div>
          <div className="stat-content">
            <div className="stat-label">Open Incidents</div>
            <div className="stat-value">{s.openIncidents}</div>
            <div className="stat-change">{s.criticalIncidents} critical</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon warning">📋</div>
          <div className="stat-content">
            <div className="stat-label">Pending Requests</div>
            <div className="stat-value">{s.pendingRequests}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon success">✅</div>
          <div className="stat-content">
            <div className="stat-label">Resolved Today</div>
            <div className="stat-value">{s.resolvedToday}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon danger">⏰</div>
          <div className="stat-content">
            <div className="stat-label">SLA Breaches</div>
            <div className="stat-value">{s.slaBreaches}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon info">💻</div>
          <div className="stat-content">
            <div className="stat-label">Active Assets</div>
            <div className="stat-value">{s.totalAssets}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon info">📈</div>
          <div className="stat-content">
            <div className="stat-label">New This Week</div>
            <div className="stat-value">{s.newIncidentsThisWeek}</div>
            <div className="stat-change">incidents</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <div className="card">
          <div className="card-header"><span className="card-title">Incidents by Priority</span></div>
          <div className="card-body">
            <div className="chart-bars">
              {([
                { label: 'Critical', value: data.charts.incidentsByPriority.critical, color: '#e53e3e' },
                { label: 'High', value: data.charts.incidentsByPriority.high, color: '#ed8936' },
                { label: 'Medium', value: data.charts.incidentsByPriority.medium, color: '#d69e2e' },
                { label: 'Low', value: data.charts.incidentsByPriority.low, color: '#38a169' },
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
                { label: 'New', value: data.charts.incidentsByStatus.new, color: '#3182ce' },
                { label: 'In Progress', value: data.charts.incidentsByStatus.inProgress, color: '#d69e2e' },
                { label: 'On Hold', value: data.charts.incidentsByStatus.onHold, color: '#e53e3e' },
                { label: 'Resolved', value: data.charts.incidentsByStatus.resolved, color: '#38a169' },
                { label: 'Closed', value: data.charts.incidentsByStatus.closed, color: '#718096' },
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="card">
          <div className="card-header">
            <span className="card-title">Recent Incidents</span>
            <button className="btn btn-sm btn-outline" onClick={() => navigate('/incidents')}>View All</button>
          </div>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr><th>Number</th><th>Title</th><th>Priority</th><th>Status</th></tr>
              </thead>
              <tbody>
                {data.recentIncidents.map(inc => (
                  <tr key={inc.id} className="clickable" onClick={() => navigate('/incidents')}>
                    <td>{inc.number}</td>
                    <td>{inc.title}</td>
                    <td><span className={`badge badge-${inc.priority.toLowerCase()}`}>{inc.priority}</span></td>
                    <td><span className={`badge badge-${inc.status.toLowerCase()}`}>{inc.status.replace('_', ' ')}</span></td>
                  </tr>
                ))}
                {data.recentIncidents.length === 0 && (
                  <tr><td colSpan={4} style={{ textAlign: 'center', color: '#718096' }}>No incidents</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Recent Service Requests</span>
            <button className="btn btn-sm btn-outline" onClick={() => navigate('/service-requests')}>View All</button>
          </div>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr><th>Number</th><th>Title</th><th>Priority</th><th>Status</th></tr>
              </thead>
              <tbody>
                {data.recentRequests.map(sr => (
                  <tr key={sr.id} className="clickable" onClick={() => navigate('/service-requests')}>
                    <td>{sr.number}</td>
                    <td>{sr.title}</td>
                    <td><span className={`badge badge-${sr.priority.toLowerCase()}`}>{sr.priority}</span></td>
                    <td><span className={`badge badge-${sr.status.toLowerCase()}`}>{sr.status.replace('_', ' ')}</span></td>
                  </tr>
                ))}
                {data.recentRequests.length === 0 && (
                  <tr><td colSpan={4} style={{ textAlign: 'center', color: '#718096' }}>No requests</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
