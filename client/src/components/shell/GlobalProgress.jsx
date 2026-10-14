import { useEffect, useState } from 'react';
import { onActivity } from '../../api/client.js';

const BAR_DELAY_MS = 200;
const SPINNER_DELAY_MS = 700;

/**
 * Global loading feedback for any in-flight API request: a thin bar across
 * the top after a short delay, and a "Loading…" spinner when the request is
 * slow. Quick requests show nothing, so fast networks don't flicker.
 */
export function GlobalProgress() {
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);

  useEffect(() => onActivity((count) => setBusy(count > 0)), []);

  useEffect(() => {
    if (!busy) {
      setStage(0);
      return undefined;
    }
    const bar = setTimeout(() => setStage(1), BAR_DELAY_MS);
    const spinner = setTimeout(() => setStage(2), SPINNER_DELAY_MS);
    return () => {
      clearTimeout(bar);
      clearTimeout(spinner);
    };
  }, [busy]);

  if (stage === 0) return null;
  return (
    <>
      <div className="global-progress" role="progressbar" aria-label="Loading" />
      {stage === 2 && (
        <div className="global-spinner" role="status">
          <span className="spinner" aria-hidden="true" /> Loading…
        </div>
      )}
    </>
  );
}

