const { resetDatabase, pool } = require('../helpers/db');
const { createBranch, createUser, createMedicine, createStock, setOverride } = require('../helpers/factories');
const { loginAs } = require('../helpers/session');
const { daysFromToday } = require('../helpers/dates');

let branch;
let otherBranch;
let pharmacistUser;
let pharmacist;
let admin;
let cashier;
let medicine;

beforeEach(async () => {
  await resetDatabase();
  branch = await createBranch({ name: 'Bole', code: 'BOLE' });
  otherBranch = await createBranch({ name: 'Piassa', code: 'PIASSA' });
  pharmacistUser = await createUser({ role: 'PHARMACIST', branches: [branch] });
  pharmacist = await loginAs(pharmacistUser);
  admin = await loginAs(await createUser({ role: 'ADMIN', branches: [branch, otherBranch] }));
  cashier = await loginAs(await createUser({ role: 'CASHIER', branches: [branch] }));
  medicine = await createMedicine({ name: 'Amoxicillin' });
});

afterAll(() => pool.end());

function stockBody(overrides = {}) {
  return {
    branchId: branch.id,
    medicineId: medicine.id,
    batchNumber: 'AMX-001',
    expiryDate: daysFromToday(365),
    purchasePrice: '10.00',
    sellingPrice: '15.50',
    quantity: 40,
    ...overrides,
  };
}

async function movementsFor(batchId) {
  const { rows } = await pool.query(
    'SELECT movement_type, quantity_change, quantity_before, quantity_after, reference_type FROM stock_movements WHERE batch_id = $1 ORDER BY created_at',
    [batchId],
  );
  return rows;
}

describe('adding stock', () => {
  test('creates batch, inventory row (branch default minimum) and a movement', async () => {
    const res = await pharmacist.post('/api/v1/inventory/stock').send(stockBody());
    expect(res.status).toBe(201);
    const inv = res.body.data.inventory;
    expect(inv).toMatchObject({ quantity: 40, minimumStock: 10, sellingPrice: '15.50', purchasePrice: '10.00' });
    expect(res.body.data.batchCreated).toBe(true);

    expect(await movementsFor(res.body.data.batchId)).toEqual([
      { movement_type: 'ADJUSTMENT', quantity_change: 40, quantity_before: 0, quantity_after: 40, reference_type: 'STOCK_ADDITION' },
    ]);
    const audit = await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'STOCK_ADDED'");
    expect(audit.rows[0].n).toBe(1);
  });

  test('reuses an existing batch and rejects a conflicting cost', async () => {
    const first = await pharmacist.post('/api/v1/inventory/stock').send(stockBody());
    const again = await pharmacist.post('/api/v1/inventory/stock').send(stockBody({ quantity: 5 }));
    expect(again.status).toBe(201);
    expect(again.body.data.batchId).toBe(first.body.data.batchId);
    expect(again.body.data.batchCreated).toBe(false);
    expect(again.body.data.quantityAfter).toBe(45);

    const conflict = await pharmacist.post('/api/v1/inventory/stock').send(stockBody({ purchasePrice: '11.00' }));
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('BATCH_COST_CONFLICT');

    const dates = await pharmacist.post('/api/v1/inventory/stock').send(stockBody({ expiryDate: daysFromToday(400) }));
    expect(dates.body.error.code).toBe('BATCH_DATA_CONFLICT');
  });

  test('the same batch can be stocked in several branches', async () => {
    await admin.post('/api/v1/inventory/stock').send(stockBody());
    const res = await admin.post('/api/v1/inventory/stock').send(stockBody({ branchId: otherBranch.id, sellingPrice: '16.00' }));
    expect(res.status).toBe(201);
    const rows = await pool.query('SELECT branch_id, quantity, selling_price FROM branch_inventory WHERE batch_id = $1', [res.body.data.batchId]);
    expect(rows.rows).toHaveLength(2);
  });

  test('rejects expired stock, archived medicines, inactive and foreign branches', async () => {
    expect((await pharmacist.post('/api/v1/inventory/stock').send(stockBody({ expiryDate: daysFromToday(-1) }))).body.error.code)
      .toBe('BATCH_EXPIRED');

    const archived = await createMedicine({ status: 'ARCHIVED' });
    expect((await pharmacist.post('/api/v1/inventory/stock').send(stockBody({ medicineId: archived.id }))).body.error.code)
      .toBe('MEDICINE_ARCHIVED');

    expect((await pharmacist.post('/api/v1/inventory/stock').send(stockBody({ branchId: otherBranch.id }))).body.error.code)
      .toBe('BRANCH_ACCESS_DENIED');

    await pool.query("UPDATE branches SET status = 'INACTIVE' WHERE id = $1", [otherBranch.id]);
    expect((await admin.post('/api/v1/inventory/stock').send(stockBody({ branchId: otherBranch.id }))).body.error.code)
      .toBe('BRANCH_INACTIVE');
  });

  test('cashier cannot add stock', async () => {
    expect((await cashier.post('/api/v1/inventory/stock').send(stockBody())).status).toBe(403);
  });

  test('a draft medicine can receive its first stock (medicine wizard)', async () => {
    const draft = await createMedicine({ status: 'DRAFT' });
    expect((await pharmacist.post('/api/v1/inventory/stock').send(stockBody({ medicineId: draft.id }))).status).toBe(201);
  });
});

