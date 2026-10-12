const AppError = require('../../errors/AppError');

/**
 * First-Expired, First-Out allocation.
 *
 * @param {{batchId: string, expiryDate: string, createdAt?: string|Date, available: number}[]} batches
 *        sellable (non-expired) batches; order does not matter
 * @param {number} quantity units required
 * @returns {{batchId: string, quantity: number}[]}
 */
function allocateFefo(batches, quantity) {
  const ordered = [...batches]
    .filter((b) => b.available > 0)
    .sort((a, b) => {
      if (a.expiryDate !== b.expiryDate) return a.expiryDate < b.expiryDate ? -1 : 1;
      return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
    });

  const allocations = [];
  let remaining = quantity;
  for (const batch of ordered) {
    if (remaining === 0) break;
    const take = Math.min(batch.available, remaining);
    allocations.push({ batchId: batch.batchId, quantity: take });
    remaining -= take;
  }

  if (remaining > 0) {
    const available = quantity - remaining;
    throw AppError.conflict('INSUFFICIENT_STOCK', 'Insufficient stock for this medicine.', {
      requested: quantity,
      available,
    });
  }
  return allocations;
}

/**
 * Validates a manual (override) allocation against the sellable batches.
 */
function validateManualAllocation(batches, requested, quantity) {
  const byId = new Map(batches.map((b) => [b.batchId, b]));
  const merged = new Map();
  for (const line of requested) {
    merged.set(line.batchId, (merged.get(line.batchId) || 0) + line.quantity);
  }
  let total = 0;
  for (const [batchId, qty] of merged) {
    const batch = byId.get(batchId);
    if (!batch) {
      throw AppError.conflict('BATCH_NOT_SELLABLE', 'A selected batch is expired, unavailable or belongs to another medicine.', {
        batchId,
      });
    }
    if (qty > batch.available) {
      throw AppError.conflict('INSUFFICIENT_STOCK', 'Insufficient stock in the selected batch.', {
        batchId,
        requested: qty,
        available: batch.available,
      });
    }
    total += qty;
  }
  if (total !== quantity) {
    throw AppError.validation('Batch allocation must add up to the sold quantity.', { requested: quantity, allocated: total });
  }
  return [...merged].map(([batchId, qty]) => ({ batchId, quantity: qty }));
}

module.exports = { allocateFefo, validateManualAllocation };
