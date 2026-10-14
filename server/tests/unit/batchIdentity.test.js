const { resolveBatchIdentity, ensureNewLot, NO_EXPIRY_DATE } = require('../../src/modules/inventory/batchIdentity');

/** A stand-in transaction client answering "does this lot exist?" from a list. */
function fakeClient(existing) {
  const asked = [];
  return {
    asked,
    query: async (text, [, batchNumber]) => {
      asked.push(batchNumber);
      return { rowCount: existing.includes(batchNumber) ? 1 : 0, rows: [] };
    },
  };
}

test('cosmetics without batch number or expiry get a generated lot and no expiry', () => {
  const identity = resolveBatchIdentity('COSMETIC', {});
  expect(identity).toMatchObject({ generated: true, expiryDate: NO_EXPIRY_DATE });
  expect(identity.batchNumber).toMatch(/^LOT-[2-9A-Z]{6}$/);
});

test('a generated lot that already exists is redrawn', async () => {
  const identity = resolveBatchIdentity('COSMETIC', {});
  const client = fakeClient([identity.batchNumber]);
  const lot = await ensureNewLot(client, 'medicine-id', identity);
  expect(lot).not.toBe(identity.batchNumber);
  expect(lot).toMatch(/^LOT-[2-9A-Z]{6}$/);
  expect(client.asked).toHaveLength(2);
});

test('typed batch numbers are used as given, even if they exist', async () => {
  const identity = resolveBatchIdentity('COSMETIC', { batchNumber: 'B-7' });
  const client = fakeClient(['B-7']);
  expect(await ensureNewLot(client, 'medicine-id', identity)).toBe('B-7');
  expect(client.asked).toHaveLength(0);
});
