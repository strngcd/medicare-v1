const { resetDatabase, pool } = require('../helpers/db');
const { createBranch, createUser, createMedicine, createStock } = require('../helpers/factories');
const { loginAs } = require('../helpers/session');
const { daysFromToday } = require('../helpers/dates');

let source;
let destination;
let owner;
let sourceAdmin;
let destAdmin;
let med;
let batch;

beforeEach(async () => {
  await resetDatabase();
  source = await createBranch({ name: 'Bole', code: 'BOLE' });
  destination = await createBranch({ name: 'Piassa', code: 'PIASSA' });
  owner = await createUser({ role: 'OWNER' });
  sourceAdmin = await loginAs(await createUser({ role: 'ADMIN', branches: [source] }));
  destAdmin = await loginAs(await createUser({ role: 'ADMIN', branches: [destination] }));
  med = await createMedicine({ name: 'Metformin' });
  ({ batch } = await createStock({ branch: source, medicine: med, user: owner, quantity: 60, sellingPrice: '7.50' }));
});

afterAll(() => pool.end());

async function qty(branchId) {
  const { rows } = await pool.query('SELECT quantity FROM branch_inventory WHERE branch_id = $1 AND batch_id = $2', [branchId, batch.id]);
  return rows[0] ? rows[0].quantity : null;
}

