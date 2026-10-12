const { resetDatabase, pool } = require('../helpers/db');
const { createBranch, createUser, createMedicine, createStock } = require('../helpers/factories');
const { loginAs } = require('../helpers/session');
const { daysFromToday } = require('../helpers/dates');

let branch;
let otherBranch;
let owner;
let cashierUser;
let cashier;

beforeEach(async () => {
  await resetDatabase();
  branch = await createBranch({ name: 'Bole', code: 'BOLE' });
  otherBranch = await createBranch({ name: 'Piassa', code: 'PIASSA' });
  owner = await createUser({ role: 'OWNER' });
  cashierUser = await createUser({ role: 'CASHIER', branches: [branch] });
  cashier = await loginAs(cashierUser);
});

afterAll(() => pool.end());

describe('operational alerts', () => {
  test('are derived from inventory with the documented severities', async () => {
    const expired = await createMedicine({ name: 'Expired' });
    await createStock({ branch, medicine: expired, user: owner, expiryDate: daysFromToday(-2), quantity: 3 });
    const soon = await createMedicine({ name: 'Soon' });
    await createStock({ branch, medicine: soon, user: owner, expiryDate: daysFromToday(5), quantity: 50, minimumStock: 1 });
    const low = await createMedicine({ name: 'Low' });
    await createStock({ branch, medicine: low, user: owner, quantity: 2, minimumStock: 5 });
    // Another branch's alerts are invisible to this cashier.
    const elsewhere = await createMedicine({ name: 'Elsewhere' });
    await createStock({ branch: otherBranch, medicine: elsewhere, user: owner, quantity: 0 });

    const res = await cashier.get('/api/v1/alerts');
    const summary = res.body.data.map((a) => [a.type, a.severity, a.medicineName]);
    expect(summary).toEqual([
      ['EXPIRED', 'CRITICAL', 'Expired'],
      ['OUT_OF_STOCK', 'HIGH', 'Expired'],
      ['EXPIRING_SOON', 'WARNING', 'Soon'],
      ['LOW_STOCK', 'WARNING', 'Low'],
    ]);

    const count = await cashier.get('/api/v1/alerts/count');
    expect(count.body.data).toMatchObject({ total: 4, bySeverity: { CRITICAL: 1, HIGH: 1, WARNING: 2 } });
  });

  test('disappear when the condition is resolved and cannot be dismissed', async () => {
    const med = await createMedicine({ name: 'Low' });
    const { inventory } = await createStock({ branch, medicine: med, user: owner, quantity: 2, minimumStock: 5 });
    const alerts = (await cashier.get('/api/v1/alerts')).body.data;
    expect(alerts).toHaveLength(1);
    expect((await cashier.get(`/api/v1/alerts/${encodeURIComponent(alerts[0].id)}`)).status).toBe(200);
    expect((await cashier.patch(`/api/v1/alerts/${encodeURIComponent(alerts[0].id)}`).send({})).status).toBe(404);

    await pool.query('UPDATE branch_inventory SET quantity = 50 WHERE id = $1', [inventory.id]);
    expect((await cashier.get('/api/v1/alerts')).body.data).toHaveLength(0);
    expect((await cashier.get(`/api/v1/alerts/${encodeURIComponent(alerts[0].id)}`)).status).toBe(404);
  });
});

describe('informational notifications', () => {
  async function seedNotification(userId, type = 'PASSWORD_CHANGED') {
    const { rows } = await pool.query(
      "INSERT INTO notifications (user_id, type, title, message) VALUES ($1, $2, 'T', 'M') RETURNING id",
      [userId, type],
    );
    return rows[0].id;
  }

  test('read, dismiss and read-all apply only to the owner', async () => {
    const mine = await seedNotification(cashierUser.id);
    await seedNotification(cashierUser.id, 'TRANSFER_SHIPPED');
    const theirs = await seedNotification(owner.id);

    expect((await cashier.get('/api/v1/notifications/unread-count')).body.data.unread).toBe(2);
    expect((await cashier.patch(`/api/v1/notifications/${mine}/read`)).status).toBe(200);
    expect((await cashier.get('/api/v1/notifications/unread-count')).body.data.unread).toBe(1);

    expect((await cashier.patch(`/api/v1/notifications/${theirs}/read`)).status).toBe(404);
    expect((await cashier.patch(`/api/v1/notifications/${mine}/dismiss`)).status).toBe(200);
    expect((await cashier.get('/api/v1/notifications')).body.data).toHaveLength(1);

    expect((await cashier.patch('/api/v1/notifications/read-all')).body.data.updated).toBe(1);
    expect((await cashier.get('/api/v1/notifications/unread-count')).body.data.unread).toBe(0);
    const other = await pool.query('SELECT read_at FROM notifications WHERE id = $1', [theirs]);
    expect(other.rows[0].read_at).toBeNull();
  });
});
