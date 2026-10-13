const { resetDatabase, pool } = require('../helpers/db');
const { createBranch, createUser } = require('../helpers/factories');
const { loginAs } = require('../helpers/session');

let branch;
let pharmacist;
let admin;
let cashier;

const paracetamol = {
  name: 'Paracetamol',
  strength: '500 mg',
  dosageForm: 'Tablet',
  packageSize: '10 tablets',
  prescriptionRequired: false,
};

beforeEach(async () => {
  await resetDatabase();
  branch = await createBranch();
  pharmacist = await loginAs(await createUser({ role: 'PHARMACIST', branches: [branch] }));
  admin = await loginAs(await createUser({ role: 'ADMIN', branches: [branch] }));
  cashier = await loginAs(await createUser({ role: 'CASHIER', branches: [branch] }));
});

afterAll(() => pool.end());

describe('medicine categories', () => {
  test('create, rename, archive and restore with audit trail', async () => {
    const created = await admin.post('/api/v1/medicine-categories').send({ name: 'Hormones' });
    expect(created.status).toBe(201);
    const id = created.body.data.id;

    const dup = await admin.post('/api/v1/medicine-categories').send({ name: 'hormones' });
    expect(dup.body.error.code).toBe('DUPLICATE_CATEGORY');

    expect((await admin.patch(`/api/v1/medicine-categories/${id}`).send({ name: 'Hormonal' })).body.data.name).toBe('Hormonal');
    expect((await admin.post(`/api/v1/medicine-categories/${id}/archive`)).body.data.status).toBe('ARCHIVED');
    expect((await admin.post(`/api/v1/medicine-categories/${id}/archive`)).body.error.code).toBe('INVALID_STATUS_TRANSITION');
    expect((await admin.post(`/api/v1/medicine-categories/${id}/restore`)).body.data.status).toBe('ACTIVE');

    const audit = await pool.query('SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY created_at', [id]);
    expect(audit.rows.map((r) => r.action)).toEqual([
      'CATEGORY_CREATED', 'CATEGORY_UPDATED', 'CATEGORY_ARCHIVED', 'CATEGORY_RESTORED',
    ]);
  });

  test('archived categories cannot be assigned but existing references remain', async () => {
    const category = (await admin.post('/api/v1/medicine-categories').send({ name: 'Old' })).body.data;
    const med = await pharmacist.post('/api/v1/medicines').send({ ...paracetamol, categoryId: category.id });
    expect(med.status).toBe(201);

    await admin.post(`/api/v1/medicine-categories/${category.id}/archive`);
    const res = await pharmacist.post('/api/v1/medicines').send({ ...paracetamol, name: 'Other', categoryId: category.id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CATEGORY_ARCHIVED');

    const existing = await pharmacist.get(`/api/v1/medicines/${med.body.data.medicine.id}`);
    expect(existing.body.data.categoryName).toBe('Old');
  });

  test('cashier can view but not create categories', async () => {
    expect((await cashier.get('/api/v1/medicine-categories')).status).toBe(200);
    expect((await cashier.post('/api/v1/medicine-categories').send({ name: 'X' })).status).toBe(403);
  });
});

describe('medicines', () => {
  test('are created as DRAFT and can be activated', async () => {
    const res = await pharmacist.post('/api/v1/medicines').send(paracetamol);
    expect(res.status).toBe(201);
    expect(res.body.data.medicine.status).toBe('DRAFT');
    expect(res.body.data.warnings.duplicates).toEqual([]);

    const activated = await pharmacist.patch(`/api/v1/medicines/${res.body.data.medicine.id}`).send({ status: 'ACTIVE' });
    expect(activated.body.data.medicine.status).toBe('ACTIVE');
  });

  test('require name, package size and prescription flag', async () => {
    const res = await pharmacist.post('/api/v1/medicines').send({ name: 'X' });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.details.fields)).toEqual(
      expect.arrayContaining(['packageSize', 'prescriptionRequired']),
    );
  });

  test('duplicate identity produces a warning, not a rejection', async () => {
    await pharmacist.post('/api/v1/medicines').send(paracetamol);
    const second = await pharmacist.post('/api/v1/medicines').send({ ...paracetamol, name: 'PARACETAMOL', strength: '500 MG' });
    expect(second.status).toBe(201);
    expect(second.body.data.warnings.duplicates).toHaveLength(1);

    const different = await pharmacist.post('/api/v1/medicines').send({ ...paracetamol, strength: '1 g' });
    expect(different.body.data.warnings.duplicates).toHaveLength(0);
  });

  test('barcodes are optional but unique', async () => {
    const a = await pharmacist.post('/api/v1/medicines').send({ ...paracetamol, barcode: '6291041500213' });
    expect(a.status).toBe(201);
    const b = await pharmacist.post('/api/v1/medicines').send({ ...paracetamol, name: 'Ibuprofen', barcode: '6291041500213' });
    expect(b.status).toBe(409);
    expect(b.body.error.code).toBe('DUPLICATE_BARCODE');

    const c = (await pharmacist.post('/api/v1/medicines').send({ ...paracetamol, name: 'Amoxicillin' })).body.data.medicine;
    const conflict = await pharmacist.patch(`/api/v1/medicines/${c.id}/barcode`).send({ barcode: '6291041500213' });
    expect(conflict.body.error.code).toBe('DUPLICATE_BARCODE');

    const set = await pharmacist.patch(`/api/v1/medicines/${c.id}/barcode`).send({ barcode: '111' });
    expect(set.body.data.barcode).toBe('111');
    const cleared = await pharmacist.patch(`/api/v1/medicines/${c.id}/barcode`).send({ barcode: '' });
    expect(cleared.body.data.barcode).toBeNull();

    const audit = await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'BARCODE_CHANGED'");
    expect(audit.rows[0].n).toBe(2);
  });

  test('archive and restore; archived medicines cannot be edited', async () => {
    const med = (await pharmacist.post('/api/v1/medicines').send(paracetamol)).body.data.medicine;
    expect((await pharmacist.post(`/api/v1/medicines/${med.id}/archive`)).body.data.status).toBe('ARCHIVED');
    const edit = await pharmacist.patch(`/api/v1/medicines/${med.id}`).send({ name: 'New' });
    expect(edit.body.error.code).toBe('MEDICINE_ARCHIVED');

    // Pharmacists can restore what they archive.
    expect((await pharmacist.post(`/api/v1/medicines/${med.id}/restore`)).body.data.status).toBe('ACTIVE');
    expect((await pharmacist.post(`/api/v1/medicines/${med.id}/archive`)).body.data.status).toBe('ARCHIVED');
    expect((await admin.post(`/api/v1/medicines/${med.id}/restore`)).body.data.status).toBe('ACTIVE');
  });

  test('cashier can view and search but not create', async () => {
    await pharmacist.post('/api/v1/medicines').send(paracetamol);
    expect((await cashier.get('/api/v1/medicines?search=para')).body.data).toHaveLength(1);
    expect((await cashier.post('/api/v1/medicines').send(paracetamol)).status).toBe(403);
  });

  test('list supports filters, whitelisted sorting and pagination', async () => {
    for (const name of ['Alpha', 'Bravo', 'Charlie']) {
      await pharmacist.post('/api/v1/medicines').send({ ...paracetamol, name });
    }
    const res = await pharmacist.get('/api/v1/medicines?sortBy=name&sortOrder=desc&limit=2');
    expect(res.body.data.map((m) => m.name)).toEqual(['Charlie', 'Bravo']);
    expect(res.body.pagination).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });

    // An unknown sort field falls back to the default instead of reaching SQL.
    const injected = await pharmacist.get('/api/v1/medicines?sortBy=name;DROP TABLE medicines');
    expect(injected.status).toBe(200);
  });

  test('POS search requires branch access', async () => {
    const other = await createBranch();
    const res = await cashier.get(`/api/v1/medicines/search?q=para&branchId=${other.id}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('BRANCH_ACCESS_DENIED');
  });
});

describe('suppliers', () => {
  test('requires company name and phone; similar names warn', async () => {
    expect((await admin.post('/api/v1/suppliers').send({ companyName: 'Acme' })).status).toBe(422);
    const first = await admin.post('/api/v1/suppliers').send({ companyName: 'Acme  Pharma', phone: '0911000000' });
    expect(first.status).toBe(201);
    const second = await admin.post('/api/v1/suppliers').send({ companyName: ' acme pharma ', phone: '0911000001' });
    expect(second.status).toBe(201);
    expect(second.body.data.warnings.similarSuppliers).toHaveLength(1);
  });

  test('archive/restore and permission boundaries', async () => {
    const s = (await admin.post('/api/v1/suppliers').send({ companyName: 'Beta', phone: '1' })).body.data.supplier;
    expect((await pharmacist.get('/api/v1/suppliers')).status).toBe(200);
    expect((await pharmacist.post('/api/v1/suppliers').send({ companyName: 'X', phone: '1' })).status).toBe(403);
    expect((await cashier.get('/api/v1/suppliers')).status).toBe(403);
    expect((await admin.post(`/api/v1/suppliers/${s.id}/archive`)).body.data.status).toBe('ARCHIVED');
    expect((await admin.post(`/api/v1/suppliers/${s.id}/restore`)).body.data.status).toBe('ACTIVE');
  });
});
