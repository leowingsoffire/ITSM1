interface PaginationProps {
  page: number;
  totalPages: number;
  total?: number;
  limit?: number;
  onPageChange: (page: number) => void;
  onLimitChange?: (limit: number) => void;
}

const LIMIT_OPTIONS = [10, 20, 50, 100];

export function Pagination({ page, totalPages, total, limit, onPageChange, onLimitChange }: PaginationProps) {
  if (totalPages <= 1 && !total) return null;

  const pages: (number | '...')[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push('...');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      pages.push(i);
    }
    if (page < totalPages - 2) pages.push('...');
    pages.push(totalPages);
  }

  const start = total ? (page - 1) * (limit || 20) + 1 : 0;
  const end = total ? Math.min(page * (limit || 20), total) : 0;

  return (
    <div className="pagination-container">
      <div className="pagination-meta">
        {total != null && (
          <span className="pagination-total">
            {start}–{end} of {total} items
          </span>
        )}
        {onLimitChange && (
          <div className="pagination-per-page">
            <span>Show</span>
            <select value={limit || 20} onChange={e => onLimitChange(Number(e.target.value))}>
              {LIMIT_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <span>per page</span>
          </div>
        )}
      </div>
      {totalPages > 1 && (
        <div className="pagination">
          <button
            className="pagination-btn"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            ← Prev
          </button>
          <div className="pagination-pages">
            {pages.map((p, i) =>
              p === '...' ? (
                <span key={`dots-${i}`} className="pagination-dots">…</span>
              ) : (
                <button
                  key={p}
                  className={`pagination-page ${p === page ? 'active' : ''}`}
                  onClick={() => onPageChange(p)}
                >
                  {p}
                </button>
              )
            )}
          </div>
          <button
            className="pagination-btn"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
