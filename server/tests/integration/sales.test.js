const { resetDatabase, pool } = require('../helpers/db');
const { createBranch, createUser, createMedicine, createStock, setOverride } = require('../helpers/factories');
const { loginAs } = require('../helpers/session');
const { daysFromToday } = require('../helpers/dates');

let branch;
let otherBranch;
let owner;
let cashierUser;
let cashier;
let pharmacist;
let admin;
let med;

beforeEach(async () => {
  await resetDatabase();
  branch = await createBranch({ name: 'Bole', code: 'BOLE' });
  otherBranch = await createBranch({ name: 'Piassa', code: 'PIASSA' });
  owner = await createUser({ role: 'OWNER' });
  cashierUser = await createUser({ role: 'CASHIER', branches: [branch] });
  cashier = await loginAs(cashierUser);
  pharmacist = await loginAs(await createUser({ role: 'PHARMACIST', branches: [branch] }));
  admin = await loginAs(await createUser({ role: 'ADMIN', branches: [branch] }));
  med = await createMedicine({ name: 'Amoxicillin', barcode: '1234567890' });
});

afterAll(() => pool.end());

async function stock(overrides) {
  return createStock({ branch, medicine: med, user: owner, ...overrides });
}

async function qty(batchId, branchId = branch.id) {
  const { rows } = await pool.query('SELECT quantity FROM branch_inventory WHERE batch_id = $1 AND branch_id = $2', [batchId, branchId]);
  return rows[0].quantity;
}

function saleBody(items, overrides = {}) {
  return { branchId: branch.id, items, paymentMethod: 'CASH', amountPaid: '0', ...overrides };
}

/** Sells, first asking the server for the total via a deliberately wrong payment. */
async function sell(session, items, overrides = {}) {
  const probe = await session.post('/api/v1/sales').send(saleBody(items, { ...overrides, amountPaid: '999999' }));
  if (probe.status !== 409 || probe.body.error.code !== 'INVALID_PAYMENT_AMOUNT') return probe;
  return session.post('/api/v1/sales').send(saleBody(items, { ...overrides, amountPaid: probe.body.error.details.total }));
}

describe('POS search', () => {
  test('finds by name and exact barcode with sellable stock and price', async () => {
    await stock({ quantity: 12, sellingPrice: '25.00' });
    await stock({ quantity: 50, expiryDate: daysFromToday(-3), sellingPrice: '1.00' }); // expired: not sellable

    const byName = await cashier.get(`/api/v1/medicines/search?q=amox&branchId=${branch.id}`);
    expect(byName.body.data[0]).toMatchObject({ name: 'Amoxicillin', sellableQuantity: 12, nextPrice: '25.00' });

    const byBarcode = await cashier.get(`/api/v1/medicines/search?q=1234567890&branchId=${branch.id}`);
    expect(byBarcode.body.data[0]).toMatchObject({ barcodeMatch: true });
  });
});

