import { useId, useRef } from 'react';
import { Upload } from 'lucide-react';
import { Field } from './Form.jsx';
import { Button } from './Button.jsx';

const MB = 1024 * 1024;

export function formatFileSize(bytes) {
  if (bytes == null) return '';
  return bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * File picker with a visible button and the chosen file's name. Checks type
 * and size in the browser for quick feedback (the server checks again).
 * onChange receives (file, errorMessage).
 */
export function FileInput({ label, hint, error, accept, typeLabel = 'supported file', maxBytes, value, onChange, disabled, buttonLabel = 'Choose file', required, showName = true }) {
  const id = useId();
  const inputRef = useRef(null);
  const types = accept.split(',').map((t) => t.trim());
  const pick = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!types.includes(file.type)) return onChange(null, `Choose a ${typeLabel}.`);
    if (maxBytes && file.size > maxBytes) return onChange(null, `The file must be ${formatFileSize(maxBytes)} or smaller.`);
    return onChange(file, null);
  };
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id} required={required}>
      <div className="file-input">
        <input ref={inputRef} id={id} type="file" accept={accept} onChange={pick} disabled={disabled} className="visually-hidden" />
        <Button variant="secondary" size="sm" icon={Upload} disabled={disabled} onClick={() => inputRef.current && inputRef.current.click()}>{buttonLabel}</Button>
        {showName && <span className="file-input-name muted small">{value ? `${value.name} · ${formatFileSize(value.size)}` : 'No file chosen'}</span>}
      </div>
    </Field>
  );
}
