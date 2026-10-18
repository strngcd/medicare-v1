import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useDebouncedValue } from '../../hooks/useApi.js';
import { IconButton } from '../ui/index.js';

const ROUTES = {
  MEDICINE: (id) => `/medicines/${id}`,
  SALE: (id) => `/sales/${id}`,
  SUPPLIER: (id) => `/suppliers/${id}`,
  PURCHASE: (id) => `/purchases/${id}`,
  TRANSFER: (id) => `/transfers/${id}`,
  STAFF: (id) => `/staff/${id}`,
};

/** Header search across permitted entities (server filters by permission and branch). */
export function GlobalSearch({ mobileVisible, onClose }) {
  const navigate = useNavigate();
  const { branchParam } = useAuth();
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ loading: false, groups: [], error: null });
  const debounced = useDebouncedValue(term.trim(), 250);
  const ref = useRef(null);
  const inputRef = useRef(null);

  // Opening the phone search focuses the field so the keyboard comes up at once.
  useEffect(() => {
    if (mobileVisible && inputRef.current) inputRef.current.focus();
  }, [mobileVisible]);

  const close = () => {
    setOpen(false);
    setTerm('');
    if (onClose) onClose();
  };

  useEffect(() => {
    if (debounced.length < 2) {
      setState({ loading: false, groups: [], error: null });
      return undefined;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    api.get('/search', { q: debounced, branchId: branchParam })
      .then((res) => !cancelled && setState({ loading: false, groups: res.data.groups, error: null }))
      .catch((error) => !cancelled && setState({ loading: false, groups: [], error }));
    return () => {
      cancelled = true;
    };
  }, [debounced, branchParam]);

  useEffect(() => {
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const go = (type, id) => {
    setOpen(false);
    setTerm('');
    if (onClose) onClose();
    navigate(ROUTES[type](id));
  };

  return (
    <div className={`topbar-search ${mobileVisible ? 'mobile-visible' : ''}`} ref={ref}>
      <div className="input-with-icon">
        <Search aria-hidden="true" />
        <input
          ref={inputRef}
          className="input"
          type="search"
          placeholder="Search medicines, receipts, suppliers, staff…"
          aria-label="Global search"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => e.key === 'Escape' && close()}
        />
      </div>
      {onClose && <IconButton className="mobile-search-close" icon={X} label="Close search" onClick={close} />}
      {open && debounced.length >= 2 && (
        <div className="search-results" role="listbox">
          {state.loading && state.groups.length === 0 && <div className="search-result muted">Searching…</div>}
          {state.error && <div className="search-result danger-text">{state.error.message}</div>}
          {!state.loading && !state.error && state.groups.length === 0 && (
            <div className="search-result muted">No matches for “{debounced}”.</div>
          )}
          {state.groups.map((group) => (
            <div key={group.type}>
              <div className="search-group-label">{group.label}</div>
              {group.results.map((r) => (
                <a
                  key={r.id}
                  href={ROUTES[group.type](r.id)}
                  className="search-result"
                  onClick={(e) => {
                    e.preventDefault();
                    go(group.type, r.id);
                  }}
                >
                  <span className="title">{r.title}</span>
                  {r.subtitle && <span className="subtitle">{r.subtitle}</span>}
                </a>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
