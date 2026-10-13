const { resetDatabase, pool } = require('../helpers/db');
const { createUser } = require('../helpers/factories');
const { withTransaction, query } = require('../../src/database/db');
const { nextDocumentNumber, DOCUMENT_NUMBER_PATTERN } = require('../../src/modules/documents/documentNumbers');
const { runIdempotent } = require('../../src/modules/idempotency/idempotency');
const { recordAudit } = require('../../src/modules/audit/audit.recorder');

let user;

beforeEach(async () => {
  await resetDatabase();
  user = await createUser({ role: 'OWNER' });
});

afterAll(() => pool.end());

describe('document numbers', () => {
  test('are a prefix plus a random 6-character code', async () => {
    const sale = await withTransaction((c) => nextDocumentNumber(c, 'SALE'));
    const purchase = await withTransaction((c) => nextDocumentNumber(c, 'PURCHASE'));
    expect(sale).toMatch(/^SAL-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
    expect(purchase).toMatch(DOCUMENT_NUMBER_PATTERN);
    expect(purchase.startsWith('PUR-')).toBe(true);
  });

  test('are not sequential', async () => {
    const numbers = await Promise.all(
      Array.from({ length: 20 }, () => withTransaction((c) => nextDocumentNumber(c, 'REFUND'))),
    );
    expect(new Set(numbers).size).toBe(20);
    expect([...numbers].sort()).not.toEqual(numbers);
  });

  test('rejects unknown document types', async () => {
    await expect(withTransaction((c) => nextDocumentNumber(c, 'RECEIVING'))).rejects.toThrow(/Unknown/);
  });
});

describe('idempotency', () => {
  const work = async (client) => {
    const { rows } = await query(
      "INSERT INTO audit_logs (action, entity_type, description) VALUES ('TEST', 'TEST', 'x') RETURNING id",
      [],
      client,
    );
    return { id: rows[0].id };
  };

  test('replays the stored result for a repeated key', async () => {
    const opts = { userId: user.id, scope: 'test', key: 'key-12345678', payload: { a: 1 } };
    const first = await runIdempotent(opts, work);
    const second = await runIdempotent(opts, work);
    expect(second.replayed).toBe(true);
    expect(second.body).toEqual(first.body);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'TEST'");
    expect(rows[0].n).toBe(1);
  });

  test('concurrent retries with the same key create one record', async () => {
    const opts = { userId: user.id, scope: 'test', key: 'key-concurrent', payload: { a: 1 } };
    const results = await Promise.all([runIdempotent(opts, work), runIdempotent(opts, work), runIdempotent(opts, work)]);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'TEST'");
    expect(rows[0].n).toBe(1);
  });

  test('rejects reuse of a key with a different payload', async () => {
    await runIdempotent({ userId: user.id, scope: 'test', key: 'key-12345678', payload: { a: 1 } }, work);
    await expect(
      runIdempotent({ userId: user.id, scope: 'test', key: 'key-12345678', payload: { a: 2 } }, work),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  test('a failed operation does not consume the key', async () => {
    const opts = { userId: user.id, scope: 'test', key: 'key-fails-first', payload: {} };
    await expect(runIdempotent(opts, async () => { throw new Error('fail'); })).rejects.toThrow('fail');
    const retry = await runIdempotent(opts, work);
    expect(retry.replayed).toBe(false);
  });
});

describe('audit recorder', () => {
  test('strips secret-looking fields from before/after values', async () => {
    await withTransaction((client) =>
      recordAudit(client, { userId: user.id, roleCode: 'OWNER' }, {
        action: 'USER_UPDATED',
        entityType: 'USER',
        entityId: user.id,
        description: 'test',
        previousValues: { email: 'a@b.c', passwordHash: 'x', nested: { resetToken: 'y', ok: 1 } },
        newValues: { password: 'secret', sessionToken: 'z', fullName: 'New' },
      }),
    );
    const { rows } = await pool.query("SELECT previous_values, new_values FROM audit_logs WHERE action = 'USER_UPDATED'");
    expect(rows[0].previous_values).toEqual({ email: 'a@b.c', nested: { ok: 1 } });
    expect(rows[0].new_values).toEqual({ fullName: 'New' });
  });

  test('audit entries roll back with the business transaction', async () => {
    await expect(
      withTransaction(async (client) => {
        await recordAudit(client, { userId: user.id, roleCode: 'OWNER' }, {
          action: 'ROLLBACK_TEST', entityType: 'TEST', description: 'x',
        });
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'ROLLBACK_TEST'");
    expect(rows[0].n).toBe(0);
  });
});
