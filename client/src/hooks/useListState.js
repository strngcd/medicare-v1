import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * List page state (page, limit, sort, filters) kept in the URL so that
 * filtered views can be bookmarked and survive reloads.
 */
export function useListState(defaults = {}) {
  const [params, setParams] = useSearchParams();
  const { preferences } = useAuth();
  const defaultLimit = (preferences && preferences.pageSize) || 25;

  const state = useMemo(() => {
    const values = { ...defaults };
    for (const [key, value] of params.entries()) values[key] = value;
    values.page = Number(values.page || 1);
    values.limit = Number(values.limit || defaultLimit);
    return values;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, defaultLimit]);

  const update = useCallback((changes, { resetPage = true } = {}) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(changes)) {
        if (value === undefined || value === null || value === '') next.delete(key);
        else next.set(key, String(value));
      }
      if (resetPage && !('page' in changes)) next.delete('page');
      return next;
    }, { replace: true });
  }, [setParams]);

  const filterKeys = Object.keys(state).filter((k) => !['page', 'limit', 'sortBy', 'sortOrder', 'tab'].includes(k) && state[k] !== defaults[k]);
  const clear = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams]);

  return { state, update, clear, hasFilters: filterKeys.length > 0 };
}
