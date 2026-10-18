const { query } = require('../../database/db');

/**
 * Turns the filters of an export request into readable lines ("Branch: Bole",
 * "Staff: Abebe Kebede") so a downloaded file says what it contains. IDs are
 * resolved to names; the report itself has already checked branch access.
 */

const LOOKUPS = {
  branchId: { label: 'Branch', sql: 'SELECT name FROM branches WHERE id = $1' },
  staffId: { label: 'Staff', sql: 'SELECT full_name AS name FROM users WHERE id = $1' },
  medicineId: { label: 'Product', sql: 'SELECT name FROM medicines WHERE id = $1' },
  categoryId: { label: 'Category', sql: 'SELECT name FROM categories WHERE id = $1' },
  supplierId: { label: 'Supplier', sql: 'SELECT company_name AS name FROM suppliers WHERE id = $1' },
  saleId: { label: 'Sale', sql: 'SELECT receipt_number AS name FROM sales WHERE id = $1' },
};

const ENUMS = {
  productType: { label: 'Products', values: { MEDICINE: 'Medicines', COSMETIC: 'Cosmetics' } },
  paymentMethod: { label: 'Payment' },
  status: { label: 'Status' },
  paymentStatus: { label: 'Payment status' },
  movementType: { label: 'Type' },
  reason: { label: 'Reason' },
};

const TEXT = {
  search: 'Search',
  receiptNumber: 'Receipt',
  minAmount: 'Minimum amount',
  maxAmount: 'Maximum amount',
};

const humanize = (value) => String(value).toLowerCase().split('_').join(' ').replace(/^./, (c) => c.toUpperCase());

async function lookupName(key, id) {
  const { rows } = await query(LOOKUPS[key].sql, [id]);
  return rows[0] ? rows[0].name : 'Unknown';
}

/** Returns [{ label, value }] in a stable order; branch scope is always stated. */
async function describeFilters(auth, filters) {
  const lines = [];
  if (filters.branchId) {
    lines.push({ label: 'Branch', value: await lookupName('branchId', filters.branchId) });
  } else {
    lines.push({ label: 'Branch', value: auth.isOwner ? 'All branches' : 'All my branches' });
  }
  for (const key of Object.keys(LOOKUPS)) {
    if (key !== 'branchId' && filters[key]) lines.push({ label: LOOKUPS[key].label, value: await lookupName(key, filters[key]) });
  }
  for (const [key, { label, values }] of Object.entries(ENUMS)) {
    if (filters[key]) lines.push({ label, value: (values && values[filters[key]]) || humanize(filters[key]) });
  }
  for (const [key, label] of Object.entries(TEXT)) {
    if (filters[key]) lines.push({ label, value: String(filters[key]) });
  }
  return lines;
}

/** A filename-safe slug of the branch name, or '' for all branches. */
function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

module.exports = { describeFilters, slug };
