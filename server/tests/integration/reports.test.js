const { resetDatabase, pool } = require('../helpers/db');
const { createBranch, createUser, createMedicine, createStock } = require('../helpers/factories');
const { loginAs } = require('../helpers/session');
const { daysFromToday, today } = require('../helpers/dates');
const { bumpVersion } = require('../../src/utils/cache');

let branch;
let otherBranch;
let owner;
let ownerSession;
let admin;
let cashier;
let med;

async function sell(session, branchId, medicineId, quantity) {
  const probe = await session.post('/api/v1/sales').send({ branchId, items: [{ medicineId, quantity }], paymentMethod: 'CASH', amountPaid: '999999' });
  const res = await session.post('/api/v1/sales').send({
    branchId, items: [{ medicineId, quantity }], paymentMethod: 'CASH', amountPaid: probe.body.error.details.total,
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

beforeEach(async () => {
  await resetDatabase();
  branch = await createBranch({ name: 'Bole', code: 'BOLE' });
  otherBranch = await createBranch({ name: 'Piassa', code: 'PIASSA' });
  owner = await createUser({ role: 'OWNER' });
  ownerSession = await loginAs(owner);
  admin = await loginAs(await createUser({ role: 'ADMIN', branches: [branch] }));
  cashier = await loginAs(await createUser({ role: 'CASHIER', branches: [branch] }));
  med = await createMedicine({ name: 'Amoxicillin' });
  // Cost 6.00, price 10.00 -> 4.00 gross profit per unit (no tax).
  await createStock({ branch, medicine: med, user: owner, quantity: 100, purchasePrice: '6.00', sellingPrice: '10.00' });
  await createStock({ branch: otherBranch, medicine: med, user: owner, quantity: 100, purchasePrice: '6.00', sellingPrice: '10.00', batchNumber: 'OTHER' });
});

afterAll(() => pool.end());

describe('sales and profit calculations', () => {
  test('completed sales count; refunds reverse revenue and cost; voids are excluded', async () => {
    const s1 = await sell(cashier, branch.id, med.id, 5); // 50.00
    await sell(cashier, branch.id, med.id, 3); // 30.00
    const voided = await sell(cashier, branch.id, med.id, 2); // 20.00, voided below
    await admin.post(`/api/v1/sales/${voided.id}/void`).send({ reason: 'Mistake' });
    await admin.post('/api/v1/refunds').send({ saleId: s1.id, reason: 'CUSTOMER_RETURN', items: [{ saleItemId: s1.items[0].id, quantity: 1 }] });

    const sales = await admin.get('/api/v1/reports/sales?range=TODAY');
    expect(sales.status).toBe(200);
    expect(sales.body.data.summary).toMatchObject({
      totalSales: '80.00',
      transactionCount: 2,
      itemsSold: 8,
      averageTransactionValue: '40.00',
      cashSales: '80.00',
      refunds: '10.00',
      netSales: '70.00',
      voidedCount: 1,
      voidedTotal: '20.00',
    });
    expect(sales.body.data.summary.cogs).toBeUndefined(); // profit is not part of the sales report

    const profit = await admin.get('/api/v1/reports/profit?range=TODAY');
    // Revenue 80 - 10 refunded = 70; COGS 48 - 6 refunded = 42; profit 28
    expect(profit.body.data.summary).toMatchObject({ revenue: '70.00', cogs: '42.00', grossProfit: '28.00', grossMargin: '40.00' });
    expect(profit.body.data.rows[0]).toMatchObject({ medicineName: 'Amoxicillin', quantitySold: 8, quantityRefunded: 1, netQuantity: 7 });

    const dashboard = await admin.get('/api/v1/analytics/dashboard?range=TODAY');
    expect(dashboard.body.data.sales).toMatchObject({ totalSales: '80.00', transactionCount: 2, itemsSold: 8 });
    expect(dashboard.body.data.financials).toMatchObject({ revenue: '70.00', cogs: '42.00', grossProfit: '28.00', netSales: '70.00' });
  });

  test('tax is excluded from revenue', async () => {
    await pool.query("UPDATE system_settings SET tax_enabled = true, tax_rate = 15, tax_mode = 'ADDED_ON_TOP'");
    await sell(cashier, branch.id, med.id, 2); // 20 + 3 tax = 23
    const profit = await admin.get('/api/v1/reports/profit');
    expect(profit.body.data.summary).toMatchObject({ revenue: '20.00', tax: '3.00', cogs: '12.00', grossProfit: '8.00' });
  });

  test('date boundaries use the business calendar and reject future dates', async () => {
    const sale = await sell(cashier, branch.id, med.id, 1);
    await pool.query('ALTER TABLE sales DISABLE TRIGGER trg_sales_protect_history');
    await pool.query(`UPDATE sales SET completed_at = ($1::date - 1)::timestamp AT TIME ZONE 'Africa/Addis_Ababa' + interval '23 hours 59 minutes' WHERE id = $2`, [today(), sale.id]);
    await pool.query('ALTER TABLE sales ENABLE TRIGGER trg_sales_protect_history');
    bumpVersion();

    expect((await admin.get('/api/v1/reports/sales?range=TODAY')).body.data.summary.transactionCount).toBe(0);
    const yesterday = daysFromToday(-1);
    expect((await admin.get(`/api/v1/reports/sales?dateFrom=${yesterday}&dateTo=${yesterday}`)).body.data.summary.transactionCount).toBe(1);

    const future = await admin.get(`/api/v1/reports/sales?dateFrom=${today()}&dateTo=${daysFromToday(1)}`);
    expect(future.status).toBe(422);
    expect((await admin.get(`/api/v1/analytics/sales-trend?dateFrom=${daysFromToday(1)}`)).status).toBe(422);
  });

  test('sales trend is zero-filled at the right granularity', async () => {
    await sell(cashier, branch.id, med.id, 1);
    const week = await admin.get('/api/v1/analytics/sales-trend?range=WEEK');
    expect(week.body.data.granularity).toBe('day');
    expect(week.body.data.series).toHaveLength(7);
    expect(week.body.data.series[6]).toMatchObject({ period: today(), sales: '10.00', transactions: 1 });
    const day = await admin.get('/api/v1/analytics/sales-trend?range=TODAY');
    expect(day.body.data.granularity).toBe('hour');
    expect(day.body.data.series).toHaveLength(24);
  });
});

describe('branch scoping and financial protection', () => {
  test('non-owners only see their branches; owner can compare all', async () => {
    await sell(cashier, branch.id, med.id, 1);
    await sell(ownerSession, otherBranch.id, med.id, 4);

    expect((await admin.get('/api/v1/reports/sales')).body.data.summary.transactionCount).toBe(1);
    expect((await admin.get(`/api/v1/reports/sales?branchId=${otherBranch.id}`)).status).toBe(403);
    expect((await ownerSession.get('/api/v1/reports/sales')).body.data.summary.totalSales).toBe('50.00');

    const comparison = await ownerSession.get('/api/v1/analytics/branch-comparison');
    expect(comparison.body.data.branches.map((b) => [b.branchCode, b.totalSales])).toEqual([['PIASSA', '40.00'], ['BOLE', '10.00']]);
    const adminComparison = await admin.get('/api/v1/analytics/branch-comparison');
    expect(adminComparison.body.data.branches.map((b) => b.branchCode)).toEqual(['BOLE']);
  });

  test('dashboard shows stock losses at cost, skipping disposals not recorded as a loss', async () => {
    const { rows } = await pool.query(
      'SELECT bi.id FROM branch_inventory bi WHERE bi.branch_id = $1', [branch.id],
    );
    const inventoryId = rows[0].id;
    await admin.post(`/api/v1/inventory/${inventoryId}/dispose`).send({ quantity: 3, notes: 'Broken bottles' }).expect(201);
    await admin.post(`/api/v1/inventory/${inventoryId}/dispose`).send({ quantity: 2, notes: 'Returned for credit', recordAsLoss: false }).expect(201);

    const dash = await admin.get(`/api/v1/analytics/dashboard?range=TODAY&branchId=${branch.id}`);
    expect(dash.body.data.financials).toMatchObject({ stockLosses: '18.00', stockLossUnits: 3 });

    const cashierDash = await cashier.get('/api/v1/analytics/dashboard?range=TODAY');
    expect(JSON.stringify(cashierDash.body.data)).not.toMatch(/stockLoss/);
  });

  test('cashier dashboard has no financial or profit KPIs, even right after an admin read (cache isolation)', async () => {
    await sell(cashier, branch.id, med.id, 2);
    const adminDash = await admin.get('/api/v1/analytics/dashboard');
    expect(adminDash.body.data.financials.grossProfit).toBe('8.00');

    const cashierDash = await cashier.get('/api/v1/analytics/dashboard');
    expect(cashierDash.status).toBe(200);
    expect(cashierDash.body.data.sales.totalSales).toBe('20.00');
    expect(JSON.stringify(cashierDash.body.data)).not.toMatch(/revenue|cogs|grossProfit|inventoryValue|netSales/);

    const top = await cashier.get('/api/v1/analytics/top-medicines');
    expect(top.body.data.items[0]).toMatchObject({ medicineName: 'Amoxicillin', netQuantity: 2 });
    expect(JSON.stringify(top.body.data)).not.toMatch(/cogs|grossProfit|revenue/);
  });

  test('cashier cannot open reports or exports', async () => {
    for (const path of ['/api/v1/reports/sales', '/api/v1/reports/profit', '/api/v1/reports/inventory', '/api/v1/reports/sales/export']) {
      expect((await cashier.get(path)).status).toBe(403);
    }
  });

  test('inventory report hides cost without permission', async () => {
    const pharmacistUser = await createUser({ role: 'PHARMACIST', branches: [branch] });
    await pool.query(
      `INSERT INTO user_permission_overrides (user_id, permission_id, granted)
       SELECT $1, id, v.g FROM permissions, (VALUES ('REPORT_INVENTORY_VIEW', true), ('FINANCIAL_VIEW_PURCHASE_COST', false)) v(c, g)
        WHERE code = v.c`,
      [pharmacistUser.id],
    );
    const pharmacist = await loginAs(pharmacistUser);
    const res = await pharmacist.get('/api/v1/reports/inventory');
    expect(res.status).toBe(200);
    expect(res.body.data.rows[0]).toMatchObject({ medicineName: 'Amoxicillin', sellableQuantity: 100 });
    expect(JSON.stringify(res.body.data)).not.toMatch(/inventoryValue|expiredValue|Value \(cost\)/);
    expect((await admin.get('/api/v1/reports/inventory')).body.data.summary.inventoryValue).toBe('600.00');
  });
});

describe('exports', () => {
  test('CSV export uses the same filters and is audited', async () => {
    await sell(cashier, branch.id, med.id, 2);
    await sell(cashier, branch.id, med.id, 7);
    const res = await admin.get('/api/v1/reports/sales/export?format=csv&minAmount=50');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toContain('Receipt');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('70.00');

    const audit = await pool.query("SELECT new_values FROM audit_logs WHERE action = 'REPORT_EXPORTED'");
    expect(audit.rows[0].new_values).toMatchObject({ report: 'sales', format: 'csv' });
  });

  test('PDF export renders', async () => {
    await sell(cashier, branch.id, med.id, 1);
    const res = await admin.get('/api/v1/reports/inventory/export?format=pdf').buffer(true).parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body.slice(0, 4).toString()).toBe('%PDF');
  });

  test('exports never include fields hidden from the user', async () => {
    const user = await createUser({ role: 'PHARMACIST', branches: [branch] });
    await pool.query(
      `INSERT INTO user_permission_overrides (user_id, permission_id, granted)
       SELECT $1, id, v.g FROM permissions, (VALUES ('REPORT_PURCHASE_VIEW', true), ('REPORT_EXPORT', true), ('FINANCIAL_VIEW_PURCHASE_COST', false)) v(c, g)
        WHERE code = v.c`,
      [user.id],
    );
    const supplier = (await admin.post('/api/v1/suppliers').send({ companyName: 'Acme', phone: '1' })).body.data.supplier;
    await admin.post('/api/v1/purchases').send({
      supplierId: supplier.id, branchId: branch.id, status: 'PENDING',
      items: [{ medicineId: med.id, orderedQuantity: 10, unitPurchasePrice: '6.00' }],
    });
    const session = await loginAs(user);
    const report = await session.get('/api/v1/reports/purchases');
    expect(report.body.pagination.total).toBe(1);
    expect(report.body.data.summary.purchaseCount).toBe(1);
    expect(report.body.data.summary.orderedValue).toBeUndefined();
    const csv = await session.get('/api/v1/reports/purchases/export?format=csv');
    expect(csv.status).toBe(200);
    expect(csv.text.split('\r\n')[0]).not.toMatch(/Total|Paid|Balance/);
    expect(csv.text).not.toContain('60.00');
  });
});

describe('refund filters and export', () => {
  async function refund(sale, quantity) {
    const res = await admin.post('/api/v1/refunds').send({ saleId: sale.id, reason: 'CUSTOMER_RETURN', items: [{ saleItemId: sale.items[0].id, quantity }] });
    expect(res.status).toBe(201);
    return res.body.data;
  }

  test('the refunds list filters by amount and exports the same rows as CSV and PDF', async () => {
    const small = await refund(await sell(cashier, branch.id, med.id, 1), 1); // 10.00
    const large = await refund(await sell(cashier, branch.id, med.id, 6), 5); // 50.00

    const amounts = async (q) => (await admin.get(`/api/v1/refunds?${q}`)).body.data.map((r) => r.refundNumber).sort();
    expect(await amounts('minAmount=20')).toEqual([large.refundNumber]);
    expect(await amounts('maxAmount=20')).toEqual([small.refundNumber]);

    const report = await admin.get('/api/v1/reports/refunds?minAmount=20');
    expect(report.body.data.summary).toMatchObject({ refundCount: 1, totalRefunded: '50.00' });

    const csv = await admin.get('/api/v1/reports/refunds/export?format=csv&reason=CUSTOMER_RETURN&maxAmount=20');
    const lines = csv.text.trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(small.refundNumber);

    const pdf = await admin.get('/api/v1/reports/refunds/export?format=pdf').buffer(true).parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');
    expect((await cashier.get('/api/v1/reports/refunds/export?format=csv')).status).toBe(403);
  });
});
