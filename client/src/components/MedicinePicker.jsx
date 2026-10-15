import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../api/client.js';
import { useDebouncedValue } from '../hooks/useApi.js';
import { useCategories, toOptions } from '../hooks/useLookups.js';
import { SelectInput } from './ui/index.js';
import { PRODUCT_TYPE_OPTIONS } from '../utils/format.js';

/**
 * Searchable medicine selector. `status` limits the list (e.g. ACTIVE for
 * purchases). Calls onSelect with the chosen medicine and clears itself.
 * With `withFilters`, type and category selects narrow the list, and picking
 * a category lists its products without typing.
 */
export function MedicinePicker({ onSelect, status = 'ACTIVE', placeholder = 'Search medicine or cosmetic to add…', exclude = [], withFilters = false }) {
  const [term, setTerm] = useState('');
  const [productType, setProductType] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState({ loading: false, rows: [] });
  const debounced = useDebouncedValue(term.trim(), 250);
  const categories = useCategories(productType || undefined);
  const ref = useRef(null);
  const browsing = Boolean(categoryId);
  const active = debounced.length > 0 || browsing;

  useEffect(() => {
    if (!active) {
      setResults({ loading: false, rows: [] });
      return undefined;
    }
    let cancelled = false;
    setResults((r) => ({ ...r, loading: true }));
    api.get('/medicines', {
      search: debounced || undefined, status, productType: productType || undefined, categoryId: categoryId || undefined,
      limit: browsing ? 50 : 10, sortBy: 'name', sortOrder: 'asc',
    })
      .then((res) => !cancelled && setResults({ loading: false, rows: res.data }))
      .catch(() => !cancelled && setResults({ loading: false, rows: [] }));
    return () => {
      cancelled = true;
    };
  }, [debounced, status, productType, categoryId, active, browsing]);

  useEffect(() => {
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const rows = results.rows.filter((m) => !exclude.includes(m.id));
  const search = (
    <div style={{ position: 'relative' }} className={withFilters ? 'grow' : undefined}>
      <div className="input-with-icon">
        <Search aria-hidden="true" />
        <input className="input" type="search" value={term} placeholder={placeholder} aria-label="Search medicine"
          onChange={(e) => { setTerm(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      </div>
      {open && active && (
        <div className="search-results">
          {results.loading && rows.length === 0 && <div className="search-result muted">Searching…</div>}
          {!results.loading && rows.length === 0 && <div className="search-result muted">No matching {status ? status.toLowerCase() : ''} products.</div>}
          {rows.map((m) => (
            <button key={m.id} type="button" className="search-result" style={{ border: 'none', background: 'none', width: '100%', textAlign: 'left' }}
              onClick={() => { onSelect(m); setTerm(''); if (!browsing) setOpen(false); }}>
              <span className="title">{m.name}{m.strength ? ` ${m.strength}` : ''}</span>
              <span className="subtitle">{[m.productType === 'COSMETIC' && 'Cosmetic', m.brandName, m.dosageForm, m.packageSize, m.categoryName].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
  if (!withFilters) return <div ref={ref}>{search}</div>;
  return (
    <div ref={ref} className="row-wrap" style={{ alignItems: 'flex-end', gap: 12 }}>
      <SelectInput label="Type" value={productType} placeholder="All products" options={PRODUCT_TYPE_OPTIONS}
        onChange={(e) => { setProductType(e.target.value); setCategoryId(''); }} />
      <SelectInput label="Category" value={categoryId} placeholder="All categories" options={toOptions(categories.data)}
        onChange={(e) => { setCategoryId(e.target.value); setOpen(Boolean(e.target.value)); }} />
      <div className="field grow" style={{ minWidth: 220 }}>
        <span className="field-label">Search</span>
        {search}
      </div>
    </div>
  );
}
