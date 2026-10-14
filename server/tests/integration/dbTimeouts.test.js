const { resetDatabase, pool } = require('../helpers/db');
const { createBranch, createUser, createMedicine, createStock } = require('../helpers/factories');
const { loginAs } = require('../helpers/session');
const { withTransaction } = require('../../src/database/db');

afterAll(() => pool.end());

test('every pooled connection carries the safety limits', async () => {
  const { rows } = await pool.query(
    "SELECT current_setting('statement_timeout') AS statement, current_setting('lock_timeout') AS lock, current_setting('idle_in_transaction_session_timeout') AS idle",
  );
  expect(rows[0]).toEqual({ statement: '30s', lock: '10s', idle: '1min' });
});

test('a request blocked behind a stuck lock fails fast with a retryable error instead of hanging', async () => {
  await resetDatabase();
  const branch = await createBranch({ name: 'Bole', code: 'BOLE' });
  const ownerUser = await createUser({ role: 'OWNER' });
  const owner = await loginAs(ownerUser);
  const { inventory } = await createStock({ branch, medicine: await createMedicine(), user: ownerUser, quantity: 5 });

  // Another transaction holds the inventory row, as a stuck request would.
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const holder = withTransaction(async (client) => {
    await client.query('SELECT id FROM branch_inventory WHERE id = $1 FOR UPDATE', [inventory.id]);
    await held;
  });
  const started = Date.now();
  const res = await owner.patch(`/api/v1/inventory/${inventory.id}/minimum-stock`).send({ minimumStock: 3 });
  release();
  await holder;
  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe('RECORD_BUSY');
  expect(Date.now() - started).toBeLessThan(15000);
}, 20000);
