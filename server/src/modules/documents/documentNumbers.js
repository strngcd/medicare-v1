const crypto = require('crypto');
const { query } = require('../../database/db');

const PREFIXES = Object.freeze({
  SALE: 'SAL',
  PURCHASE: 'PUR',
  REFUND: 'REF',
  TRANSFER: 'TRF',
  STOCK_ADJUSTMENT: 'STK',
});

/** Where each document type stores its number, used to rule out collisions. */
const NUMBER_COLUMNS = Object.freeze({
  SALE: ['sales', 'receipt_number'],
  PURCHASE: ['purchases', 'purchase_number'],
  REFUND: ['refunds', 'refund_number'],
  TRANSFER: ['transfers', 'transfer_number'],
  STOCK_ADJUSTMENT: ['inventory_adjustments', 'adjustment_number'],
});

// No 0/O, 1/I/L: codes are read aloud and typed in by staff.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 6;
const MAX_ATTEMPTS = 5;

function randomCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return code;
}

/**
 * Issues a random, non-sequential document number, e.g. SAL-7K3QX9.
 *
 * Numbers reveal nothing about business volume. 31^6 (~887M) codes per type
 * make collisions rare; an existing code is detected and redrawn.
 */
async function nextDocumentNumber(client, documentType) {
  const prefix = PREFIXES[documentType];
  if (!prefix) throw new Error(`Unknown document type: ${documentType}`);
  const [table, column] = NUMBER_COLUMNS[documentType];

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const candidate = `${prefix}-${randomCode()}`;
    const { rowCount } = await query(`SELECT 1 FROM ${table} WHERE ${column} = $1`, [candidate], client);
    if (rowCount === 0) return candidate;
  }
  throw new Error(`Could not allocate a unique ${documentType} number`);
}

/** Matches numbers issued by nextDocumentNumber. */
const DOCUMENT_NUMBER_PATTERN = new RegExp(`^[A-Z]{3}-[${ALPHABET}]{${CODE_LENGTH}}$`);

module.exports = { nextDocumentNumber, randomCode, PREFIXES, NUMBER_COLUMNS, DOCUMENT_NUMBER_PATTERN };