describe('creating a sale', () => {
  test('uses branch selling price and FEFO, ignoring client prices', async () => {
    const late = await stock({ batchNumber: 'LATE', expiryDate: daysFromToday(300), quantity: 10, sellingPrice: '20.00' });
    const early = await stock({ batchNumber: 'EARLY', expiryDate: daysFromToday(30), quantity: 3, sellingPrice: '20.00' });

    const res = await sell(cashier, [{ medicineId: med.id, quantity: 5 }]);
    expect(res.status).toBe(201);
    expect(res.body.data.receiptNumber).toMatch(/^SAL-\d{4}-000001$/);
    expect(res.body.data).toMatchObject({ subtotal: '100.00', total: '100.00', status: 'COMPLETED', paymentMethod: 'CASH' });
    expect(res.body.data.items[0].allocations.map((a) => [a.batchNumber, a.quantity])).toEqual([['EARLY', 3], ['LATE', 2]]);

    expect(await qty(early.batch.id)).toBe(0);
    expect(await qty(late.batch.id)).toBe(8);
    const moves = await pool.query("SELECT count(*)::int AS n FROM stock_movements WHERE movement_type = 'SALE'");
    expect(moves.rows[0].n).toBe(2);

    // A client-supplied price is rejected outright by validation.
    const tampered = await cashier.post('/api/v1/sales').send(saleBody([{ medicineId: med.id, quantity: 1, unitPrice: '0.01' }], { amountPaid: '0.01' }));
    expect(tampered.status).toBe(422);
  });

  test('splits lines when FEFO batches have different selling prices', async () => {
    await stock({ batchNumber: 'A', expiryDate: daysFromToday(30), quantity: 2, sellingPrice: '10.00' });
    await stock({ batchNumber: 'B', expiryDate: daysFromToday(60), quantity: 5, sellingPrice: '12.00' });
    const res = await sell(cashier, [{ medicineId: med.id, quantity: 4 }]);
    expect(res.body.data.items.map((i) => [i.quantity, i.unitSellingPrice])).toEqual([[2, '10.00'], [2, '12.00']]);
    expect(res.body.data.total).toBe('44.00');
  });

  test('expired stock is never sold', async () => {
    await stock({ expiryDate: daysFromToday(-1), quantity: 100 });
    const res = await sell(cashier, [{ medicineId: med.id, quantity: 1 }]);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
  });

  test('insufficient stock rolls back the whole sale', async () => {
    const other = await createMedicine({ name: 'Ibuprofen' });
    const a = await stock({ quantity: 10, sellingPrice: '5.00' });
    await createStock({ branch, medicine: other, user: owner, quantity: 1 });

    const res = await cashier.post('/api/v1/sales').send(saleBody(
      [{ medicineId: med.id, quantity: 5 }, { medicineId: other.id, quantity: 2 }],
      { amountPaid: '1000' },
    ));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(res.body.error.details.medicineName).toBe('Ibuprofen');
    expect(await qty(a.batch.id)).toBe(10);
    const sales = await pool.query('SELECT count(*)::int AS n FROM sales');
    expect(sales.rows[0].n).toBe(0);
    // The receipt number was not consumed.
    expect((await sell(cashier, [{ medicineId: med.id, quantity: 1 }])).body.data.receiptNumber).toMatch(/-000001$/);
  });

  test('payment must equal the total exactly', async () => {
    await stock({ quantity: 10, sellingPrice: '5.00' });
    const res = await cashier.post('/api/v1/sales').send(saleBody([{ medicineId: med.id, quantity: 2 }], { amountPaid: '9.99' }));
    expect(res.body.error).toMatchObject({ code: 'INVALID_PAYMENT_AMOUNT', details: { total: '10.00' } });
  });

  test('archived and draft medicines cannot be sold; inactive branches cannot sell', async () => {
    await stock({ quantity: 10 });
    await pool.query("UPDATE medicines SET status = 'ARCHIVED' WHERE id = $1", [med.id]);
    expect((await sell(cashier, [{ medicineId: med.id, quantity: 1 }])).body.error.code).toBe('MEDICINE_ARCHIVED');
    await pool.query("UPDATE medicines SET status = 'DRAFT' WHERE id = $1", [med.id]);
    expect((await sell(cashier, [{ medicineId: med.id, quantity: 1 }])).body.error.code).toBe('MEDICINE_NOT_ACTIVE');
    await pool.query("UPDATE medicines SET status = 'ACTIVE' WHERE id = $1", [med.id]);
    await pool.query("UPDATE branches SET status = 'INACTIVE' WHERE id = $1", [branch.id]);
    expect((await sell(cashier, [{ medicineId: med.id, quantity: 1 }])).body.error.code).toBe('BRANCH_INACTIVE');
  });

  test('cannot sell in a branch the user is not assigned to', async () => {
    await createStock({ branch: otherBranch, medicine: med, user: owner, quantity: 10 });
    const res = await sell(cashier, [{ medicineId: med.id, quantity: 1 }], { branchId: otherBranch.id });
    expect(res.body.error.code).toBe('BRANCH_ACCESS_DENIED');
  });

  test('discounts require permission; tax follows settings and is snapshotted', async () => {
    await stock({ quantity: 10, sellingPrice: '50.00' });
    const denied = await sell(cashier, [{ medicineId: med.id, quantity: 2 }], { discount: { type: 'PERCENTAGE', value: '10' } });
    expect(denied.status).toBe(403);

    await pool.query("UPDATE system_settings SET tax_enabled = true, tax_name = 'VAT', tax_rate = 15, tax_mode = 'ADDED_ON_TOP'");
    const res = await sell(admin, [{ medicineId: med.id, quantity: 2 }], { discount: { type: 'FIXED', value: '10' } });
    expect(res.body.data).toMatchObject({
      subtotal: '100.00', discount: '10.00', tax: '13.50', total: '103.50',
      taxName: 'VAT', taxRate: '15.000', taxMode: 'ADDED_ON_TOP', discountType: 'FIXED',
    });

    // Changing the tax rate later never changes the recorded sale.
    await pool.query('UPDATE system_settings SET tax_rate = 5');
    const again = await admin.get(`/api/v1/sales/${res.body.data.id}`);
    expect(again.body.data.tax).toBe('13.50');
  });

  test('FEFO override requires permission and a reason, and is recorded', async () => {
    const early = await stock({ batchNumber: 'EARLY', expiryDate: daysFromToday(30), quantity: 5 });
    const late = await stock({ batchNumber: 'LATE', expiryDate: daysFromToday(300), quantity: 5 });
    const item = { medicineId: med.id, quantity: 2, batchAllocations: [{ batchId: late.batch.id, quantity: 2 }] };

    expect((await sell(cashier, [{ ...item, fefoOverrideReason: 'Customer request' }])).status).toBe(403);
    const cashierWithOverride = await createUser({ role: 'CASHIER', branches: [branch] });
    await setOverride(cashierWithOverride.id, 'SALES_OVERRIDE_FEFO', true);
    const session = await loginAs(cashierWithOverride);
    expect((await sell(session, [item])).status).toBe(422);

    const res = await sell(session, [{ ...item, fefoOverrideReason: 'Customer asked for long expiry' }]);
    expect(res.status).toBe(201);
    expect(await qty(late.batch.id)).toBe(3);
    expect(await qty(early.batch.id)).toBe(5);

    const { rows } = await pool.query('SELECT user_id, branch_id, medicine_id, sale_id, recommended_allocation, actual_allocation, reason FROM fefo_overrides');
    expect(rows[0]).toMatchObject({
      user_id: cashierWithOverride.id,
      branch_id: branch.id,
      medicine_id: med.id,
      sale_id: res.body.data.id,
      recommended_allocation: [{ batchId: early.batch.id, quantity: 2 }],
      actual_allocation: [{ batchId: late.batch.id, quantity: 2 }],
      reason: 'Customer asked for long expiry',
    });
  });

  test('concurrent sales of the last units never oversell', async () => {
    const s = await stock({ quantity: 5, sellingPrice: '10.00' });
    const attempts = await Promise.all(
      Array.from({ length: 4 }, () => cashier.post('/api/v1/sales').send(saleBody([{ medicineId: med.id, quantity: 2 }], { amountPaid: '20.00' }))),
    );
    expect(attempts.filter((r) => r.status === 201)).toHaveLength(2);
    expect(attempts.filter((r) => r.status === 409)).toHaveLength(2);
    expect(await qty(s.batch.id)).toBe(1);
    const numbers = attempts.filter((r) => r.status === 201).map((r) => r.body.data.receiptNumber).sort();
    expect(numbers.map((n) => n.slice(-6))).toEqual(['000001', '000002']);
  });

  test('retrying with the same Idempotency-Key does not sell twice', async () => {
    const s = await stock({ quantity: 10, sellingPrice: '10.00' });
    const body = saleBody([{ medicineId: med.id, quantity: 1 }], { amountPaid: '10.00' });
    const [a, b] = await Promise.all([
      cashier.post('/api/v1/sales').set('Idempotency-Key', 'sale-key-0001').send(body),
      cashier.post('/api/v1/sales').set('Idempotency-Key', 'sale-key-0001').send(body),
    ]);
    expect(a.body.data.id).toBe(b.body.data.id);
    expect(await qty(s.batch.id)).toBe(9);
  });

  test('audit records the actor, role and branch', async () => {
    await stock({ quantity: 10 });
    const res = await sell(cashier, [{ medicineId: med.id, quantity: 1 }]);
    const { rows } = await pool.query("SELECT user_id, role_at_time, branch_id, entity_id FROM audit_logs WHERE action = 'SALE_COMPLETED'");
    expect(rows[0]).toEqual({ user_id: cashierUser.id, role_at_time: 'CASHIER', branch_id: branch.id, entity_id: res.body.data.id });
  });
});

