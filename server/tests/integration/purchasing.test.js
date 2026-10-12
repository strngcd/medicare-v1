const { resetDatabase, pool } = require('../helpers/db');
const { createBranch, createUser, createMedicine, setOverride } = require('../helpers/factories');
const { loginAs } = require('../helpers/session');
const { daysFromToday } = require('../helpers/dates');

let branch;
let pharmacist;
let admin;
let supplier;
let medA;
let medB;

beforeEach(async () => {
  await resetDatabase();
  branch = await createBranch({ name: 'Bole', code: 'BOLE' });
  pharmacist = await loginAs(await createUser({ role: 'PHARMACIST', branches: [branch] }));
  admin = await loginAs(await createUser({ role: 'ADMIN', branches: [branch] }));
  supplier = (await admin.post('/api/v1/suppliers').send({ companyName: 'Ethio Pharma', phone: '0911' })).body.data.supplier;
  medA = await createMedicine({ name: 'Amoxicillin' });
  medB = await createMedicine({ name: 'Paracetamol' });
});

afterAll(() => pool.end());

function purchaseBody(overrides = {}) {
  return {
    supplierId: supplier.id,
    branchId: branch.id,
    status: 'PENDING',
    items: [
      { medicineId: medA.id, orderedQuantity: 100, unitPurchasePrice: '2.50', discount: '10.00', tax: '5.00' },
      { medicineId: medB.id, orderedQuantity: 50, unitPurchasePrice: '1.10' },
    ],
    ...overrides,
  };
}

function receiveLine(item, overrides = {}) {
  return {
    purchaseItemId: item.id,
    batchNumber: `${item.medicineName.slice(0, 3).toUpperCase()}-1`,
    expiryDate: daysFromToday(400),
    quantity: item.orderedQuantity,
    sellingPrice: '4.00',
    ...overrides,
  };
}

const itemFor = (purchase, medicine) => purchase.items.find((i) => i.medicineId === medicine.id);

