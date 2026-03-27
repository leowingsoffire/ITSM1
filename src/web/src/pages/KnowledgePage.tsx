import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/client';

interface Article {
  id: string;
  title: string;
  content: string;
  status: string;
  category: string | null;
  tags: string | null;
  viewCount: number;
  publishedAt: string | null;
  createdAt: string;
  author?: { firstName: string; lastName: string } | null;
}

const KB_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];

export function KnowledgePage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState<Article | null>(null);
  const [showEdit, setShowEdit] = useState<Article | null>(null);

  function fetchData() {
    const params: Record<string, string> = {};
    if (search) params.search = search;
    if (filterStatus) params.status = filterStatus;
    api.get('/knowledge', { params })
      .then(({ data }) => setArticles(data.data))
      .catch(() => setArticles([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchData(); }, [search, filterStatus]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Knowledge Base</h1>
          <p className="page-subtitle">Solutions, guides, and documentation</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Article</button>
      </div>

      <div className="filter-bar">
        <input className="form-input search-input" placeholder="Search articles..." value={search} onChange={e => setSearch(e.target.value)} />
        <select className="form-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {KB_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="loading-spinner">Loading...</div>
      ) : articles.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">📚</div>
            <div className="empty-state-text">No articles found</div>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>Write First Article</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {articles.map(a => (
            <div key={a.id} className="card" style={{ cursor: 'pointer' }} onClick={() => setShowDetail(a)}>
              <div className="card-body" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span className={`badge badge-${a.status.toLowerCase()}`}>{a.status}</span>
                    {a.category && <span className="text-xs text-muted">{a.category}</span>}
                  </div>
                  <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, margin: '4px 0' }}>{a.title}</h3>
                  <p className="text-sm text-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 600 }}>
                    {a.content.substring(0, 150)}...
                  </p>
                </div>
                <div style={{ textAlign: 'right', minWidth: 100 }}>
                  <div className="text-sm">{a.viewCount} views</div>
                  <div className="text-xs text-muted">{a.author ? `${a.author.firstName} ${a.author.lastName}` : ''}</div>
                  <div className="text-xs text-muted">{new Date(a.createdAt).toLocaleDateString()}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && <ArticleFormModal onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); fetchData(); }} />}
      {showDetail && <ArticleDetailModal article={showDetail} onClose={() => setShowDetail(null)} onEdit={() => { setShowEdit(showDetail); setShowDetail(null); }} onRefresh={fetchData} />}
      {showEdit && <ArticleFormModal article={showEdit} onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); fetchData(); }} />}
    </div>
  );
}

function ArticleFormModal({ article, onClose, onSaved }: { article?: Article; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    title: article?.title || '',
    content: article?.content || '',
    category: article?.category || '',
    tags: article?.tags || '',
    status: article?.status || 'DRAFT',
  });
  const [saving, setSaving] = useState(false);

  function set(field: string, value: string) { setForm(f => ({ ...f, [field]: value })); }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, category: form.category || undefined, tags: form.tags || undefined };
      if (article) {
        await api.patch(`/knowledge/${article.id}`, payload);
      } else {
        await api.post('/knowledge', payload);
      }
      onSaved();
    } catch {
      alert('Failed to save article');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{article ? 'Edit Article' : 'New Article'}</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Title *</label>
              <input className="form-input" value={form.title} onChange={e => set('title', e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Content *</label>
              <textarea className="form-textarea" value={form.content} onChange={e => set('content', e.target.value)} required style={{ minHeight: 200 }} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Category</label>
                <input className="form-input" value={form.category} onChange={e => set('category', e.target.value)} placeholder="e.g. How-To, Troubleshooting" />
              </div>
              <div className="form-group">
                <label className="form-label">Status</label>
                <select className="form-select" value={form.status} onChange={e => set('status', e.target.value)}>
                  {KB_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Tags (comma-separated)</label>
              <input className="form-input" value={form.tags} onChange={e => set('tags', e.target.value)} placeholder="e.g. email, outlook, troubleshooting" />
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : article ? 'Update' : 'Create Article'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function ArticleDetailModal({ article, onClose, onEdit, onRefresh }: { article: Article; onClose: () => void; onEdit: () => void; onRefresh: () => void }) {
  async function updateStatus(status: string) {
    try {
      await api.patch(`/knowledge/${article.id}`, { status });
      onRefresh();
      onClose();
    } catch {}
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span className={`badge badge-${article.status.toLowerCase()}`}>{article.status}</span>
              <span className="text-xs text-muted">{article.viewCount} views</span>
            </div>
            <h2 className="modal-title">{article.title}</h2>
          </div>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="detail-grid" style={{ marginBottom: 16 }}>
            <div><div className="detail-label">Category</div><div className="detail-value">{article.category || '—'}</div></div>
            <div><div className="detail-label">Author</div><div className="detail-value">{article.author ? `${article.author.firstName} ${article.author.lastName}` : '—'}</div></div>
            <div><div className="detail-label">Created</div><div className="detail-value">{new Date(article.createdAt).toLocaleString()}</div></div>
            <div><div className="detail-label">Published</div><div className="detail-value">{article.publishedAt ? new Date(article.publishedAt).toLocaleString() : 'Not published'}</div></div>
          </div>
          {article.tags && <div style={{ marginBottom: 16 }}>
            <div className="detail-label">Tags</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {article.tags.split(',').map((t, i) => <span key={i} className="badge" style={{ background: '#edf2f7', color: '#4a5568' }}>{t.trim()}</span>)}
            </div>
          </div>}
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, fontSize: 'var(--text-sm)' }}>
            {article.content}
          </div>
          <div className="btn-group" style={{ marginTop: 24 }}>
            <button className="btn btn-outline" onClick={onEdit}>Edit</button>
            {article.status === 'DRAFT' && <button className="btn btn-success" onClick={() => updateStatus('PUBLISHED')}>Publish</button>}
            {article.status === 'PUBLISHED' && <button className="btn btn-outline" onClick={() => updateStatus('ARCHIVED')}>Archive</button>}
            {article.status === 'ARCHIVED' && <button className="btn btn-accent" onClick={() => updateStatus('PUBLISHED')}>Republish</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
