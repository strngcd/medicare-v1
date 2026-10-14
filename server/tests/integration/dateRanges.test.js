const { resetDatabase, pool } = require('../helpers/db');
const { createBranch, createUser, createMedicine, createStock } = require('../helpers/factories');
const { loginAs } = require('../helpers/session');

// Business days follow BUSINESS_TIMEZONE (Africa/Addis_Ababa, UTC+3), not UTC.
let owner;
let batch;
let branch;

beforeEach(async () => {
  await resetDatabase();
  branch = await createBranch({ name: 'Bole', code: 'BOLE' });
  const ownerUser = await createUser({ role: 'OWNER' });
  owner = await loginAs(ownerUser);
  ({ batch } = await createStock({ branch, medicine: await createMedicine(), user: ownerUser, quantity: 5 }));
  const movement = (at, reason) => pool.query(
    `INSERT INTO stock_movements (branch_id, batch_id, movement_type, quantity_change, quantity_before, quantity_after,
       reference_type, reference_id, reason, created_by, created_at)
     VALUES ($1, $2, 'CORRECTION', 1, 5, 6, 'INVENTORY_ADJUSTMENT', gen_random_uuid(), $3, $4, $5)`,
    [branch.id, batch.id, reason, ownerUser.id, at],
  );
  await movement('2026-03-10T23:30:00+03:00', 'late on the 10th');
  await movement('2026-03-11T00:10:00+03:00', 'early on the 11th');
});

afterAll(() => pool.end());

async function reasonsBetween(dateFrom, dateTo) {
  const res = await owner.get(`/api/v1/inventory/movements?batchId=${batch.id}&dateFrom=${dateFrom}&dateTo=${dateTo}&limit=100`);
  expect(res.status).toBe(200);
  return res.body.data.map((m) => m.reason).filter((r) => r !== 'Test opening stock').sort();
}

test('date filters include the whole business day and nothing from the next', async () => {
  expect(await reasonsBetween('2026-03-10', '2026-03-10')).toEqual(['late on the 10th']);
  expect(await reasonsBetween('2026-03-11', '2026-03-11')).toEqual(['early on the 11th']);
  expect(await reasonsBetween('2026-03-10', '2026-03-11')).toEqual(['early on the 11th', 'late on the 10th']);
  expect(await reasonsBetween('2026-03-12', '2026-03-12')).toEqual([]);
});
