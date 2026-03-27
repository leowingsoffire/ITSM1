export function DashboardPage() {
  return (
    <div>
      <h1>Dashboard</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginTop: 24 }}>
        <DashboardCard title="Open Incidents" value="—" color="#e74c3c" />
        <DashboardCard title="Pending Requests" value="—" color="#f39c12" />
        <DashboardCard title="Resolved Today" value="—" color="#27ae60" />
        <DashboardCard title="SLA Breaches" value="—" color="#8e44ad" />
      </div>
      <p style={{ marginTop: 32, color: '#666' }}>
        Connect to the API and database to see live data.
      </p>
    </div>
  );
}

function DashboardCard({ title, value, color }: { title: string; value: string; color: string }) {
  return (
    <div style={{ background: '#fff', borderRadius: 8, padding: 20, borderLeft: `4px solid ${color}` }}>
      <p style={{ margin: 0, color: '#666', fontSize: 14 }}>{title}</p>
      <p style={{ margin: '8px 0 0', fontSize: 28, fontWeight: 'bold' }}>{value}</p>
    </div>
  );
}
