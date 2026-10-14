const AppError = require('../../errors/AppError');
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
    expiryDate: expiryDate || NO_EXPIRY_DATE,
  };
}

module.exports = { NO_EXPIRY_DATE, resolveBatchIdentity };
