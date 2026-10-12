import { forwardRef, useId } from 'react';

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