describe('viewing sales', () => {
  test('cashier never receives cost or profit; admin does', async () => {
    await stock({ quantity: 10, purchasePrice: '6.00', sellingPrice: '10.00' });
    const sale = (await sell(cashier, [{ medicineId: med.id, quantity: 2 }])).body.data;
    expect(JSON.stringify(sale)).not.toMatch(/purchasePriceAtSale|cogs|grossProfit/);

    const asAdmin = await admin.get(`/api/v1/sales/${sale.id}`);
    expect(asAdmin.body.data).toMatchObject({ cogs: '12.00', grossProfit: '8.00' });
    expect(asAdmin.body.data.items[0].allocations[0].purchasePriceAtSale).toBe('6.00');
  });

  test('sales history filters, own sales and visibility', async () => {
    await stock({ quantity: 100, sellingPrice: '10.00' });
    await sell(cashier, [{ medicineId: med.id, quantity: 1 }]);
    await sell(admin, [{ medicineId: med.id, quantity: 3 }], { paymentMethod: 'BANK_TRANSFER' });

    expect((await cashier.get('/api/v1/sales/my')).body.data).toHaveLength(1);
    expect((await cashier.get('/api/v1/sales')).body.data).toHaveLength(2);
    expect((await admin.get('/api/v1/sales?paymentMethod=BANK_TRANSFER')).body.data).toHaveLength(1);
    expect((await admin.get('/api/v1/sales?minAmount=20')).body.data).toHaveLength(1);
    expect((await admin.get(`/api/v1/sales?medicineId=${med.id}&sortBy=total&sortOrder=asc`)).body.data.map((s) => s.total)).toEqual(['10.00', '30.00']);

    // Without SALES_VIEW_HISTORY a user only sees their own sales.
    await setOverride(cashierUser.id, 'SALES_VIEW_HISTORY', false);
    const restricted = await loginAs(cashierUser);
    expect((await restricted.get('/api/v1/sales')).status).toBe(403);
    const adminSale = (await admin.get('/api/v1/sales?paymentMethod=BANK_TRANSFER')).body.data[0];
    expect((await restricted.get(`/api/v1/sales/${adminSale.id}`)).status).toBe(404);
  });

  test('receipt uses historical values and branch receipt settings', async () => {
    await stock({ quantity: 10, sellingPrice: '10.00' });
    const sale = (await sell(cashier, [{ medicineId: med.id, quantity: 2 }])).body.data;
    await pool.query("UPDATE branch_inventory SET selling_price = 99");
    await pool.query("UPDATE branch_settings SET receipt_show_staff = false, receipt_footer = 'Get well soon' WHERE branch_id = $1", [branch.id]);
    const receipt = (await cashier.get(`/api/v1/sales/${sale.id}/receipt`)).body.data;
    expect(receipt).toMatchObject({
      receiptNumber: sale.receiptNumber, total: '20.00', staff: null, footer: 'Get well soon', paymentMethod: 'CASH',
    });
    expect(receipt.items[0]).toEqual({ medicineName: 'Amoxicillin', quantity: 2, unitSellingPrice: '10.00', lineTotal: '20.00' });
    expect(receipt.pharmacy.currencyCode).toBe('ETB');
  });
});

