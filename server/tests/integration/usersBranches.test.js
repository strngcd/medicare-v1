const { resetDatabase, pool } = require('../helpers/db');
const { createBranch, createUser, setOverride } = require('../helpers/factories');
const { loginAs, request, app } = require('../helpers/session');
const { testOutbox } = require('../../src/utils/mailer');

let branchA;
let branchB;
let owner;
let admin;

beforeEach(async () => {
  await resetDatabase();
  testOutbox.length = 0;
  branchA = await createBranch({ name: 'Bole', code: 'BOLE' });
  branchB = await createBranch({ name: 'Piassa', code: 'PIASSA' });
  owner = await createUser({ role: 'OWNER' });
  admin = await createUser({ role: 'ADMIN', branches: [branchA] });
});

afterAll(() => pool.end());

describe('staff creation', () => {
  test('creates a user with a single-use setup link instead of a password', async () => {
    const session = await loginAs(admin);
    const res = await session.post('/api/v1/users').send({
      fullName: 'Hana Tesfaye',
      email: 'Hana@Example.com',
      roleCode: 'CASHIER',
      employeeId: 'EMP-100',
      branchIds: [branchA.id],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe('hana@example.com');
    expect(res.body.data.user.hasPassword).toBe(false);
    expect(res.body.data.setupLink.url).toMatch(/setup-password\?token=/);
    expect(testOutbox).toHaveLength(1);

    // Complete setup with the link, then sign in.
    const token = decodeURIComponent(res.body.data.setupLink.url.split('token=')[1]);
    const setup = await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'Welcome123' });
    expect(setup.status).toBe(200);
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'hana@example.com', password: 'Welcome123' });
    expect(login.status).toBe(200);

    const audit = await pool.query("SELECT user_id, role_at_time, new_values FROM audit_logs WHERE action = 'USER_CREATED'");
    expect(audit.rows[0].user_id).toBe(admin.id);
    expect(audit.rows[0].role_at_time).toBe('ADMIN');
    expect(JSON.stringify(audit.rows[0].new_values)).not.toMatch(/token|password/i);
  });

  test('rejects duplicate email and employee ID with stable codes', async () => {
    const session = await loginAs(owner);
    const base = { fullName: 'X', roleCode: 'CASHIER', branchIds: [branchA.id] };
    const dupEmail = await session.post('/api/v1/users').send({ ...base, email: admin.email.toUpperCase() });
    expect(dupEmail.status).toBe(409);
    expect(dupEmail.body.error.code).toBe('DUPLICATE_EMAIL');

    await session.post('/api/v1/users').send({ ...base, email: 'a1@example.com', employeeId: 'E-1' });
    const dupEmp = await session.post('/api/v1/users').send({ ...base, email: 'a2@example.com', employeeId: 'e-1' });
    expect(dupEmp.body.error.code).toBe('DUPLICATE_EMPLOYEE_ID');
  });

  test('non-owner staff require at least one branch', async () => {
    const session = await loginAs(owner);
    const res = await session.post('/api/v1/users').send({ fullName: 'X', email: 'x@example.com', roleCode: 'CASHIER' });
    expect(res.status).toBe(422);
  });

  test('admin cannot create an Owner or an Admin', async () => {
    const session = await loginAs(admin);
    for (const roleCode of ['OWNER', 'ADMIN']) {
      const res = await session.post('/api/v1/users').send({
        fullName: 'X', email: `${roleCode}@example.com`, roleCode, branchIds: [branchA.id],
      });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('INSUFFICIENT_AUTHORITY');
    }
  });

  test('admin cannot assign staff to a branch outside their access', async () => {
    const session = await loginAs(admin);
    const res = await session.post('/api/v1/users').send({
      fullName: 'X', email: 'x@example.com', roleCode: 'CASHIER', branchIds: [branchB.id],
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('BRANCH_ACCESS_DENIED');
  });

  test('cannot assign staff to an inactive branch', async () => {
    const inactive = await createBranch({ status: 'INACTIVE' });
    const session = await loginAs(owner);
    const res = await session.post('/api/v1/users').send({
      fullName: 'X', email: 'x@example.com', roleCode: 'CASHIER', branchIds: [inactive.id],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BRANCH_INACTIVE');
  });

  test('cashier cannot create staff', async () => {
    const cashier = await createUser({ role: 'CASHIER', branches: [branchA] });
    const session = await loginAs(cashier);
    const res = await session.post('/api/v1/users').send({
      fullName: 'X', email: 'x@example.com', roleCode: 'CASHIER', branchIds: [branchA.id],
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_DENIED');
  });
});

describe('staff visibility and modification', () => {
  test('admin only sees staff sharing a branch (plus owners)', async () => {
    const inA = await createUser({ role: 'CASHIER', branches: [branchA] });
    const inB = await createUser({ role: 'CASHIER', branches: [branchB] });
    const session = await loginAs(admin);

    const list = await session.get('/api/v1/users');
    const ids = list.body.data.map((u) => u.id);
    expect(ids).toEqual(expect.arrayContaining([owner.id, admin.id, inA.id]));
    expect(ids).not.toContain(inB.id);

    expect((await session.get(`/api/v1/users/${inB.id}`)).status).toBe(404);
    expect((await session.patch(`/api/v1/users/${inB.id}`).send({ fullName: 'Hack' })).status).toBe(404);
  });

  test('admin cannot modify an Owner', async () => {
    const session = await loginAs(admin);
    const res = await session.patch(`/api/v1/users/${owner.id}`).send({ fullName: 'Changed' });
    expect(res.status).toBe(403);
    expect((await session.post(`/api/v1/users/${owner.id}/deactivate`)).status).toBe(403);
  });

  test('users cannot change their own role, permissions, branches or status', async () => {
    const session = await loginAs(admin);
    const checks = [
      session.patch(`/api/v1/users/${admin.id}/role`).send({ roleCode: 'OWNER' }),
      session.put(`/api/v1/users/${admin.id}/permissions/BRANCH_CREATE`).send({ granted: true }),
      session.patch(`/api/v1/users/${admin.id}/branches`).send({ branchIds: [branchA.id, branchB.id] }),
      session.post(`/api/v1/users/${admin.id}/deactivate`),
      session.patch(`/api/v1/users/${admin.id}`).send({ employeeId: 'NEW-ID' }),
    ];
    for (const res of await Promise.all(checks)) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('SELF_MODIFICATION_NOT_ALLOWED');
    }
  });

  test('self-service profile only accepts permitted fields', async () => {
    const session = await loginAs(admin);
    expect((await session.patch('/api/v1/users/me').send({ fullName: 'New Name', phone: '0911' })).status).toBe(200);
    const forbidden = await session.patch('/api/v1/users/me').send({ roleCode: 'OWNER' });
    expect(forbidden.status).toBe(422);
    const status = await session.patch('/api/v1/users/me').send({ status: 'ACTIVE' });
    expect(status.status).toBe(422);
  });

  test('an Owner can deactivate another Owner, but nobody can deactivate themselves', async () => {
    const secondOwner = await createUser({ role: 'OWNER' });
    const session = await loginAs(secondOwner);
    expect((await session.post(`/api/v1/users/${secondOwner.id}/deactivate`)).status).toBe(403);
    expect((await session.post(`/api/v1/users/${owner.id}/deactivate`)).status).toBe(200);
  });

  test('deactivation revokes sessions and blocks login; reactivation restores', async () => {
    const cashier = await createUser({ role: 'CASHIER', branches: [branchA] });
    const cashierSession = await loginAs(cashier);
    const adminSession = await loginAs(admin);

    const res = await adminSession.post(`/api/v1/users/${cashier.id}/deactivate`);
    expect(res.status).toBe(200);
    expect((await cashierSession.get('/api/v1/auth/me')).status).toBe(401);
    const login = await request(app).post('/api/v1/auth/login').send({ email: cashier.email, password: cashier.password });
    expect(login.body.error.code).toBe('ACCOUNT_INACTIVE');

    expect((await adminSession.post(`/api/v1/users/${cashier.id}/reactivate`)).status).toBe(200);
    expect((await loginAs(cashier)).session.user.id).toBe(cashier.id);

    const actions = await pool.query("SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY created_at", [cashier.id]);
    expect(actions.rows.map((r) => r.action)).toEqual(['DEACTIVATED', 'REACTIVATED']);
  });
});

describe('roles and branches', () => {
  test('owner can promote to Admin; admin cannot', async () => {
    const pharmacist = await createUser({ role: 'PHARMACIST', branches: [branchA] });
    const adminSession = await loginAs(admin);
    expect((await adminSession.patch(`/api/v1/users/${pharmacist.id}/role`).send({ roleCode: 'ADMIN' })).status).toBe(403);
    expect((await adminSession.patch(`/api/v1/users/${pharmacist.id}/role`).send({ roleCode: 'CASHIER' })).status).toBe(200);

    const ownerSession = await loginAs(owner);
    const res = await ownerSession.patch(`/api/v1/users/${pharmacist.id}/role`).send({ roleCode: 'ADMIN' });
    expect(res.status).toBe(200);
    expect(res.body.data.role.code).toBe('ADMIN');
  });

  test('admin can only change branch assignments within their own branches', async () => {
    const cashier = await createUser({ role: 'CASHIER', branches: [branchA, branchB] });
    const session = await loginAs(admin);

    // Removing A keeps B (outside the admin's reach) intact.
    const res = await session.patch(`/api/v1/users/${cashier.id}/branches`).send({ branchIds: [] });
    expect(res.status).toBe(200);
    expect(res.body.data.branches.map((b) => b.code)).toEqual(['PIASSA']);

    const onlyA = await createUser({ role: 'CASHIER', branches: [branchA] });
    const empty = await session.patch(`/api/v1/users/${onlyA.id}/branches`).send({ branchIds: [] });
    expect(empty.status).toBe(409);
    expect(empty.body.error.code).toBe('BRANCH_REQUIRED');
  });
});

describe('permission overrides', () => {
  test('grant, deny and reset are reflected as explicit/inherited', async () => {
    const cashier = await createUser({ role: 'CASHIER', branches: [branchA] });
    const session = await loginAs(admin);

    await session.put(`/api/v1/users/${cashier.id}/permissions/SALES_APPLY_DISCOUNT`).send({ granted: true });
    await session.put(`/api/v1/users/${cashier.id}/permissions/SALES_PROCESS_REFUND`).send({ granted: false });
    const res = await session.get(`/api/v1/users/${cashier.id}/permissions`);
    const byCode = Object.fromEntries(res.body.data.permissions.map((p) => [p.code, p]));
    expect(byCode.SALES_APPLY_DISCOUNT).toMatchObject({ override: 'GRANT', effective: true, inherited: false });
    expect(byCode.SALES_PROCESS_REFUND).toMatchObject({ override: 'DENY', effective: false, inherited: true });
    expect(byCode.SALES_CREATE).toMatchObject({ override: null, effective: true });

    const cleared = await session.delete(`/api/v1/users/${cashier.id}/permissions/SALES_PROCESS_REFUND`);
    const after = Object.fromEntries(cleared.body.data.permissions.map((p) => [p.code, p]));
    expect(after.SALES_PROCESS_REFUND).toMatchObject({ override: null, effective: true });

    // The effective permission set changes immediately for the target user.
    const cashierSession = await loginAs(cashier);
    expect(cashierSession.session.permissions).toContain('SALES_APPLY_DISCOUNT');
  });

  test('admin cannot grant a permission they do not hold', async () => {
    const cashier = await createUser({ role: 'CASHIER', branches: [branchA] });
    const session = await loginAs(admin);
    const res = await session.put(`/api/v1/users/${cashier.id}/permissions/BRANCH_CREATE`).send({ granted: true });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_AUTHORITY');
  });

  test('a denied permission blocks the endpoint', async () => {
    await setOverride(admin.id, 'STAFF_VIEW', false);
    const session = await loginAs(admin);
    expect((await session.get('/api/v1/users')).status).toBe(403);
  });

  test('owner permissions cannot be changed', async () => {
    const other = await createUser({ role: 'OWNER' });
    const session = await loginAs(owner);
    const res = await session.put(`/api/v1/users/${other.id}/permissions/SALES_CREATE`).send({ granted: false });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('OWNER_PERMISSIONS_FIXED');
  });

  test('unknown permission codes are rejected', async () => {
    const cashier = await createUser({ role: 'CASHIER', branches: [branchA] });
    const session = await loginAs(owner);
    const res = await session.put(`/api/v1/users/${cashier.id}/permissions/INVENTORY_OVERRIDE_FEFO`).send({ granted: true });
    expect(res.status).toBe(422);
  });
});

describe('branches', () => {
  test('owner creates a branch with default settings; code is normalized and immutable', async () => {
    const session = await loginAs(owner);
    const res = await session.post('/api/v1/branches').send({ name: 'Merkato', code: 'merk-1' });
    expect(res.status).toBe(201);
    expect(res.body.data.code).toBe('MERK-1');
    expect(res.body.data.country).toBe('Ethiopia');

    const settings = await session.get(`/api/v1/branches/${res.body.data.id}/settings`);
    expect(settings.body.data.defaultMinimumStock).toBe(10);

    const patch = await session.patch(`/api/v1/branches/${res.body.data.id}`).send({ code: 'OTHER' });
    expect(patch.status).toBe(422);
    const dup = await session.post('/api/v1/branches').send({ name: 'Again', code: 'MERK-1' });
    expect(dup.body.error.code).toBe('DUPLICATE_BRANCH_CODE');
  });

  test('admin cannot create branches by default and cannot see other branches', async () => {
    const session = await loginAs(admin);
    expect((await session.post('/api/v1/branches').send({ name: 'X', code: 'X' })).status).toBe(403);
    const list = await session.get('/api/v1/branches');
    expect(list.body.data.map((b) => b.code)).toEqual(['BOLE']);
    expect((await session.get(`/api/v1/branches/${branchB.id}`)).status).toBe(403);
  });

  test('branch context lists accessible branches for any signed-in user', async () => {
    const cashier = await createUser({ role: 'CASHIER', branches: [branchB] });
    const session = await loginAs(cashier);
    const res = await session.get('/api/v1/branches/context');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      canAccessAllBranches: false,
      branches: [{ id: branchB.id, name: 'Piassa', code: 'PIASSA', status: 'ACTIVE' }],
    });
    expect((await session.get('/api/v1/branches')).status).toBe(403); // no BRANCH_VIEW
  });

  test('cannot deactivate a branch that is the only active branch of active staff', async () => {
    const session = await loginAs(owner);
    const res = await session.post(`/api/v1/branches/${branchA.id}/deactivate`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BRANCH_HAS_DEPENDENT_STAFF');

    await pool.query('INSERT INTO user_branches (user_id, branch_id) VALUES ($1, $2)', [admin.id, branchB.id]);
    const ok = await session.post(`/api/v1/branches/${branchA.id}/deactivate`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('INACTIVE');
    expect((await session.post(`/api/v1/branches/${branchA.id}/reactivate`)).body.data.status).toBe('ACTIVE');
  });

  test('changing the default minimum stock is audited as a settings update', async () => {
    const session = await loginAs(admin);
    const res = await session.patch(`/api/v1/branches/${branchA.id}/settings`).send({ defaultMinimumStock: 25 });
    expect(res.status).toBe(200);
    expect(res.body.data.defaultMinimumStock).toBe(25);
    const audit = await pool.query("SELECT previous_values, new_values FROM audit_logs WHERE action = 'SETTINGS_UPDATED'");
    expect(audit.rows[0]).toEqual({ previous_values: { defaultMinimumStock: 10 }, new_values: { defaultMinimumStock: 25 } });
  });
});

describe('preferences', () => {
  test('saves theme/page size and validates the selected branch', async () => {
    const cashier = await createUser({ role: 'CASHIER', branches: [branchA] });
    const session = await loginAs(cashier);
    const ok = await session.patch('/api/v1/users/me/preferences').send({ theme: 'DARK', pageSize: 50 });
    expect(ok.body.data).toMatchObject({ theme: 'DARK', pageSize: 50, uiDensity: 'COMFORTABLE' });

    const denied = await session.patch('/api/v1/users/me/preferences').send({ lastSelectedBranchId: branchB.id });
    expect(denied.status).toBe(403);
    const allBranches = await session.patch('/api/v1/users/me/preferences').send({ lastSelectedBranchId: null });
    expect(allBranches.status).toBe(403);
  });
});
