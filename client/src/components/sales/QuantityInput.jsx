import { useEffect, useState } from 'react';

/**
 * Typed cart quantity. Keeps what the cashier types (an empty box, or "1"
 * on the way to "12") and applies it as soon as it is a valid amount; limits
 * are enforced when leaving the box or pressing Enter, never mid-typing.
 */
export function QuantityInput({ line, onChange, onTooMany }) {
  const [draft, setDraft] = useState(String(line.quantity));
  useEffect(() => setDraft(String(line.quantity)), [line.quantity]);

  const type = (e) => {
    const value = e.target.value.replace(/\D/g, '');
    setDraft(value);
    const n = Number(value);
    if (value && n >= 1 && n <= line.available) onChange(n);
  };
  const commit = () => {
    const n = Number(draft);
    if (!draft || n < 1) {
      setDraft(String(line.quantity));
    } else if (n > line.available) {
      onTooMany(line);
      onChange(line.available);
      setDraft(String(line.available));
    }
  };
  return (
    <input value={draft} inputMode="numeric" aria-label={`Quantity of ${line.name}`}
      onChange={type} onBlur={commit} onFocus={(e) => e.target.select()}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
  );
}