describe('refunds', () => {
  let sale;
  let early;
  let late;

  beforeEach(async () => {
    early = await stock({ batchNumber: 'EARLY', expiryDate: daysFromToday(30), quantity: 2, sellingPrice: '10.00' });
    late = await stock({ batchNumber: 'LATE', expiryDate: daysFromToday(300), quantity: 10, sellingPrice: '10.00' });
    sale = (await sell(cashier, [{ medicineId: med.id, quantity: 3 }], { paymentMethod: 'BANK_TRANSFER' })).body.data;
  });

  test('partial refunds return stock to original batches and track remaining quantity', async () => {
    const item = sale.items[0];
    const first = await cashier.post('/api/v1/refunds').send({ saleId: sale.id, reason: 'CUSTOMER_RETURN', items: [{ saleItemId: item.id, quantity: 1 }] });
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ refundTotal: '10.00', paymentMethod: 'BANK_TRANSFER' });
    expect(first.body.data.refundNumber).toMatch(/^REF-\d{4}-000001$/);
    expect(first.body.data.items[0].allocations).toEqual([{ batchId: early.batch.id, batchNumber: 'EARLY', quantity: 1 }]);
    expect(await qty(early.batch.id)).toBe(1);

    const second = await cashier.post('/api/v1/refunds').send({ saleId: sale.id, reason: 'CUSTOMER_RETURN', items: [{ saleItemId: item.id, quantity: 2 }] });
    expect(second.status).toBe(201);
    expect(await qty(early.batch.id)).toBe(2);
    expect(await qty(late.batch.id)).toBe(10);

    const over = await cashier.post('/api/v1/refunds').send({ saleId: sale.id, reason: 'CUSTOMER_RETURN', items: [{ saleItemId: item.id, quantity: 1 }] });
    expect(over.body.error.code).toBe('REFUND_EXCEEDS_REMAINING');

    const detail = (await cashier.get(`/api/v1/sales/${sale.id}`)).body.data;
    expect(detail.items[0]).toMatchObject({ refundedQuantity: 3, refundableQuantity: 0, refundedAmount: '30.00' });
    expect(detail.refunds).toHaveLength(2);

    const moves = await pool.query("SELECT sum(quantity_change)::int AS n FROM stock_movements WHERE movement_type = 'REFUND'");
    expect(moves.rows[0].n).toBe(3);
  });

  test('OTHER requires a note; refunds are idempotent', async () => {
    const item = sale.items[0];
    expect((await cashier.post('/api/v1/refunds').send({ saleId: sale.id, reason: 'OTHER', items: [{ saleItemId: item.id, quantity: 1 }] })).status).toBe(422);

    const body = { saleId: sale.id, reason: 'WRONG_ITEM', items: [{ saleItemId: item.id, quantity: 1 }] };
    const a = await cashier.post('/api/v1/refunds').set('Idempotency-Key', 'refund-key-01').send(body);
    const b = await cashier.post('/api/v1/refunds').set('Idempotency-Key', 'refund-key-01').send(body);
    expect(a.body.data.id).toBe(b.body.data.id);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM refunds');
    expect(rows[0].n).toBe(1);
  });

  test('concurrent refunds cannot exceed the sold quantity', async () => {
    const item = sale.items[0];
    const attempts = await Promise.all([1, 2, 3].map(() =>
      cashier.post('/api/v1/refunds').send({ saleId: sale.id, reason: 'CUSTOMER_RETURN', items: [{ saleItemId: item.id, quantity: 2 }] })));
    expect(attempts.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await qty(early.batch.id) + await qty(late.batch.id)).toBe(9 + 2);
  });

  test('a sale with refunds cannot be voided', async () => {
    await cashier.post('/api/v1/refunds').send({ saleId: sale.id, reason: 'CUSTOMER_RETURN', items: [{ saleItemId: sale.items[0].id, quantity: 1 }] });
    const res = await admin.post(`/api/v1/sales/${sale.id}/void`).send({ reason: 'Mistake' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SALE_HAS_REFUNDS');
  });
});