describe('adjustments', () => {
  let inventoryId;
  let batchId;

  beforeEach(async () => {
    const res = await admin.post('/api/v1/inventory/stock').send(stockBody({ quantity: 10 }));
    inventoryId = res.body.data.inventoryId;
    batchId = res.body.data.batchId;
  });

  test('preview shows the outcome without changing stock', async () => {
    const res = await admin.post('/api/v1/inventory/adjustments/preview').send({ inventoryId, reason: 'DAMAGED', quantityChange: -3 });
    expect(res.body.data).toMatchObject({ quantityBefore: 10, quantityAfter: 7, valid: true, movementType: 'DAMAGED' });
    const bad = await admin.post('/api/v1/inventory/adjustments/preview').send({ inventoryId, reason: 'DAMAGED', quantityChange: 3 });
    expect(bad.body.data.valid).toBe(false);
    expect((await pool.query('SELECT quantity FROM branch_inventory WHERE id = $1', [inventoryId])).rows[0].quantity).toBe(10);
  });

  test('records adjustment, STK number, movement and audit atomically', async () => {
    const res = await admin.post('/api/v1/inventory/adjustments').send({
      inventoryId, reason: 'DAMAGED', quantityChange: -3, notes: 'Crushed box', expectedQuantityBefore: 10,
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ quantityBefore: 10, quantityChange: -3, quantityAfter: 7 });
    expect(res.body.data.adjustmentNumber).toMatch(/^STK-[2-9A-Z]{6}$/);

    const moves = await movementsFor(batchId);
    expect(moves[1]).toMatchObject({ movement_type: 'DAMAGED', quantity_change: -3, quantity_after: 7, reference_type: 'INVENTORY_ADJUSTMENT' });
    const audit = await pool.query("SELECT previous_values, new_values FROM audit_logs WHERE action = 'INVENTORY_ADJUSTED'");
    expect(audit.rows[0].previous_values).toEqual({ quantity: 10 });
  });

  test('maps FOUND to CORRECTION and OTHER to ADJUSTMENT; OTHER needs a note', async () => {
    await admin.post('/api/v1/inventory/adjustments').send({ inventoryId, reason: 'FOUND', quantityChange: 2 });
    const noNote = await admin.post('/api/v1/inventory/adjustments').send({ inventoryId, reason: 'OTHER', quantityChange: 1 });
    expect(noNote.status).toBe(422);
    await admin.post('/api/v1/inventory/adjustments').send({ inventoryId, reason: 'OTHER', quantityChange: -1, notes: 'Sample' });
    const types = (await movementsFor(batchId)).map((m) => m.movement_type);
    expect(types).toEqual(['ADJUSTMENT', 'CORRECTION', 'ADJUSTMENT']);
  });

  test('never allows negative stock', async () => {
    const res = await admin.post('/api/v1/inventory/adjustments').send({ inventoryId, reason: 'LOST', quantityChange: -11 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect((await movementsFor(batchId))).toHaveLength(1);
  });

  test('rejects a confirmation when stock changed after the preview', async () => {
    const res = await admin.post('/api/v1/inventory/adjustments').send({
      inventoryId, reason: 'LOST', quantityChange: -1, expectedQuantityBefore: 9,
    });
    expect(res.body.error.code).toBe('STOCK_CHANGED');
  });

  test('concurrent adjustments cannot oversell the same row', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 4 }, () =>
        admin.post('/api/v1/inventory/adjustments').send({ inventoryId, reason: 'LOST', quantityChange: -4 })),
    );
    expect(attempts.filter((r) => r.status === 201)).toHaveLength(2);
    expect(attempts.filter((r) => r.status === 409)).toHaveLength(2);
    expect((await pool.query('SELECT quantity FROM branch_inventory WHERE id = $1', [inventoryId])).rows[0].quantity).toBe(2);
  });

  test('is idempotent with an Idempotency-Key', async () => {
    const body = { inventoryId, reason: 'LOST', quantityChange: -1 };
    const first = await admin.post('/api/v1/inventory/adjustments').set('Idempotency-Key', 'adj-key-0001').send(body);
    const second = await admin.post('/api/v1/inventory/adjustments').set('Idempotency-Key', 'adj-key-0001').send(body);
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.data.id).toBe(first.body.data.id);
    expect((await pool.query('SELECT quantity FROM branch_inventory WHERE id = $1', [inventoryId])).rows[0].quantity).toBe(9);
  });

  test('pharmacist cannot adjust by default', async () => {
    expect((await pharmacist.post('/api/v1/inventory/adjustments').send({ inventoryId, reason: 'LOST', quantityChange: -1 })).status).toBe(403);
  });
});

