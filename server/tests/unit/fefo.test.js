const { allocateFefo, validateManualAllocation } = require('../../src/modules/inventory/fefo');

const batches = [
  { batchId: 'late', expiryDate: '2027-06-01', available: 10 },
  { batchId: 'early', expiryDate: '2026-12-01', available: 3 },
  { batchId: 'middle', expiryDate: '2027-01-15', available: 5 },
];

describe('allocateFefo', () => {
  test('takes the earliest-expiring batch first', () => {
    expect(allocateFefo(batches, 2)).toEqual([{ batchId: 'early', quantity: 2 }]);
  });

  test('spills over to the next-expiring batches', () => {
    expect(allocateFefo(batches, 10)).toEqual([
      { batchId: 'early', quantity: 3 },
      { batchId: 'middle', quantity: 5 },
      { batchId: 'late', quantity: 2 },
    ]);
  });

  test('breaks expiry ties by batch age', () => {
    const tied = [
      { batchId: 'newer', expiryDate: '2027-01-01', createdAt: '2026-05-01', available: 5 },
      { batchId: 'older', expiryDate: '2027-01-01', createdAt: '2026-01-01', available: 5 },
    ];
    expect(allocateFefo(tied, 1)).toEqual([{ batchId: 'older', quantity: 1 }]);
  });

  test('skips empty batches', () => {
    expect(allocateFefo([{ batchId: 'a', expiryDate: '2026-01-01', available: 0 }, ...batches], 1)[0].batchId).toBe('early');
  });

  test('throws INSUFFICIENT_STOCK with details when stock is short', () => {
    expect(() => allocateFefo(batches, 19)).toThrow(expect.objectContaining({
      code: 'INSUFFICIENT_STOCK',
      details: { requested: 19, available: 18 },
    }));
  });
});

describe('validateManualAllocation', () => {
  test('accepts a valid override and merges duplicate lines', () => {
    expect(validateManualAllocation(batches, [
      { batchId: 'late', quantity: 2 },
      { batchId: 'late', quantity: 1 },
    ], 3)).toEqual([{ batchId: 'late', quantity: 3 }]);
  });

  test('rejects unknown/unsellable batches', () => {
    expect(() => validateManualAllocation(batches, [{ batchId: 'expired', quantity: 1 }], 1))
      .toThrow(expect.objectContaining({ code: 'BATCH_NOT_SELLABLE' }));
  });

  test('rejects allocations beyond a batch quantity', () => {
    expect(() => validateManualAllocation(batches, [{ batchId: 'early', quantity: 4 }], 4))
      .toThrow(expect.objectContaining({ code: 'INSUFFICIENT_STOCK' }));
  });

  test('rejects allocations that do not add up to the quantity', () => {
    expect(() => validateManualAllocation(batches, [{ batchId: 'late', quantity: 2 }], 3))
      .toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });
});
