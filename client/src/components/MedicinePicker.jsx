import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../api/client.js';
import { useDebouncedValue } from '../hooks/useApi.js';

/**
 * Searchable medicine selector. `status` limits the list (e.g. ACTIVE for
 * purchases). Calls onSelect with the chosen medicine and clears itself.
 */
export function MedicinePicker({ onSelect, status = 'ACTIVE', placeholder = 'Search medicine to add…', exclude = [] }) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState({ loading: false, rows: [] });
  const debounced = useDebouncedValue(term.trim(), 250);
  const ref = useRef(null);

  useEffect(() => {
    if (debounced.length < 1) {
      setResults({ loading: false, rows: [] });
      return undefined;
    }
    let cancelled = false;
    setResults((r) => ({ ...r, loading: true }));
    api.get('/medicines', { search: debounced, status, limit: 10, sortBy: 'name', sortOrder: 'asc' })
      .then((res) => !cancelled && setResults({ loading: false, rows: res.data }))
      .catch(() => !cancelled && setResults({ loading: false, rows: [] }));
    return () => {
      cancelled = true;
    };
  }, [debounced, status]);

  useEffect(() => {
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const rows = results.rows.filter((m) => !exclude.includes(m.id));
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <div className="input-with-icon">
        <Search aria-hidden="true" />
        <input className="input" type="search" value={term} placeholder={placeholder} aria-label="Search medicine"
          onChange={(e) => { setTerm(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      </div>
      {open && debounced && (
        <div className="search-results">
          {results.loading && rows.length === 0 && <div className="search-result muted">Searching…</div>}
          {!results.loading && rows.length === 0 && <div className="search-result muted">No matching {status ? status.toLowerCase() : ''} medicines.</div>}
          {rows.map((m) => (
            <button key={m.id} type="button" className="search-result" style={{ border: 'none', background: 'none', width: '100%', textAlign: 'left' }}
              onClick={() => { onSelect(m); setTerm(''); setOpen(false); }}>
              <span className="title">{m.name}</span>
              <span className="subtitle">{[m.strength, m.dosageForm, m.packageSize].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
