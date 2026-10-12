const { resetDatabase, pool } = require('../helpers/db');
const { createBranch, createUser, createMedicine, createStock } = require('../helpers/factories');
const { loginAs, request, app } = require('../helpers/session');

let branch;
let otherBranch;
let ownerUser;
let owner;
let admin;
let cashier;

beforeEach(async () => {
  await resetDatabase();
  branch = await createBranch({ name: 'Bole', code: 'BOLE' });
  otherBranch = await createBranch({ name: 'Piassa', code: 'PIASSA' });
  ownerUser = await createUser({ role: 'OWNER' });
  owner = await loginAs(ownerUser);
  admin = await loginAs(await createUser({ role: 'ADMIN', branches: [branch] }));
  cashier = await loginAs(await createUser({ role: 'CASHIER', branches: [branch], fullName: 'Selam Cashier' }));
});

afterAll(() => pool.end());

describe('audit logs', () => {
  test('are branch-scoped, permission-gated and protect financial values', async () => {
    const med = await createMedicine();
    const stockA = await owner.post('/api/v1/inventory/stock').send({
      branchId: branch.id, medicineId: med.id, batchNumber: 'A', expiryDate: '2030-01-01', purchasePrice: '5', sellingPrice: '8', quantity: 5,
    });
    expect(stockA.status).toBe(201);
    await owner.post('/api/v1/inventory/stock').send({
      branchId: otherBranch.id, medicineId: med.id, batchNumber: 'A', expiryDate: '2030-01-01', purchasePrice: '5', sellingPrice: '8', quantity: 5,
    });

    expect((await cashier.get('/api/v1/audit-logs')).status).toBe(403);

    const adminLogs = await admin.get('/api/v1/audit-logs?action=STOCK_ADDED');
    expect(adminLogs.body.data).toHaveLength(1);
    expect(adminLogs.body.data[0]).toMatchObject({ branchName: 'Bole', roleAtTime: 'OWNER', userId: ownerUser.id });
    expect(adminLogs.body.data[0].newValues.purchasePrice).toBe('5.00');
    expect((await owner.get('/api/v1/audit-logs?action=STOCK_ADDED')).body.data).toHaveLength(2);

    const foreign = (await owner.get(`/api/v1/audit-logs?action=STOCK_ADDED&branchId=${otherBranch.id}`)).body.data[0];
    expect((await admin.get(`/api/v1/audit-logs/${foreign.id}`)).status).toBe(403);
  });

  test('never contain secrets', async () => {
    await owner.post('/api/v1/users').send({ fullName: 'New', email: 'new@example.com', roleCode: 'CASHIER', branchIds: [branch.id] });
    const { rows } = await pool.query('SELECT previous_values, new_values, description FROM audit_logs');
    expect(JSON.stringify(rows)).not.toMatch(/password|token|hash/i);
  });

  test('cannot be modified or deleted', async () => {
    await owner.patch('/api/v1/users/me').send({ fullName: 'Owner Name' });
    await expect(pool.query("UPDATE audit_logs SET description = 'tampered'")).rejects.toThrow(/append-only/);
    // There is no write endpoint either.
    expect((await owner.delete('/api/v1/audit-logs')).status).toBe(404);
  });
});

describe('login history', () => {
  test('records failures and is visible with permission only', async () => {
    await request(app).post('/api/v1/auth/login').send({ email: 'nobody@example.com', password: 'Wrong12345' });
    expect((await cashier.get('/api/v1/login-history')).status).toBe(403);
    const res = await owner.get('/api/v1/login-history?success=false');
    expect(res.body.data[0]).toMatchObject({ success: false, failureCategory: 'INVALID_CREDENTIALS', userId: null });
    const adminView = await admin.get('/api/v1/login-history?eventType=LOGIN&success=true');
    // The admin sees logins of staff sharing their branch (self and the cashier), not unrelated users.
    expect(adminView.body.data.length).toBe(2);
  });
});