describe('derived status', () => {
  test('expired, expiring soon, low stock and out of stock', async () => {
    const user = pharmacistUser;
    const expiredMed = await createMedicine({ name: 'Expired Med' });
    await createStock({ branch, medicine: expiredMed, user, expiryDate: daysFromToday(-1), quantity: 5 });

    const soonMed = await createMedicine({ name: 'Soon Med' });
    await createStock({ branch, medicine: soonMed, user, expiryDate: daysFromToday(10), quantity: 50, minimumStock: 5 });

    const lowMed = await createMedicine({ name: 'Low Med' });
    await createStock({ branch, medicine: lowMed, user, quantity: 5, minimumStock: 5 });

    const okMed = await createMedicine({ name: 'Ok Med' });
    await createStock({ branch, medicine: okMed, user, quantity: 50, minimumStock: 5 });

    const res = await pharmacist.get('/api/v1/inventory?limit=100');
    const status = Object.fromEntries(res.body.data.map((r) => [r.medicineName, r.status]));
    expect(status).toEqual({
      'Expired Med': 'EXPIRED',
      'Soon Med': 'EXPIRING_SOON',
      'Low Med': 'LOW_STOCK',
      'Ok Med': 'AVAILABLE',
    });

    // Expired stock is not sellable, so the medicine is also out of stock.
    const out = await pharmacist.get('/api/v1/inventory/out-of-stock');
    expect(out.body.data.map((r) => r.medicineName)).toEqual(['Expired Med']);
    const low = await pharmacist.get('/api/v1/inventory/low-stock');
    expect(low.body.data.map((r) => r.medicineName)).toEqual(['Low Med']);
    expect((await pharmacist.get('/api/v1/inventory/expired')).body.data).toHaveLength(1);
    expect((await pharmacist.get('/api/v1/inventory/expiring-soon')).body.data[0].medicineName).toBe('Soon Med');

    const summary = await pharmacist.get(`/api/v1/branches/${branch.id}/inventory-summary`);
    expect(summary.body.data).toMatchObject({ outOfStock: 1, lowStock: 1, expiredBatches: 1, expiringSoonBatches: 1 });
  });

  test('a sold-out old batch does not make a stocked medicine out of stock', async () => {
    await createStock({ branch, medicine, user: pharmacistUser, quantity: 0, batchNumber: 'OLD' });
    await createStock({ branch, medicine, user: pharmacistUser, quantity: 30, batchNumber: 'NEW' });
    expect((await pharmacist.get('/api/v1/inventory/out-of-stock')).body.data).toHaveLength(0);
  });
});

