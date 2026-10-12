import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, BookOpen } from 'lucide-react';
import { api } from '../../api/client.js';
import { useApi, useDebouncedValue } from '../../hooks/useApi.js';
import { PageHeader, Panel, ErrorState, SkeletonRows, EmptyState } from '../../components/ui/index.js';

export default function HelpCenterPage() {
  const [term, setTerm] = useState('');
  const query = useDebouncedValue(term.trim(), 300);
  const list = useApi(() => api.get('/help').then((r) => r.data), []);
  const search = useApi(() => api.get('/help/search', { q: query }).then((r) => r.data), [query], { enabled: query.length >= 2 });

  return (
    <div className="stack">
      <PageHeader title="Help center" description="How Medicar works, step by step." />
      <div className="input-with-icon" style={{ maxWidth: 520 }}>
        <Search aria-hidden="true" />
        <input className="input" type="search" placeholder="Search help, e.g. “refund” or “FEFO”" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Search help" />
      </div>

      {query.length >= 2 ? (
        <Panel title={`Results for “${query}”`} flush>
          {search.loading && !search.data && <SkeletonRows rows={3} columns={1} />}
          {search.error && <ErrorState error={search.error} onRetry={search.reload} />}
          {search.data && search.data.length === 0 && <EmptyState title="No articles match" message="Try another word, or browse the categories below." />}
          {search.data && search.data.map((a) => (
            <Link key={a.id} to={`/help/${a.slug}`} className="search-result" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <span className="title">{a.title}</span>
              <span className="subtitle">{a.excerpt || a.summary}</span>
            </Link>
          ))}
        </Panel>
      ) : null}

      {list.error && <Panel><ErrorState error={list.error} onRetry={list.reload} /></Panel>}
      {!list.data && !list.error && <Panel><SkeletonRows rows={6} columns={2} /></Panel>}
      {list.data && (
        <div className="grid-2">
          {list.data.categories.map((category) => (
            <Panel key={category.code} title={category.label}>
              <div className="stack-sm">
                {category.articles.map((a) => (
                  <Link key={a.id} to={`/help/${a.slug}`} className="row" style={{ alignItems: 'flex-start' }}>
                    <BookOpen size={16} style={{ marginTop: 2, flexShrink: 0 }} aria-hidden="true" />
                    <span className="stack-sm" style={{ gap: 2 }}>
                      <span style={{ fontWeight: 500 }}>{a.title}</span>
                      <span className="small muted">{a.summary}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
