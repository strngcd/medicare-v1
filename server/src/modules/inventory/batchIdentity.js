const AppError = require('../../errors/AppError');
const { query } = require('../../database/db');
const { randomCode } = require('../documents/documentNumbers');

/**
 * Stored expiry for products sold without one (some cosmetics). A far-future
 * date keeps every sellable / FEFO / expiry-alert rule working unchanged:
 * such batches sell after dated stock and never expire. The database rejects
 * it for medicines.
 */
const NO_EXPIRY_DATE = '9999-12-31';

/**
 * Resolves the batch number and expiry date for incoming stock.
 * Medicines need both. Cosmetics may leave the expiry date empty (stored as
 * NO_EXPIRY_DATE) and the batch number empty (a LOT- code is generated).
 * `field` maps a field name to its error path (e.g. receiving line paths).
 */
function resolveBatchIdentity(productType, { batchNumber, expiryDate }, field = (name) => name) {
  const cosmetic = productType === 'COSMETIC';
  if (!expiryDate && !cosmetic) {
    throw AppError.validation('Medicines need an expiry date.', { fields: { [field('expiryDate')]: 'Required for medicines.' } });
  }
  if (!batchNumber && !cosmetic) {
    throw AppError.validation('Medicines need a batch number.', { fields: { [field('batchNumber')]: 'Required for medicines.' } });
  }
  return {
    batchNumber: batchNumber || `LOT-${randomCode()}`,
    generated: !batchNumber,
    expiryDate: expiryDate || NO_EXPIRY_DATE,
  };
}

const MAX_LOT_ATTEMPTS = 5;

/**
 * A generated LOT- number must be new for the product: reusing an existing
 * lot would merge unrelated stock into it. Redraws on collision. Typed batch
 * numbers are returned unchanged (reusing those is deliberate).
 */
async function ensureNewLot(client, medicineId, identity) {
  if (!identity.generated) return identity.batchNumber;
  let candidate = identity.batchNumber;
  for (let attempt = 0; attempt < MAX_LOT_ATTEMPTS; attempt += 1) {
    const { rowCount } = await query('SELECT 1 FROM batches WHERE medicine_id = $1 AND batch_number = $2', [medicineId, candidate], client);
    if (rowCount === 0) return candidate;
    candidate = `LOT-${randomCode()}`;
  }
  throw new Error('Could not allocate a unique lot number');
}

module.exports = { NO_EXPIRY_DATE, resolveBatchIdentity, ensureNewLot };