describe('visibility and branch isolation', () => {
  beforeEach(async () => {
    await admin.post('/api/v1/inventory/stock').send(stockBody());
    await admin.post('/api/v1/inventory/stock').send(stockBody({ branchId: otherBranch.id }));
  });

  test('users only see inventory of their branches', async () => {
    const res = await pharmacist.get('/api/v1/inventory');
    expect(res.body.data.map((r) => r.branchCode)).toEqual(['BOLE']);
    const foreign = await pharmacist.get(`/api/v1/inventory?branchId=${otherBranch.id}`);
    expect(foreign.body.error.code).toBe('BRANCH_ACCESS_DENIED');
  });

  test('cashier never receives purchase price, inventory value or batch details', async () => {
    const res = await cashier.get('/api/v1/inventory');
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/purchasePrice|inventoryValue|batchNumber/);
    expect(res.body.data[0].sellingPrice).toBe('15.50');

    const summary = await cashier.get(`/api/v1/branches/${branch.id}/inventory-summary`);
    expect(summary.body.data.inventoryValue).toBeUndefined();
  });

  test('an explicit grant reveals purchase cost', async () => {
    const cashierUser = await createUser({ role: 'CASHIER', branches: [branch] });
    await setOverride(cashierUser.id, 'FINANCIAL_VIEW_PURCHASE_COST', true);
    const session = await loginAs(cashierUser);
    expect((await session.get('/api/v1/inventory')).body.data[0].purchasePrice).toBe('10.00');
  });

  test('pharmacist sees purchase price but movements need permission per role', async () => {
    expect((await pharmacist.get('/api/v1/inventory')).body.data[0].purchasePrice).toBe('10.00');
    expect((await cashier.get('/api/v1/inventory/movements')).status).toBe(403);
    const moves = await pharmacist.get('/api/v1/inventory/movements');
    expect(moves.body.data).toHaveLength(1);
    const { today, daysFromToday: plus } = require('../helpers/dates');
    expect((await pharmacist.get(`/api/v1/inventory/movements?dateFrom=${today()}&dateTo=${today()}`)).body.data).toHaveLength(1);
    expect((await pharmacist.get(`/api/v1/inventory/movements?dateFrom=${plus(1)}`)).body.data).toHaveLength(0);
  });
});

describe('inventory settings and FEFO preview', () => {
  test('minimum stock and selling price changes are audited', async () => {
    const { inventoryId } = (await admin.post('/api/v1/inventory/stock').send(stockBody())).body.data;
    expect((await admin.patch(`/api/v1/inventory/${inventoryId}/minimum-stock`).send({ minimumStock: 7 })).body.data.minimumStock).toBe(7);
    expect((await admin.patch(`/api/v1/inventory/${inventoryId}/selling-price`).send({ sellingPrice: '17' })).body.data.sellingPrice).toBe('17.00');
    const audit = await pool.query("SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY created_at", [inventoryId]);
    expect(audit.rows.map((r) => r.action)).toEqual(['STOCK_ADDED', 'MINIMUM_STOCK_CHANGED', 'SELLING_PRICE_CHANGED']);
  });

  test('FEFO preview picks the earliest non-expired batch without locking', async () => {
    await createStock({ branch, medicine, user: pharmacistUser, batchNumber: 'EXP', expiryDate: daysFromToday(-5), quantity: 100 });
    await createStock({ branch, medicine, user: pharmacistUser, batchNumber: 'LATE', expiryDate: daysFromToday(300), quantity: 10 });
    await createStock({ branch, medicine, user: pharmacistUser, batchNumber: 'EARLY', expiryDate: daysFromToday(30), quantity: 4 });

    const res = await cashier.post('/api/v1/inventory/fefo-preview').send({ branchId: branch.id, medicineId: medicine.id, quantity: 6 });
    expect(res.body.data.allocation.map((a) => [a.batchNumber, a.quantity])).toEqual([['EARLY', 4], ['LATE', 2]]);
    expect(res.body.data.availableQuantity).toBe(14);

    const short = await cashier.post('/api/v1/inventory/fefo-preview').send({ branchId: branch.id, medicineId: medicine.id, quantity: 50 });
    expect(short.body.data.sufficient).toBe(false);
  });
});

