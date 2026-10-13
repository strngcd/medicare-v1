import { formatDateTime, humanize } from '../../utils/format.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$|^[A-Z]{4,}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** amountPaid → "Amount paid" */
export function fieldLabel(key) {
  const words = String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function isEmpty(value) {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

function Scalar({ value }) {
  if (isEmpty(value)) return <span className="subtle">—</span>;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') {
    if (UUID.test(value)) return <span className="mono" title={value}>{value.slice(0, 8)}…</span>;
    if (CODE.test(value)) return humanize(value);
    if (ISO_TIMESTAMP.test(value)) return formatDateTime(value);
  }
  return String(value);
}

/** Renders any audit value: scalars inline, objects as label/value lists, lists of objects as small tables. */
export function AuditValue({ value }) {
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every((v) => v && typeof v === 'object' && !Array.isArray(v))) {
      const keys = [...new Set(value.flatMap((v) => Object.keys(v)))];
      return (
        <table className="audit-subtable">
          <thead><tr>{keys.map((k) => <th key={k}>{fieldLabel(k)}</th>)}</tr></thead>
          <tbody>{value.map((row, i) => <tr key={i}>{keys.map((k) => <td key={k}><Scalar value={row[k]} /></td>)}</tr>)}</tbody>
        </table>
      );
    }
    if (value.length === 0) return <span className="subtle">—</span>;
    return value.map((v, i) => <span key={i}>{i > 0 && ', '}<Scalar value={v} /></span>);
  }
  if (value && typeof value === 'object') {
    return (
      <dl className="audit-sublist">
        {Object.entries(value).map(([k, v]) => (
          <div key={k}><dt>{fieldLabel(k)}</dt><dd><AuditValue value={v} /></dd></div>
        ))}
      </dl>
    );
  }
  return <Scalar value={value} />;
}

/**
 * Field-by-field comparison of an audit entry's previous and new values.
 * Changed fields are highlighted; entries with only one side (creations,
 * exports) show a single value column.
 */
export function AuditChanges({ before, after }) {
  const prev = before || {};
  const next = after || {};
  const keys = [...new Set([...Object.keys(prev), ...Object.keys(next)])];
  if (keys.length === 0) return <p className="muted">No field details were recorded for this action.</p>;

  const hasBefore = Object.keys(prev).length > 0;
  const hasAfter = Object.keys(next).length > 0;
  const compare = hasBefore && hasAfter;

  return (
    <div className="table-wrap">
      <table className="table audit-changes">
        <thead>
          <tr>
            <th>Field</th>
            {compare ? <><th>Before</th><th>After</th></> : <th>{hasBefore ? 'Previous value' : 'Value'}</th>}
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => {
            const changed = compare && JSON.stringify(prev[key]) !== JSON.stringify(next[key]);
            return (
              <tr key={key} className={changed ? 'changed' : undefined}>
                <th scope="row">{fieldLabel(key)}</th>
                {compare ? (
                  <>
                    <td className={changed && key in prev ? 'before' : undefined}>{key in prev ? <AuditValue value={prev[key]} /> : <span className="subtle">—</span>}</td>
                    <td className={changed && key in next ? 'after' : undefined}>{key in next ? <AuditValue value={next[key]} /> : <span className="subtle">—</span>}</td>
                  </>
                ) : (
                  <td><AuditValue value={hasBefore ? prev[key] : next[key]} /></td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
