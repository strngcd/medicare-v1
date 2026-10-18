// A small ceiling so the "too large" path can be exercised without huge data.
process.env.EXPORT_MAX_ROWS = '10050';

const { csvTable } = require('../helpers/csv');
const { resetDatabase, pool } = require('../helpers/db');
const { createBranch, createUser, createMedicine, createStock } = require('../helpers/factories');
const { loginAs } = require('../helpers/session');

let admin;
let branch;
let batch;
let ownerUser;

beforeAll(async () => {
  await resetDatabase();
  branch = await createBranch({ name: 'Bole', code: 'BOLE' });
  ownerUser = await createUser({ role: 'OWNER' });
  admin = await loginAs(ownerUser);
  ({ batch } = await createStock({ branch, medicine: await createMedicine(), user: ownerUser, quantity: 100000 }));
});

afterAll(() => pool.end());

/** Writes `count` one-unit DAMAGED movements today (a stock-loss row each). */
async function addLosses(count) {
  await pool.query(
    `INSERT INTO stock_movements (branch_id, batch_id, movement_type, quantity_change, quantity_before, quantity_after,
       reference_type, reference_id, reason, created_by)
     SELECT $1, $2, 'DAMAGED', -1, 1, 0, 'INVENTORY_ADJUSTMENT', gen_random_uuid(), 'bulk', $3 FROM generate_series(1, $4)`,
    [branch.id, batch.id, ownerUser.id, count],
  );
}

test('exports contain every row, beyond the old 10,000-row cut-off', async () => {
  await addLosses(10050);
  const res = await admin.get('/api/v1/reports/losses/export?format=csv&range=TODAY');
  expect(res.status).toBe(200);
  // header + rows + totals
  expect(csvTable(res.text)).toHaveLength(10050 + 2);
}, 60000);

test('exports over the ceiling are refused with a clear message instead of being cut short', async () => {
  await addLosses(1);
  const res = await admin.get('/api/v1/reports/losses/export?format=csv&range=TODAY');
  expect(res.status).toBe(422);
  expect(res.body.error.code).toBe('EXPORT_TOO_LARGE');
}, 60000);
