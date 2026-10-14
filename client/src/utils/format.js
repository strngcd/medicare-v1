/**
 * Display formatting only. Money values arrive from the API as decimal
 * strings; they are never used for authoritative calculations here.
 */
let currencyCode = 'ETB';

export function setCurrency(code) {
  currencyCode = code || 'ETB';
}

export function formatMoney(value, { withCurrency = true } = {}) {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (Number.isNaN(number)) return '—';
  const text = number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return withCurrency ? `${currencyCode} ${text}` : text;
}

export function formatNumber(value) {
  if (value === null || value === undefined) return '—';
  return Number(value).toLocaleString('en-US');
}

const dateFormatter = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

/** 'YYYY-MM-DD' calendar dates are formatted without time-zone shifts. */
/** Stored expiry of products sold without one (see server batchIdentity). */
export const NO_EXPIRY_DATE = '9999-12-31';

export function formatDate(value) {
  if (!value) return '—';
  if (value === NO_EXPIRY_DATE) return 'No expiry';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return dateFormatter.format(new Date(y, m - 1, d));
  }
  return dateFormatter.format(new Date(value));
}

export function formatDateTime(value) {
  return value ? dateTimeFormatter.format(new Date(value)) : '—';
}

export function humanize(code) {
  if (!code) return '';
  return code.toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
}

/** Today's date in the browser's local calendar as YYYY-MM-DD. */
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const PRODUCT_TYPE_OPTIONS = [
  { value: 'MEDICINE', label: 'Medicines' },
  { value: 'COSMETIC', label: 'Cosmetics' },
];