describe('disposing of expired and expiring stock', () => {
  const stockOf = (overrides) => createStock({ branch, medicine, user: pharmacistUser, purchasePrice: '4.00', ...overrides });

  test('writes off all remaining units as a loss and clears the alert', async () => {
    const { inventory, batch } = await stockOf({ expiryDate: daysFromToday(-2), quantity: 6 });
    expect((await pharmacist.get(`/api/v1/alerts?branchId=${branch.id}`)).body.data.some((a) => a.type === 'EXPIRED')).toBe(true);

    const res = await pharmacist.post(`/api/v1/inventory/${inventory.id}/dispose`).send({ notes: 'Sent for destruction' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ quantityDisposed: 6, lossValue: '24.00' });
    expect(res.body.data.adjustmentNumber).toMatch(/^STK-/);

    const moves = await movementsFor(batch.id);
    expect(moves[moves.length - 1]).toMatchObject({ movement_type: 'DISPOSED', quantity_change: -6, quantity_after: 0 });
    expect((await pharmacist.get(`/api/v1/alerts?branchId=${branch.id}`)).body.data.some((a) => a.type === 'EXPIRED')).toBe(false);
    // Nothing left: a second disposal is refused.
    expect((await pharmacist.post(`/api/v1/inventory/${inventory.id}/dispose`).send({})).body.error.code).toBe('NOTHING_TO_DISPOSE');
  });

  test('allows expiring-soon stock but not healthy stock, and is limited by permission', async () => {
    const soon = await stockOf({ expiryDate: daysFromToday(10), quantity: 3 });
    const healthy = await stockOf({ expiryDate: daysFromToday(400), quantity: 3 });
    expect((await cashier.post(`/api/v1/inventory/${soon.inventory.id}/dispose`).send({})).status).toBe(403);
    expect((await pharmacist.post(`/api/v1/inventory/${healthy.inventory.id}/dispose`).send({})).body.error.code).toBe('NOT_DISPOSABLE');
    expect((await admin.post(`/api/v1/inventory/${soon.inventory.id}/dispose`).send({})).status).toBe(201);
  });

  test('can archive in the same step and shows up in the loss and profit reports', async () => {
    const { inventory } = await stockOf({ expiryDate: daysFromToday(-1), quantity: 5 });
    await pharmacist.post(`/api/v1/inventory/${inventory.id}/dispose`).send({ archive: true });

    const listed = await pharmacist.get(`/api/v1/inventory?branchId=${branch.id}`);
    expect(listed.body.data.find((r) => r.id === inventory.id)).toBeUndefined();
    const archived = await pharmacist.get(`/api/v1/inventory?branchId=${branch.id}&archived=true`);
    expect(archived.body.data.map((r) => r.id)).toEqual([inventory.id]);

    const losses = await admin.get('/api/v1/reports/losses?range=TODAY');
    expect(losses.body.data.summary).toMatchObject({ unitsLost: 5, totalLossValue: '20.00', expiryLossValue: '20.00' });
    expect(losses.body.data.rows[0]).toMatchObject({ movementType: 'DISPOSED', quantity: 5, lossValue: '20.00' });
    const profit = await admin.get('/api/v1/reports/profit?range=TODAY');
    expect(profit.body.data.summary).toMatchObject({ stockLosses: '20.00', netProfit: '-20.00' });
    expect((await admin.get('/api/v1/reports/losses/export?range=TODAY&format=csv')).text).toContain('Amoxicillin');
  });
});

describe('archiving batches', () => {
  test('only empty rows can be archived; restore and new stock bring them back', async () => {
    const { inventory, batch } = await createStock({ branch, medicine, user: pharmacistUser, quantity: 2, batchNumber: 'ARC-1' });
    expect((await pharmacist.post(`/api/v1/inventory/${inventory.id}/archive`)).body.error.code).toBe('BATCH_HAS_STOCK');

    await pool.query('UPDATE branch_inventory SET quantity = 0 WHERE id = $1', [inventory.id]);
    expect((await cashier.post(`/api/v1/inventory/${inventory.id}/archive`)).status).toBe(403);
    const archived = await pharmacist.post(`/api/v1/inventory/${inventory.id}/archive`);
    expect(archived.status).toBe(200);
    expect(archived.body.data.archivedAt).toBeTruthy();

    const restored = await pharmacist.post(`/api/v1/inventory/${inventory.id}/restore`);
    expect(restored.body.data.archivedAt).toBeNull();

    // Receiving the same batch again un-archives the row automatically.
    await pharmacist.post(`/api/v1/inventory/${inventory.id}/archive`);
    await pharmacist.post('/api/v1/inventory/stock').send(stockBody({ batchNumber: 'ARC-1', expiryDate: batch.expiry_date, purchasePrice: batch.purchase_price, quantity: 4 }));
    const { rows } = await pool.query('SELECT quantity, archived_at FROM branch_inventory WHERE id = $1', [inventory.id]);
    expect(rows[0]).toEqual({ quantity: 4, archived_at: null });
  });
});
