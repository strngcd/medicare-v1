const { resetDatabase, pool } = require('../helpers/db');
const { createBranch, createUser, createMedicine, createStock } = require('../helpers/factories');
const { loginAs, request, app } = require('../helpers/session');

let branch;
let owner;

beforeEach(async () => {
  await resetDatabase();
  branch = await createBranch({ name: 'Bole', code: 'BOLE' });
  owner = await createUser({ role: 'OWNER' });
});

afterAll(() => pool.end());

async function createSupplier(session, companyName = 'Acme Pharma') {
  const res = await session.post('/api/v1/suppliers').send({ companyName, phone: '0911000000' });
  expect(res.status).toBe(201);
  return res.body.data.supplier;
}

describe('deleting unused branches', () => {
  test('an unused branch can be deleted, disappears and frees its code', async () => {
    const session = await loginAs(owner);
    const spare = await createBranch({ name: 'Typo branch', code: 'TYPO' });

    const detail = await session.get(`/api/v1/branches/${spare.id}`);
    expect(detail.body.data.canDelete).toBe(true);

    const res = await session.delete(`/api/v1/branches/${spare.id}`);
    expect(res.status).toBe(200);

    expect((await session.get(`/api/v1/branches/${spare.id}`)).status).toBe(404);
    const list = await session.get('/api/v1/branches');
    expect(list.body.data.map((b) => b.id)).not.toContain(spare.id);
    const context = await session.get('/api/v1/branches/context');
    expect(context.body.data.branches.map((b) => b.id)).not.toContain(spare.id);

    const again = await session.post('/api/v1/branches').send({ name: 'Real branch', code: 'TYPO' });
    expect(again.status).toBe(201);

    const audit = await pool.query("SELECT 1 FROM audit_logs WHERE action = 'BRANCH_DELETED' AND entity_id = $1", [spare.id]);
    expect(audit.rowCount).toBe(1);
  });

  test('a branch with stock cannot be deleted', async () => {
    const session = await loginAs(owner);
    const medicine = await createMedicine();
    await createStock({ branch, medicine, user: owner, quantity: 5 });

    expect((await session.get(`/api/v1/branches/${branch.id}`)).body.data.canDelete).toBe(false);
    const res = await session.delete(`/api/v1/branches/${branch.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RECORD_IN_USE');
  });

  test('a branch that is some staff member\'s only branch cannot be deleted', async () => {
    const session = await loginAs(owner);
    await createUser({ role: 'CASHIER', branches: [branch] });
    const res = await session.delete(`/api/v1/branches/${branch.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BRANCH_HAS_DEPENDENT_STAFF');
  });

  test('a deleted branch row is frozen in the database', async () => {
    const session = await loginAs(owner);
    const spare = await createBranch({ code: 'SPARE' });
    await session.delete(`/api/v1/branches/${spare.id}`);
    await expect(pool.query("UPDATE branches SET status = 'ACTIVE' WHERE id = $1", [spare.id])).rejects.toThrow(/deleted/);
  });
});

describe('deleting unused staff', () => {
  test('an account without transactions can be deleted; it cannot sign in and its email is free again', async () => {
    const session = await loginAs(owner);
    const cashier = await createUser({ role: 'CASHIER', branches: [branch], email: 'typo@example.com' });
    await loginAs(cashier); // signing in is not activity

    expect((await session.get(`/api/v1/users/${cashier.id}`)).body.data.canDelete).toBe(true);
    const res = await session.delete(`/api/v1/users/${cashier.id}`);
    expect(res.status).toBe(200);

    expect((await session.get(`/api/v1/users/${cashier.id}`)).status).toBe(404);
    const login = await request(app).post('/api/v1/auth/login').send({ email: cashier.email, password: cashier.password });
    expect(login.status).toBe(401);

    const recreated = await session.post('/api/v1/users').send({
      fullName: 'Right Person', email: 'typo@example.com', roleCode: 'CASHIER', branchIds: [branch.id],
    });
    expect(recreated.status).toBe(201);
  });

  test('an account that has recorded stock changes cannot be deleted', async () => {
    const session = await loginAs(owner);
    const pharmacist = await createUser({ role: 'PHARMACIST', branches: [branch] });
    await createStock({ branch, medicine: await createMedicine(), user: pharmacist, quantity: 3 });

    expect((await session.get(`/api/v1/users/${pharmacist.id}`)).body.data.canDelete).toBe(false);
    const res = await session.delete(`/api/v1/users/${pharmacist.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RECORD_IN_USE');
  });

  test('nobody can delete their own account or a higher role', async () => {
    const admin = await createUser({ role: 'ADMIN', branches: [branch] });
    const session = await loginAs(admin);
    expect((await session.delete(`/api/v1/users/${admin.id}`)).status).toBe(403);
    expect((await session.delete(`/api/v1/users/${owner.id}`)).status).toBe(403);
  });
});

describe('deleting unused suppliers', () => {
  test('an unused supplier can be deleted and leaves every list', async () => {
    const session = await loginAs(owner);
    const supplier = await createSupplier(session);
    expect((await session.get(`/api/v1/suppliers/${supplier.id}`)).body.data.canDelete).toBe(true);

    expect((await session.delete(`/api/v1/suppliers/${supplier.id}`)).status).toBe(200);
    expect((await session.get(`/api/v1/suppliers/${supplier.id}`)).status).toBe(404);
    const list = await session.get('/api/v1/suppliers');
    expect(list.body.data.map((s) => s.id)).not.toContain(supplier.id);
  });

  test('a supplier with a purchase cannot be deleted', async () => {
    const session = await loginAs(owner);
    const supplier = await createSupplier(session);
    const medicine = await createMedicine();
    const purchase = await session.post('/api/v1/purchases').send({
      supplierId: supplier.id, branchId: branch.id, status: 'DRAFT',
      items: [{ medicineId: medicine.id, orderedQuantity: 1, unitPurchasePrice: '1.00' }],
    });
    expect(purchase.status).toBe(201);

    expect((await session.get(`/api/v1/suppliers/${supplier.id}`)).body.data.canDelete).toBe(false);
    const res = await session.delete(`/api/v1/suppliers/${supplier.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RECORD_IN_USE');
  });
});

describe('deleting while the record is being used', () => {
  test('a purchase racing a supplier delete does not land on the deleted supplier', async () => {
    const session = await loginAs(owner);
    const supplier = await createSupplier(session);
    const medicine = await createMedicine();

    // Hold the delete open (row locked and marked deleted, not yet committed).
    const deleter = await pool.connect();
    try {
      await deleter.query('BEGIN');
      await deleter.query('SELECT id FROM suppliers WHERE id = $1 FOR UPDATE', [supplier.id]);
      await deleter.query(
        "UPDATE suppliers SET status = 'ARCHIVED', archived_at = now(), deleted_at = now() WHERE id = $1",
        [supplier.id],
      );

      const purchase = session.post('/api/v1/purchases').send({
        supplierId: supplier.id, branchId: branch.id, status: 'DRAFT',
        items: [{ medicineId: medicine.id, orderedQuantity: 1, unitPurchasePrice: '1.00' }],
      }).then((res) => res);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await deleter.query('COMMIT');

      const res = await purchase;
      expect(res.status).toBe(422);
    } finally {
      deleter.release();
    }
    const { rowCount } = await pool.query('SELECT 1 FROM purchases WHERE supplier_id = $1', [supplier.id]);
    expect(rowCount).toBe(0);
  });

  test('a purchase racing a branch delete does not land on the deleted branch', async () => {
    const session = await loginAs(owner);
    const supplier = await createSupplier(session);
    const medicine = await createMedicine();
    const spare = await createBranch({ name: 'Typo branch', code: 'TYPO' });

    const deleter = await pool.connect();
    try {
      await deleter.query('BEGIN');
      await deleter.query('SELECT id FROM branches WHERE id = $1 FOR UPDATE', [spare.id]);
      await deleter.query(
        "UPDATE branches SET status = 'INACTIVE', deleted_at = now() WHERE id = $1",
        [spare.id],
      );

      const purchase = session.post('/api/v1/purchases').send({
        supplierId: supplier.id, branchId: spare.id, status: 'DRAFT',
        items: [{ medicineId: medicine.id, orderedQuantity: 1, unitPurchasePrice: '1.00' }],
      }).then((res) => res);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await deleter.query('COMMIT');

      const res = await purchase;
      expect(res.status).toBe(404);
    } finally {
      deleter.release();
    }
    const { rowCount } = await pool.query('SELECT 1 FROM purchases WHERE branch_id = $1', [spare.id]);
    expect(rowCount).toBe(0);
  });
});
