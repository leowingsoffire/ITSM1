import { useEffect, useState } from 'react';
import { api } from '../api/client';

interface Incident {
  id: string;
  number: string;
  title: string;
  status: string;
  priority: string;
  createdAt: string;
  assignedTo?: { firstName: string; lastName: string } | null;
}

export function IncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/incidents')
      .then(({ data }) => setIncidents(data.data))
      .catch(() => setIncidents([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Incidents</h1>
        <button style={{ padding: '8px 16px', background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          + New Incident
        </button>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : incidents.length === 0 ? (
        <p style={{ color: '#666', marginTop: 24 }}>No incidents found. Create one to get started.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16, background: '#fff', borderRadius: 8 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #eee', textAlign: 'left' }}>
              <th style={{ padding: 12 }}>Number</th>
              <th style={{ padding: 12 }}>Title</th>
              <th style={{ padding: 12 }}>Status</th>
              <th style={{ padding: 12 }}>Priority</th>
              <th style={{ padding: 12 }}>Assigned To</th>
              <th style={{ padding: 12 }}>Created</th>
            </tr>
          </thead>
          <tbody>
            {incidents.map((inc) => (
              <tr key={inc.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: 12 }}>{inc.number}</td>
                <td style={{ padding: 12 }}>{inc.title}</td>
                <td style={{ padding: 12 }}>{inc.status}</td>
                <td style={{ padding: 12 }}>{inc.priority}</td>
                <td style={{ padding: 12 }}>
                  {inc.assignedTo ? `${inc.assignedTo.firstName} ${inc.assignedTo.lastName}` : '—'}
                </td>
                <td style={{ padding: 12 }}>{new Date(inc.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
