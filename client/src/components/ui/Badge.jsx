import { humanize } from '../../utils/format.js';

const TONES = {
  ACTIVE: 'success', COMPLETED: 'success', RECEIVED: 'success', PAID: 'success', AVAILABLE: 'success', PUBLISHED: 'success',
  DRAFT: 'neutral', INACTIVE: 'neutral', ARCHIVED: 'neutral', CANCELLED: 'neutral',
  PENDING: 'info', REQUESTED: 'info', APPROVED: 'info', IN_TRANSIT: 'primary', PARTIALLY_RECEIVED: 'warning',
  PARTIALLY_PAID: 'warning', UNPAID: 'warning', LOW_STOCK: 'warning', EXPIRING_SOON: 'warning', WARNING: 'warning',
  VOIDED: 'danger', OUT_OF_STOCK: 'danger', EXPIRED: 'danger', CRITICAL: 'danger', HIGH: 'danger',
};

export function Badge({ tone = 'neutral', children }) {
  return <span className={`badge ${tone !== 'neutral' ? `badge-${tone}` : ''}`}>{children}</span>;
}

/** A status code rendered with a consistent color and readable label. */
export function StatusBadge({ status, label }) {
  if (!status) return null;
  return <Badge tone={TONES[status] || 'neutral'}>{label || humanize(status)}</Badge>;
}