async function stockOf(medicineId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(sum(bi.quantity), 0)::int AS q FROM branch_inventory bi JOIN batches b ON b.id = bi.batch_id WHERE b.medicine_id = $1`,
    [medicineId],
  );
  return rows[0].q;
}

describe('creating and editing purchases', () => {
  test('computes totals on the server and does not change stock', async () => {
    const res = await pharmacist.post('/api/v1/purchases').send(purchaseBody());
    expect(res.status).toBe(201);
    expect(res.body.data.purchaseNumber).toMatch(/^PUR-\d{4}-000001$/);
    // A: 100 x 2.50 = 250 - 10 + 5 = 245; B: 50 x 1.10 = 55
    expect(res.body.data).toMatchObject({ subtotal: '305.00', discount: '10.00', tax: '5.00', total: '300.00', paymentStatus: 'UNPAID' });
    expect(res.body.data.items.map((i) => i.lineTotal)).toEqual(['245.00', '55.00']);
    expect(await stockOf(medA.id)).toBe(0);
  });

  test('rejects archived medicines, archived suppliers and future dates', async () => {
    const archived = await createMedicine({ status: 'ARCHIVED' });
    const res = await pharmacist.post('/api/v1/purchases').send(purchaseBody({ items: [{ medicineId: archived.id, orderedQuantity: 1, unitPurchasePrice: '1' }] }));
    expect(res.body.error.code).toBe('MEDICINE_ARCHIVED');

    expect((await pharmacist.post('/api/v1/purchases').send(purchaseBody({ purchaseDate: daysFromToday(2) }))).status).toBe(422);

    await admin.post(`/api/v1/suppliers/${supplier.id}/archive`);
    expect((await pharmacist.post('/api/v1/purchases').send(purchaseBody())).body.error.code).toBe('SUPPLIER_ARCHIVED');
  });

  test('editing replaces items and recomputes totals; not allowed after receiving', async () => {
    const purchase = (await pharmacist.post('/api/v1/purchases').send(purchaseBody({ status: 'DRAFT' }))).body.data;
    const edited = await pharmacist.patch(`/api/v1/purchases/${purchase.id}`).send({
      status: 'PENDING',
      items: [{ medicineId: medA.id, orderedQuantity: 10, unitPurchasePrice: '3.00' }],
    });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ status: 'PENDING', total: '30.00' });

    const item = itemFor(edited.body.data, medA);
    await pharmacist.post(`/api/v1/purchases/${purchase.id}/receive`).send({ items: [receiveLine(item, { quantity: 1 })] });
    const late = await pharmacist.patch(`/api/v1/purchases/${purchase.id}`).send({ notes: 'x' });
    expect(late.body.error.code).toBe('INVALID_STATUS_TRANSITION');
  });
});

describe('receiving', () => {
  let purchase;

  beforeEach(async () => {
    purchase = (await pharmacist.post('/api/v1/purchases').send(purchaseBody())).body.data;
  });

  test('a draft purchase cannot be received', async () => {
    const draft = (await pharmacist.post('/api/v1/purchases').send(purchaseBody({ status: 'DRAFT' }))).body.data;
    const res = await pharmacist.post(`/api/v1/purchases/${draft.id}/receive`).send({ items: [receiveLine(draft.items[0])] });
    expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  test('full receipt creates batches, inventory, movements and marks RECEIVED', async () => {
    const res = await pharmacist.post(`/api/v1/purchases/${purchase.id}/receive`).send({
      items: purchase.items.map((i) => receiveLine(i)),
    });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('RECEIVED');
    expect(await stockOf(medA.id)).toBe(100);
    expect(await stockOf(medB.id)).toBe(50);

    const batch = await pool.query("SELECT purchase_price, supplier_id FROM batches WHERE batch_number = 'AMO-1'");
    expect(batch.rows[0]).toEqual({ purchase_price: '2.50', supplier_id: supplier.id });

    const moves = await pool.query("SELECT count(*)::int AS n FROM stock_movements WHERE movement_type = 'PURCHASE_RECEIVED'");
    expect(moves.rows[0].n).toBe(2);

    const again = await pharmacist.post(`/api/v1/purchases/${purchase.id}/receive`).send({ items: [receiveLine(purchase.items[0], { quantity: 1 })] });
    expect(again.body.error.code).toBe('PURCHASE_ALREADY_RECEIVED');
  });

  test('partial receipt across multiple batches and deliveries', async () => {
    const itemA = itemFor(purchase, medA);
    const first = await pharmacist.post(`/api/v1/purchases/${purchase.id}/receive`).send({
      items: [
        receiveLine(itemA, { batchNumber: 'A-1', quantity: 30 }),
        receiveLine(itemA, { batchNumber: 'A-2', quantity: 20, expiryDate: daysFromToday(200) }),
      ],
    });
    expect(first.body.data.status).toBe('PARTIALLY_RECEIVED');
    const detail = first.body.data.purchase.items.find((i) => i.id === itemA.id);
    expect(detail).toMatchObject({ receivedQuantity: 50, remainingQuantity: 50 });

    const second = await pharmacist.post(`/api/v1/purchases/${purchase.id}/receive`).send({
      items: [receiveLine(itemA, { batchNumber: 'A-1', quantity: 50 }), receiveLine(itemFor(purchase, medB))],
    });
    expect(second.body.data.status).toBe('RECEIVED');
    expect(await stockOf(medA.id)).toBe(100);
    // The existing A-1 batch was reused, not duplicated.
    const batches = await pool.query('SELECT count(*)::int AS n FROM batches WHERE medicine_id = $1', [medA.id]);
    expect(batches.rows[0].n).toBe(2);

    const receivings = await pharmacist.get(`/api/v1/purchases/${purchase.id}/receivings`);
    expect(receivings.body.data).toHaveLength(2);
    const one = await pharmacist.get(`/api/v1/purchase-receivings/${receivings.body.data[0].id}`);
    expect(one.body.data.items).toHaveLength(2);
  });

  test('rejects over-receiving, including across lines of one request', async () => {
    const itemA = itemFor(purchase, medA);
    const res = await pharmacist.post(`/api/v1/purchases/${purchase.id}/receive`).send({
      items: [receiveLine(itemA, { quantity: 60, batchNumber: 'X1' }), receiveLine(itemA, { quantity: 41, batchNumber: 'X2' })],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OVER_RECEIVING');
    expect(await stockOf(medA.id)).toBe(0);
  });

  test('rejects expired batches', async () => {
    const res = await pharmacist.post(`/api/v1/purchases/${purchase.id}/receive`).send({
      items: [receiveLine(purchase.items[0], { expiryDate: daysFromToday(-1) })],
    });
    expect(res.body.error.code).toBe('BATCH_EXPIRED');
  });

  test('a batch cost conflict rolls back the whole receipt', async () => {
    const itemA = itemFor(purchase, medA);
    const itemB = itemFor(purchase, medB);
    // Existing batch for B with a different cost.
    await admin.post('/api/v1/inventory/stock').send({
      branchId: branch.id, medicineId: medB.id, batchNumber: 'PAR-1', expiryDate: daysFromToday(400),
      purchasePrice: '9.99', sellingPrice: '12.00', quantity: 1,
    });
    const res = await pharmacist.post(`/api/v1/purchases/${purchase.id}/receive`).send({
      items: [receiveLine(itemA), receiveLine(itemB)],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BATCH_COST_CONFLICT');

    // Nothing from the failed receipt remains.
    expect(await stockOf(medA.id)).toBe(0);
    const state = await pool.query('SELECT status FROM purchases WHERE id = $1', [purchase.id]);
    expect(state.rows[0].status).toBe('PENDING');
    const receivings = await pool.query('SELECT count(*)::int AS n FROM purchase_receivings');
    expect(receivings.rows[0].n).toBe(0);
    const batchA = await pool.query("SELECT count(*)::int AS n FROM batches WHERE batch_number = 'AMO-1'");
    expect(batchA.rows[0].n).toBe(0);
  });

  test('receiving is idempotent', async () => {
    const body = { items: [receiveLine(itemFor(purchase, medA), { quantity: 10 })] };
    const first = await pharmacist.post(`/api/v1/purchases/${purchase.id}/receive`).set('Idempotency-Key', 'rcv-key-0001').send(body);
    const retry = await pharmacist.post(`/api/v1/purchases/${purchase.id}/receive`).set('Idempotency-Key', 'rcv-key-0001').send(body);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body.data.receivingId).toBe(first.body.data.receivingId);
    expect(await stockOf(medA.id)).toBe(10);
  });

  test('concurrent receipts cannot exceed the ordered quantity', async () => {
    const itemA = itemFor(purchase, medA);
    const attempts = await Promise.all([1, 2, 3].map((n) =>
      pharmacist.post(`/api/v1/purchases/${purchase.id}/receive`).send({
        items: [receiveLine(itemA, { quantity: 40, batchNumber: `C-${n}` })],
      })));
    expect(attempts.filter((r) => r.status === 201)).toHaveLength(2);
    expect(attempts.filter((r) => r.status === 409)).toHaveLength(1);
    expect(await stockOf(medA.id)).toBe(80);
  });

  test('notifies other branch users with purchase access', async () => {
    const other = await createUser({ role: 'ADMIN', branches: [branch] });
    await pharmacist.post(`/api/v1/purchases/${purchase.id}/receive`).send({ items: purchase.items.map((i) => receiveLine(i)) });
    const { rows } = await pool.query('SELECT type FROM notifications WHERE user_id = $1', [other.id]);
    expect(rows.map((r) => r.type)).toContain('PURCHASE_RECEIVED');
  });
});

describe('cancellation', () => {
  test('allowed before receiving and before payments; blocked afterwards', async () => {
    const p1 = (await pharmacist.post('/api/v1/purchases').send(purchaseBody())).body.data;
    expect((await pharmacist.post(`/api/v1/purchases/${p1.id}/cancel`).send({ reason: 'x' })).status).toBe(403);
    const cancelled = await admin.post(`/api/v1/purchases/${p1.id}/cancel`).send({ reason: 'Supplier out of stock' });
    expect(cancelled.body.data.status).toBe('CANCELLED');

    const p2 = (await pharmacist.post('/api/v1/purchases').send(purchaseBody())).body.data;
    await pharmacist.post(`/api/v1/purchases/${p2.id}/receive`).send({ items: [receiveLine(p2.items[0], { quantity: 1 })] });
    expect((await admin.post(`/api/v1/purchases/${p2.id}/cancel`).send({ reason: 'x' })).body.error.code).toBe('INVALID_STATUS_TRANSITION');

    const p3 = (await pharmacist.post('/api/v1/purchases').send(purchaseBody())).body.data;
    await admin.post('/api/v1/supplier-payments').send({ purchaseId: p3.id, amount: '10', paymentMethod: 'CASH' });
    expect((await admin.post(`/api/v1/purchases/${p3.id}/cancel`).send({ reason: 'x' })).body.error.code).toBe('PURCHASE_HAS_PAYMENTS');
  });
});

describe('supplier payments', () => {
  let purchase;

  beforeEach(async () => {
    purchase = (await pharmacist.post('/api/v1/purchases').send(purchaseBody())).body.data; // total 300.00
  });

  test('partial then full payment updates payment status and balance', async () => {
    const first = await admin.post('/api/v1/supplier-payments').send({ purchaseId: purchase.id, amount: '100.50', paymentMethod: 'BANK_TRANSFER', referenceNumber: 'TRX-1' });
    expect(first.status).toBe(201);
    let detail = (await admin.get(`/api/v1/purchases/${purchase.id}`)).body.data;
    expect(detail).toMatchObject({ amountPaid: '100.50', balance: '199.50', paymentStatus: 'PARTIALLY_PAID' });

    await admin.post('/api/v1/supplier-payments').send({ purchaseId: purchase.id, amount: '199.50', paymentMethod: 'CASH' });
    detail = (await admin.get(`/api/v1/purchases/${purchase.id}`)).body.data;
    expect(detail).toMatchObject({ paymentStatus: 'PAID', balance: '0.00' });
    expect(detail.payments).toHaveLength(2);

    const balance = await admin.get(`/api/v1/suppliers/${supplier.id}/balance`);
    expect(balance.body.data).toMatchObject({ totalPurchased: '300.00', totalPaid: '300.00', balance: '0.00', paidCount: 1 });
    // Payments never change stock.
    expect(await stockOf(medA.id)).toBe(0);
  });

  test('rejects overpayment, including concurrent payments', async () => {
    const over = await admin.post('/api/v1/supplier-payments').send({ purchaseId: purchase.id, amount: '300.01', paymentMethod: 'CASH' });
    expect(over.body.error.code).toBe('OVERPAYMENT_NOT_ALLOWED');

    const attempts = await Promise.all([1, 2, 3].map(() =>
      admin.post('/api/v1/supplier-payments').send({ purchaseId: purchase.id, amount: '150.00', paymentMethod: 'CASH' })));
    expect(attempts.filter((r) => r.status === 201)).toHaveLength(2);
    expect(attempts.filter((r) => r.body.error && r.body.error.code === 'OVERPAYMENT_NOT_ALLOWED')).toHaveLength(1);
  });

  test('draft purchases are not payable; payments are idempotent', async () => {
    const draft = (await pharmacist.post('/api/v1/purchases').send(purchaseBody({ status: 'DRAFT' }))).body.data;
    expect((await admin.post('/api/v1/supplier-payments').send({ purchaseId: draft.id, amount: '1', paymentMethod: 'CASH' })).body.error.code)
      .toBe('PURCHASE_NOT_PAYABLE');

    const body = { purchaseId: purchase.id, amount: '50', paymentMethod: 'CASH' };
    await admin.post('/api/v1/supplier-payments').set('Idempotency-Key', 'pay-key-0001').send(body);
    await admin.post('/api/v1/supplier-payments').set('Idempotency-Key', 'pay-key-0001').send(body);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM supplier_payments');
    expect(rows[0].n).toBe(1);
  });

  test('pharmacist cannot record or view payments by default', async () => {
    expect((await pharmacist.post('/api/v1/supplier-payments').send({ purchaseId: purchase.id, amount: '1', paymentMethod: 'CASH' })).status).toBe(403);
    const detail = await pharmacist.get(`/api/v1/purchases/${purchase.id}`);
    expect(detail.body.data.payments).toBeUndefined();
  });
});

describe('cost visibility', () => {
  test('a user with PURCHASE_VIEW but no cost permission sees no amounts', async () => {
    await pharmacist.post('/api/v1/purchases').send(purchaseBody());
    const cashierUser = await createUser({ role: 'CASHIER', branches: [branch] });
    await setOverride(cashierUser.id, 'PURCHASE_VIEW', true);
    const cashier = await loginAs(cashierUser);
    const list = await cashier.get('/api/v1/purchases');
    expect(list.status).toBe(200);
    const text = JSON.stringify(list.body.data);
    expect(list.body.data[0].createdAt).toEqual(expect.any(String));
    expect(text).not.toMatch(/"(subtotal|total|unitPurchasePrice|lineTotal|amountPaid|balance)"/);
    const detail = await cashier.get(`/api/v1/purchases/${list.body.data[0].id}`);
    expect(JSON.stringify(detail.body.data)).not.toMatch(/"(total|unitPurchasePrice|lineTotal)"/);
    expect(itemFor(detail.body.data, medA).orderedQuantity).toBe(100);
  });
});
