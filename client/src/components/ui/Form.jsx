import { forwardRef, useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export function Field({ label, required, hint, error, children, className = '', htmlFor }) {
  return (
    <div className={`field ${className}`}>
      {label && (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
          {required && <span className="required" aria-hidden="true">*</span>}
        </label>
      )}
      {children}
      {error ? <span className="field-error" role="alert">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

function useFieldId(id) {
  const generated = useId();
  return id || generated;
}

export const TextInput = forwardRef(function TextInput({ label, required, hint, error, id, className, fieldClassName, ...rest }, ref) {
  const inputId = useFieldId(id);
  return (
    <Field label={label} required={required} hint={hint} error={error} htmlFor={inputId} className={fieldClassName}>
      <input ref={ref} id={inputId} className={`input ${className || ''}`} aria-invalid={error ? 'true' : undefined} required={required} {...rest} />
    </Field>
  );
});

/** Password field with a show/hide toggle, matching the sign-in page. */
export const PasswordInput = forwardRef(function PasswordInput({ label, required, hint, error, id, className, fieldClassName, ...rest }, ref) {
  const inputId = useFieldId(id);
  const [visible, setVisible] = useState(false);
  return (
    <Field label={label} required={required} hint={hint} error={error} htmlFor={inputId} className={fieldClassName}>
      <div className="input-with-action">
        <input ref={ref} id={inputId} className={`input ${className || ''}`} aria-invalid={error ? 'true' : undefined} required={required} {...rest} type={visible ? 'text' : 'password'} />
        <button type="button" className="icon-btn input-action" onClick={() => setVisible((v) => !v)} aria-label={visible ? 'Hide password' : 'Show password'}>
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
      </div>
    </Field>
  );
});

export function SelectInput({ label, required, hint, error, id, options, placeholder, fieldClassName, ...rest }) {
  const inputId = useFieldId(id);
  return (
    <Field label={label} required={required} hint={hint} error={error} htmlFor={inputId} className={fieldClassName}>
      <select id={inputId} className="select" aria-invalid={error ? 'true' : undefined} required={required} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
        ))}
      </select>
    </Field>
  );
}

export function TextArea({ label, required, hint, error, id, fieldClassName, ...rest }) {
  const inputId = useFieldId(id);
  return (
    <Field label={label} required={required} hint={hint} error={error} htmlFor={inputId} className={fieldClassName}>
      <textarea id={inputId} className="textarea" aria-invalid={error ? 'true' : undefined} required={required} {...rest} />
    </Field>
  );
}

export function Checkbox({ label, ...rest }) {
  return (
    <label className="checkbox">
      <input type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
}