describe('voiding', () => {
  test('restores exact allocations, keeps history and blocks refunds', async () => {
    const early = await stock({ batchNumber: 'EARLY', expiryDate: daysFromToday(30), quantity: 2, sellingPrice: '10.00' });
    const late = await stock({ batchNumber: 'LATE', expiryDate: daysFromToday(300), quantity: 10, sellingPrice: '10.00' });
    const sale = (await sell(cashier, [{ medicineId: med.id, quantity: 5 }])).body.data;

    expect((await cashier.post(`/api/v1/sales/${sale.id}/void`).send({ reason: 'x' })).status).toBe(403);
    const voided = await admin.post(`/api/v1/sales/${sale.id}/void`).send({ reason: 'Entered twice' });
    expect(voided.status).toBe(200);
    expect(voided.body.data).toMatchObject({ status: 'VOIDED', voidReason: 'Entered twice' });
    expect(await qty(early.batch.id)).toBe(2);
    expect(await qty(late.batch.id)).toBe(10);

    const moves = await pool.query("SELECT movement_type, reference_type, sum(quantity_change)::int AS n FROM stock_movements WHERE reference_type = 'SALE_VOID' GROUP BY 1, 2");
    expect(moves.rows).toEqual([{ movement_type: 'CORRECTION', reference_type: 'SALE_VOID', n: 5 }]);

    expect((await admin.post(`/api/v1/sales/${sale.id}/void`).send({ reason: 'again' })).body.error.code).toBe('SALE_ALREADY_VOIDED');
    const refund = await admin.post('/api/v1/refunds').send({ saleId: sale.id, reason: 'CUSTOMER_RETURN', items: [{ saleItemId: sale.items[0].id, quantity: 1 }] });
    expect(refund.body.error.code).toBe('SALE_NOT_REFUNDABLE');

    // The voided sale stays in history.
    expect((await admin.get(`/api/v1/sales?status=VOIDED`)).body.data).toHaveLength(1);
  });

  test('concurrent void and refund: exactly one wins', async () => {
    await stock({ quantity: 10, sellingPrice: '10.00' });
    const sale = (await sell(cashier, [{ medicineId: med.id, quantity: 2 }])).body.data;
    const [v, r] = await Promise.all([
      admin.post(`/api/v1/sales/${sale.id}/void`).send({ reason: 'x' }),
      admin.post('/api/v1/refunds').send({ saleId: sale.id, reason: 'CUSTOMER_RETURN', items: [{ saleItemId: sale.items[0].id, quantity: 1 }] }),
    ]);
    // Either the void wins (refund rejected) or the refund wins (void rejected), never both.
    expect([v.status === 200, r.status === 201].filter(Boolean)).toHaveLength(1);
    expect(v.status === 200 ? r.body.error.code : v.body.error.code).toBe(v.status === 200 ? 'SALE_NOT_REFUNDABLE' : 'SALE_HAS_REFUNDS');
    const { rows } = await pool.query('SELECT sum(quantity)::int AS q FROM branch_inventory');
    expect(rows[0].q).toBe(v.status === 200 ? 10 : 9);
  });
});