describe('settings', () => {
  test('owner updates settings; tax change is audited and notifies admins; history unchanged', async () => {
    const res = await owner.patch('/api/v1/settings').send({ taxEnabled: true, taxName: 'VAT', taxRate: '15', taxMode: 'INCLUDED', pharmacyName: 'Medicar' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ taxEnabled: true, taxRate: '15.000', taxMode: 'INCLUDED', country: 'Ethiopia', currencyCode: 'ETB' });

    const audit = await pool.query("SELECT new_values FROM audit_logs WHERE action = 'SETTINGS_UPDATED'");
    expect(audit.rows[0].new_values).toMatchObject({ taxEnabled: true, taxRate: '15.000' });
    const notes = await pool.query("SELECT count(*)::int AS n FROM notifications WHERE type = 'IMPORTANT_CONFIGURATION_CHANGE'");
    expect(notes.rows[0].n).toBe(1);

    // Every signed-in user gets the operational subset for the POS.
    const me = await cashier.get('/api/v1/auth/me');
    expect(me.body.data.pharmacy).toMatchObject({ name: 'Medicar', currencyCode: 'ETB', tax: { enabled: true, mode: 'INCLUDED' } });
  });

  test('validation and permissions', async () => {
    expect((await owner.patch('/api/v1/settings').send({ taxRate: '101' })).status).toBe(422);
    expect((await owner.patch('/api/v1/settings').send({ expiryWarningDays: 0 })).status).toBe(422);
    expect((await owner.patch('/api/v1/settings').send({ logoUrl: 'javascript:alert(1)' })).status).toBe(422);
    expect((await cashier.get('/api/v1/settings')).status).toBe(403);
    expect((await cashier.patch('/api/v1/settings').send({ pharmacyName: 'X' })).status).toBe(403);
  });

  test('system info exposes numbering but no secrets', async () => {
    const res = await owner.get('/api/v1/system/info');
    expect(res.body.data.numbering.prefixes.SALE).toBe('SAL');
    expect(res.body.data.businessTimezone).toBe('Africa/Addis_Ababa');
    expect(JSON.stringify(res.body.data)).not.toMatch(/postgres|DATABASE_URL|password|secret|smtp/i);
  });
});

describe('help center', () => {
  test('lists published articles by category, searches and opens by slug', async () => {
    const list = await cashier.get('/api/v1/help');
    expect(list.body.data.categories.map((c) => c.code)).toContain('POS_SALES');
    const search = await cashier.get('/api/v1/help/search?q=first expired');
    expect(search.body.data[0].slug).toBe('fefo');
    const article = await cashier.get('/api/v1/help/fefo');
    expect(article.body.data.body).toMatch(/expires first/);
  });

  test('draft and archived articles are hidden', async () => {
    await pool.query("UPDATE help_articles SET status = 'DRAFT' WHERE slug = 'fefo'");
    expect((await cashier.get('/api/v1/help/fefo')).status).toBe(404);
    expect((await cashier.get('/api/v1/help/search?q=fefo')).body.data.map((a) => a.slug)).not.toContain('fefo');
    await pool.query("UPDATE help_articles SET status = 'PUBLISHED' WHERE slug = 'fefo'");
  });
});

describe('global search', () => {
  test('returns only permitted entity types and branch-scoped records', async () => {
    const med = await createMedicine({ name: 'Selamycin' });
    await createStock({ branch, medicine: med, user: ownerUser, quantity: 5 });
    await admin.post('/api/v1/suppliers').send({ companyName: 'Selam Supplies', phone: '1' });

    const asCashier = await cashier.get('/api/v1/search?q=selam');
    expect(asCashier.body.data.groups.map((g) => g.type).sort()).toEqual(['MEDICINE']);

    const asAdmin = await admin.get('/api/v1/search?q=selam');
    expect(asAdmin.body.data.groups.map((g) => g.type).sort()).toEqual(['MEDICINE', 'STAFF', 'SUPPLIER']);

    const outsider = await loginAs(await createUser({ role: 'ADMIN', branches: [otherBranch] }));
    const outsiderResult = await outsider.get('/api/v1/search?q=Selam Cashier');
    expect(outsiderResult.body.data.groups.find((g) => g.type === 'STAFF')).toBeUndefined();
  });
});
