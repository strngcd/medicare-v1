const { query } = require('../../database/db');
const { businessYear } = require('../../utils/time');

const PREFIXES = Object.freeze({
  SALE: 'SAL',
  PURCHASE: 'PUR',
  REFUND: 'REF',
  TRANSFER: 'TRF',
  STOCK_ADJUSTMENT: 'STK',
});

/**
 * Allocates the next document number, e.g. SAL-2026-000042.
 *
 * Must be called inside the business transaction: the upsert locks the
 * (type, year) counter row until COMMIT, so concurrent callers queue up and
 * a rolled-back transaction releases its number without leaving a gap.
 */
async function nextDocumentNumber(client, sequenceType) {
  const prefix = PREFIXES[sequenceType];
  if (!prefix) throw new Error(`Unknown document sequence type: ${sequenceType}`);
  const year = businessYear();

  const { rows } = await query(
    `INSERT INTO document_sequences (sequence_type, year, last_value)
     VALUES ($1, $2, 1)
     ON CONFLICT (sequence_type, year)
       DO UPDATE SET last_value = document_sequences.last_value + 1, updated_at = now()
     RETURNING last_value`,
    [sequenceType, year],
    client,
  );
  return `${prefix}-${year}-${String(rows[0].last_value).padStart(6, '0')}`;
}

module.exports = { nextDocumentNumber, PREFIXES };
