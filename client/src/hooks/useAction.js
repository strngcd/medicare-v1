import { useCallback, useState } from 'react';
import { useToast } from '../context/ToastContext.jsx';

/**
 * Runs a mutation with consistent UX: disables the trigger while running,
 * maps 422 field errors onto the form, shows non-field errors as a toast.
 */
export function useAction() {
  const toast = useToast();
  const [running, setRunning] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState(null);

  const run = useCallback(async (fn, { success, onError } = {}) => {
    setRunning(true);
    setFieldErrors({});
    setError(null);
    try {
      const result = await fn();
      if (success) toast.success(typeof success === 'function' ? success(result) : success);
      return result;
    } catch (err) {
      setError(err);
      const fields = err.fieldErrors || {};
      setFieldErrors(fields);
      if (onError) onError(err);
      else if (!Object.keys(fields).length) toast.error(err.message);
      else toast.error('Please correct the highlighted fields.');
      return undefined;
    } finally {
      setRunning(false);
    }
  }, [toast]);

  return { run, running, fieldErrors, error, setFieldErrors, clearErrors: () => setFieldErrors({}) };
}
