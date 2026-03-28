export function SkeletonTable({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--color-border)' }}>
        <div style={{ display: 'flex', gap: 16 }}>
          {Array.from({ length: cols }).map((_, i) => (
            <div key={i} className="skeleton skeleton-text" style={{ width: `${60 + Math.random() * 60}px`, height: 11 }} />
          ))}
        </div>
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="skeleton-row">
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="skeleton skeleton-text" style={{ width: `${50 + Math.random() * 80}px`, marginBottom: 0 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonStats({ count = 6 }: { count?: number }) {
  return (
    <div className="stats-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-stat">
          <div className="skeleton skeleton-text" />
          <div className="skeleton skeleton-text" />
          <div className="skeleton skeleton-text" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="kb-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <div className="skeleton" style={{ width: 60, height: 20, borderRadius: 10 }} />
            <div className="skeleton" style={{ width: 80, height: 20, borderRadius: 10 }} />
          </div>
          <div className="skeleton skeleton-text" style={{ width: '80%', height: 16 }} />
          <div className="skeleton skeleton-text" style={{ width: '100%' }} />
          <div className="skeleton skeleton-text" />
        </div>
      ))}
    </div>
  );
}