async function createTransfer(session = destAdmin, requested = 50) {
  const res = await session.post('/api/v1/transfers').send({
    sourceBranchId: source.id,
    destinationBranchId: destination.id,
    items: [{ batchId: batch.id, requestedQuantity: requested }],
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

async function toInTransit(shipped) {
  const t = await createTransfer();
  await destAdmin.post(`/api/v1/transfers/${t.id}/request`);
  await sourceAdmin.post(`/api/v1/transfers/${t.id}/approve`).send({});
  const body = shipped === undefined ? {} : { items: [{ transferItemId: t.items[0].id, quantity: shipped }] };
  const res = await sourceAdmin.post(`/api/v1/transfers/${t.id}/ship`).send(body);
  expect(res.status).toBe(200);
  return res.body.data;
}

describe('transfer lifecycle', () => {
  test('full happy path moves stock only at ship and receive', async () => {
    const t = await createTransfer();
    expect(t).toMatchObject({ status: 'DRAFT', sourceBranchCode: 'BOLE', destinationBranchCode: 'PIASSA' });
    expect(t.transferNumber).toMatch(/^TRF-\d{4}-000001$/);

    expect((await destAdmin.post(`/api/v1/transfers/${t.id}/request`)).body.data.status).toBe('REQUESTED');

    // Only the source branch can approve and ship.
    expect((await destAdmin.post(`/api/v1/transfers/${t.id}/approve`).send({})).body.error.code).toBe('BRANCH_ACCESS_DENIED');
    const approved = await sourceAdmin.post(`/api/v1/transfers/${t.id}/approve`).send({ items: [{ transferItemId: t.items[0].id, quantity: 40 }] });
    expect(approved.body.data.items[0]).toMatchObject({ requestedQuantity: 50, approvedQuantity: 40 });
    expect(await qty(source.id)).toBe(60);

    const shipped = await sourceAdmin.post(`/api/v1/transfers/${t.id}/ship`).send({});
    expect(shipped.body.data.status).toBe('IN_TRANSIT');
    expect(await qty(source.id)).toBe(20);
    expect(await qty(destination.id)).toBeNull();

    expect((await sourceAdmin.post(`/api/v1/transfers/${t.id}/receive`).send({})).body.error.code).toBe('BRANCH_ACCESS_DENIED');
    const received = await destAdmin.post(`/api/v1/transfers/${t.id}/receive`).send({});
    expect(received.body.data.status).toBe('RECEIVED');
    expect(await qty(destination.id)).toBe(40);

    // Destination inherits the source selling price and its own default minimum stock.
    const row = await pool.query('SELECT selling_price, minimum_stock FROM branch_inventory WHERE branch_id = $1', [destination.id]);
    expect(row.rows[0]).toEqual({ selling_price: '7.50', minimum_stock: 10 });

    const moves = await pool.query("SELECT movement_type, quantity_change FROM stock_movements WHERE reference_type = 'TRANSFER' ORDER BY created_at");
    expect(moves.rows).toEqual([
      { movement_type: 'TRANSFER_OUT', quantity_change: -40 },
      { movement_type: 'TRANSFER_IN', quantity_change: 40 },
    ]);
    const audit = await pool.query("SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY created_at", [t.id]);
    expect(audit.rows.map((r) => r.action)).toEqual([
      'TRANSFER_CREATED', 'TRANSFER_REQUESTED', 'TRANSFER_APPROVED', 'TRANSFER_SHIPPED', 'TRANSFER_RECEIVED',
    ]);
  });

  test('shipped 50, received 47: only 47 enters and a reasoned discrepancy is recorded', async () => {
    const t = await toInTransit();
    const item = t.items[0];
    const missingReason = await destAdmin.post(`/api/v1/transfers/${t.id}/receive`).send({ items: [{ transferItemId: item.id, quantity: 47 }] });
    expect(missingReason.status).toBe(422);

    const res = await destAdmin.post(`/api/v1/transfers/${t.id}/receive`).send({
      items: [{ transferItemId: item.id, quantity: 47 }],
      discrepancyReason: 'Three boxes damaged in transit',
    });
    expect(res.body.data).toMatchObject({ discrepancyQuantity: 3, discrepancyReason: 'Three boxes damaged in transit' });
    expect(res.body.data.items[0]).toMatchObject({ shippedQuantity: 50, receivedQuantity: 47, discrepancyQuantity: 3 });
    expect(await qty(destination.id)).toBe(47);
    expect(await qty(source.id)).toBe(10);

    const notes = await pool.query("SELECT count(*)::int AS n FROM notifications WHERE type = 'TRANSFER_DISCREPANCY'");
    expect(notes.rows[0].n).toBeGreaterThan(0);
    const audit = await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'TRANSFER_DISCREPANCY_RECORDED'");
    expect(audit.rows[0].n).toBe(1);
  });

  test('quantities cannot exceed the previous step', async () => {
    const t = await createTransfer();
    await destAdmin.post(`/api/v1/transfers/${t.id}/request`);
    const over = await sourceAdmin.post(`/api/v1/transfers/${t.id}/approve`).send({ items: [{ transferItemId: t.items[0].id, quantity: 51 }] });
    expect(over.status).toBe(422);
  });

  test('state machine rejects out-of-order steps and cancellation after shipment', async () => {
    const t = await createTransfer();
    expect((await sourceAdmin.post(`/api/v1/transfers/${t.id}/ship`).send({})).body.error.code).toBe('TRANSFER_INVALID_STATE');
    expect((await destAdmin.post(`/api/v1/transfers/${t.id}/cancel`).send({ reason: 'Not needed' })).body.data.status).toBe('CANCELLED');
    expect((await destAdmin.post(`/api/v1/transfers/${t.id}/request`)).body.error.code).toBe('TRANSFER_INVALID_STATE');

    const shipped = await toInTransit();
    expect((await sourceAdmin.post(`/api/v1/transfers/${shipped.id}/cancel`).send({ reason: 'x' })).body.error.code).toBe('TRANSFER_INVALID_STATE');
  });
});

describe('validation and authorization', () => {
  test('transfer creators can see every active branch as a destination (names only)', async () => {
    const res = await destAdmin.get('/api/v1/branches/context');
    expect(res.body.data.branches.map((b) => b.code)).toEqual(['PIASSA']);
    expect(res.body.data.transferDestinations.map((b) => b.code).sort()).toEqual(['BOLE', 'PIASSA']);
    expect(Object.keys(res.body.data.transferDestinations[0]).sort()).toEqual(['code', 'id', 'name']);
  });

  test('source and destination must differ; requested quantity must be available', async () => {
    const same = await sourceAdmin.post('/api/v1/transfers').send({
      sourceBranchId: source.id, destinationBranchId: source.id, items: [{ batchId: batch.id, requestedQuantity: 1 }],
    });
    expect(same.status).toBe(422);
    const tooMuch = await sourceAdmin.post('/api/v1/transfers').send({
      sourceBranchId: source.id, destinationBranchId: destination.id, items: [{ batchId: batch.id, requestedQuantity: 61 }],
    });
    expect(tooMuch.body.error.code).toBe('TRANSFER_INSUFFICIENT_STOCK');
  });

  test('expired batches and inactive branches are rejected', async () => {
    const old = await createStock({ branch: source, medicine: med, user: owner, batchNumber: 'OLD', expiryDate: daysFromToday(-1), quantity: 5 });
    const expired = await sourceAdmin.post('/api/v1/transfers').send({
      sourceBranchId: source.id, destinationBranchId: destination.id, items: [{ batchId: old.batch.id, requestedQuantity: 1 }],
    });
    expect(expired.body.error.code).toBe('BATCH_EXPIRED');

    await pool.query("UPDATE branches SET status = 'INACTIVE' WHERE id = $1", [destination.id]);
    const inactive = await sourceAdmin.post('/api/v1/transfers').send({
      sourceBranchId: source.id, destinationBranchId: destination.id, items: [{ batchId: batch.id, requestedQuantity: 1 }],
    });
    expect(inactive.body.error.code).toBe('BRANCH_INACTIVE');
  });

  test('cashiers and pharmacists have no transfer permissions by default; outsiders cannot see transfers', async () => {
    const cashier = await loginAs(await createUser({ role: 'CASHIER', branches: [source] }));
    const pharmacist = await loginAs(await createUser({ role: 'PHARMACIST', branches: [source] }));
    expect((await cashier.get('/api/v1/transfers')).status).toBe(403);
    expect((await pharmacist.post('/api/v1/transfers').send({})).status).toBe(403);

    const t = await createTransfer();
    const outsiderBranch = await createBranch();
    const outsider = await loginAs(await createUser({ role: 'ADMIN', branches: [outsiderBranch] }));
    expect((await outsider.get(`/api/v1/transfers/${t.id}`)).status).toBe(404);
    expect((await outsider.get('/api/v1/transfers')).body.data).toHaveLength(0);
  });
});

describe('concurrency and idempotency', () => {
  test('shipping re-checks stock: a concurrent sale can make shipment fail cleanly', async () => {
    const t = await createTransfer(destAdmin, 50);
    await destAdmin.post(`/api/v1/transfers/${t.id}/request`);
    await sourceAdmin.post(`/api/v1/transfers/${t.id}/approve`).send({});
    // Stock drops after approval (e.g. sales).
    await pool.query('UPDATE branch_inventory SET quantity = 30 WHERE branch_id = $1', [source.id]);

    const res = await sourceAdmin.post(`/api/v1/transfers/${t.id}/ship`).send({});
    expect(res.body.error.code).toBe('TRANSFER_INSUFFICIENT_STOCK');
    expect(await qty(source.id)).toBe(30);
    expect((await sourceAdmin.get(`/api/v1/transfers/${t.id}`)).body.data.status).toBe('APPROVED');
  });

  test('concurrent ship requests ship once', async () => {
    const t = await createTransfer();
    await destAdmin.post(`/api/v1/transfers/${t.id}/request`);
    await sourceAdmin.post(`/api/v1/transfers/${t.id}/approve`).send({});
    const results = await Promise.all([1, 2, 3].map(() => sourceAdmin.post(`/api/v1/transfers/${t.id}/ship`).send({})));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await qty(source.id)).toBe(10);
  });

  test('receive with an Idempotency-Key replays instead of failing', async () => {
    const t = await toInTransit();
    const first = await destAdmin.post(`/api/v1/transfers/${t.id}/receive`).set('Idempotency-Key', 'trf-recv-0001').send({});
    const retry = await destAdmin.post(`/api/v1/transfers/${t.id}/receive`).set('Idempotency-Key', 'trf-recv-0001').send({});
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(await qty(destination.id)).toBe(50);
  });
});
