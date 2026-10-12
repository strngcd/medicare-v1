import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Loads data and tracks loading / error state. Re-runs when `deps` change.
 * Responses from superseded requests are ignored so fast filter changes never
 * show stale results.
 */
export function useApi(fetcher, deps = [], { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: enabled, loaded: false });
  const requestId = useRef(0);

  const load = useCallback(async ({ silent = false } = {}) => {
    const id = ++requestId.current;
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const result = await fetcher();
      if (id === requestId.current) setState({ data: result, error: null, loading: false, loaded: true });
    } catch (error) {
      if (id === requestId.current) setState((s) => ({ ...s, error, loading: false, loaded: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (enabled) load();
  }, [load, enabled]);

  return {
    ...state,
    reload: load,
    setData: (updater) => setState((s) => ({ ...s, data: typeof updater === 'function' ? updater(s.data) : updater })),
  };
}

/** Periodically refreshes in the background (light polling, no WebSockets). */
export function usePolling(callback, intervalMs, enabled = true) {
  const saved = useRef(callback);
  saved.current = callback;
  useEffect(() => {
    if (!enabled) return undefined;
    const tick = () => {
      if (document.visibilityState === 'visible') saved.current();
    };
    const timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, enabled]);
}

export function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
