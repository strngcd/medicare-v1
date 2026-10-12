const { resetDatabase, pool } = require('../helpers/db');
const { createBranch, createUser } = require('../helpers/factories');
const { app, loginAs, request } = require('../helpers/session');
const { testOutbox } = require('../../src/utils/mailer');

let branch;

beforeEach(async () => {
  await resetDatabase();
  testOutbox.length = 0;
  branch = await createBranch();
});

afterAll(() => pool.end());

function extractToken(mail) {
  return decodeURIComponent(mail.text.match(/token=([^\s]+)/)[1]);
}

describe('POST /auth/login', () => {
  test('signs in and sets HttpOnly session and CSRF cookies', async () => {
    const user = await createUser({ role: 'CASHIER', branches: [branch] });
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: user.password });

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(user.email);
    expect(res.body.data.user.role.code).toBe('CASHIER');
    expect(res.body.data.selectedBranchId).toBe(branch.id);
    expect(res.body.data.permissions).toContain('SALES_CREATE');

    const cookies = res.headers['set-cookie'];
    const sessionCookie = cookies.find((c) => c.startsWith('medicar_sid='));
    expect(sessionCookie).toMatch(/HttpOnly/);
    expect(sessionCookie).toMatch(/SameSite=Strict/);
    expect(sessionCookie).not.toMatch(/Expires|Max-Age/); // no "remember me"
    expect(cookies.find((c) => c.startsWith('medicar_csrf='))).not.toMatch(/HttpOnly/);

    // Only the hash of the session token is stored.
    const rawToken = sessionCookie.split(';')[0].split('=')[1];
    const { rows } = await pool.query('SELECT token_hash FROM user_sessions');
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(rawToken);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);

    const history = await pool.query("SELECT * FROM login_history WHERE event_type = 'LOGIN' AND success");
    expect(history.rows[0].user_id).toBe(user.id);
  });

  test('never returns secrets in the session payload', async () => {
    const user = await createUser({ branches: [branch] });
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: user.password });
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/password|hash|token/i);
  });

  test('email matching is case-insensitive', async () => {
    const user = await createUser({ branches: [branch], email: 'mixed@example.com' });
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'MIXED@Example.com', password: user.password });
    expect(res.status).toBe(200);
  });

  test('wrong password and unknown email return the same generic error', async () => {
    const user = await createUser({ branches: [branch] });
    const wrong = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Wrong12345' });
    const unknown = await request(app).post('/api/v1/auth/login').send({ email: 'nobody@example.com', password: 'Wrong12345' });

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toEqual(unknown.body.error);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');

    const failures = await pool.query(
      "SELECT user_id, failure_category FROM login_history WHERE success = false ORDER BY created_at",
    );
    expect(failures.rows).toEqual([
      { user_id: user.id, failure_category: 'INVALID_CREDENTIALS' },
      { user_id: null, failure_category: 'INVALID_CREDENTIALS' },
    ]);
  });

  test('inactive accounts cannot sign in', async () => {
    const user = await createUser({ branches: [branch], status: 'INACTIVE' });
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: user.password });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_INACTIVE');
  });

  test('inactive account status is not revealed to a wrong password', async () => {
    const user = await createUser({ branches: [branch], status: 'INACTIVE' });
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Wrong12345' });
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  test('rate limits repeated failures for the same email', async () => {
    const user = await createUser({ branches: [branch] });
    for (let i = 0; i < 5; i += 1) {
      await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Wrong12345' });
    }
    const blocked = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: user.password });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');

    const { rows } = await pool.query("SELECT count(*)::int AS n FROM login_history WHERE failure_category = 'RATE_LIMITED'");
    expect(rows[0].n).toBe(1);
  });

  test('restores the last selected branch when still authorized', async () => {
    const second = await createBranch();
    const user = await createUser({ branches: [branch, second] });
    await pool.query('UPDATE users SET last_selected_branch_id = $1 WHERE id = $2', [second.id, user.id]);
    const session = await loginAs(user);
    expect(session.session.selectedBranchId).toBe(second.id);
  });

  test('falls back to an assigned branch when the last one is no longer authorized', async () => {
    const other = await createBranch();
    const user = await createUser({ branches: [branch] });
    await pool.query('UPDATE users SET last_selected_branch_id = $1 WHERE id = $2', [other.id, user.id]);
    const session = await loginAs(user);
    expect(session.session.selectedBranchId).toBe(branch.id);
  });

  test('rejects users without a password set (pending account setup)', async () => {
    const user = await createUser({ branches: [branch], password: null });
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Password123' });
    expect(res.status).toBe(401);
  });
});

describe('session handling', () => {
  test('GET /auth/me requires a session', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  test('state-changing requests require the CSRF token', async () => {
    const user = await createUser({ branches: [branch] });
    const session = await loginAs(user);
    const res = await session.agent.post('/api/v1/auth/logout');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_TOKEN_INVALID');
  });

  test('logout revokes the session and records history', async () => {
    const user = await createUser({ branches: [branch] });
    const session = await loginAs(user);
    expect((await session.post('/api/v1/auth/logout')).status).toBe(200);
    expect((await session.get('/api/v1/auth/me')).status).toBe(401);

    const { rows } = await pool.query("SELECT revoked_reason FROM user_sessions");
    expect(rows[0].revoked_reason).toBe('LOGOUT');
    const history = await pool.query("SELECT count(*)::int AS n FROM login_history WHERE event_type = 'LOGOUT'");
    expect(history.rows[0].n).toBe(1);
  });

  test('a deactivated user loses access immediately', async () => {
    const user = await createUser({ branches: [branch] });
    const session = await loginAs(user);
    await pool.query("UPDATE users SET status = 'INACTIVE' WHERE id = $1", [user.id]);
    expect((await session.get('/api/v1/auth/me')).status).toBe(401);
  });
});

describe('password reset', () => {
  test('full reset flow: single-use token, sessions invalidated, notification', async () => {
    const user = await createUser({ branches: [branch] });
    const existingSession = await loginAs(user);

    const forgot = await request(app).post('/api/v1/auth/forgot-password').send({ email: user.email });
    expect(forgot.status).toBe(200);
    expect(testOutbox).toHaveLength(1);
    const token = extractToken(testOutbox[0]);

    const stored = await pool.query('SELECT token_hash FROM password_tokens');
    expect(stored.rows[0].token_hash).not.toBe(token);

    const reset = await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'NewPassword9' });
    expect(reset.status).toBe(200);

    expect((await existingSession.get('/api/v1/auth/me')).status).toBe(401);
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'NewPassword9' });
    expect(login.status).toBe(200);

    const reuse = await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'Another123' });
    expect(reuse.status).toBe(400);
    expect(reuse.body.error.code).toBe('INVALID_RESET_TOKEN');

    const notes = await pool.query("SELECT type FROM notifications WHERE user_id = $1", [user.id]);
    expect(notes.rows.map((r) => r.type)).toContain('PASSWORD_RESET');
  });

  test('forgot-password responds identically for unknown emails', async () => {
    const res = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'ghost@example.com' });
    expect(res.status).toBe(200);
    expect(testOutbox).toHaveLength(0);
  });

  test('expired tokens are rejected and logged', async () => {
    const user = await createUser({ branches: [branch] });
    await request(app).post('/api/v1/auth/forgot-password').send({ email: user.email });
    const token = extractToken(testOutbox[0]);
    await pool.query("UPDATE password_tokens SET expires_at = now() - interval '1 minute'");

    const res = await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'NewPassword9' });
    expect(res.status).toBe(400);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM login_history WHERE failure_category = 'INVALID_RESET_FLOW'");
    expect(rows[0].n).toBe(1);
  });

  test('weak passwords are rejected', async () => {
    const user = await createUser({ branches: [branch] });
    await request(app).post('/api/v1/auth/forgot-password').send({ email: user.email });
    const token = extractToken(testOutbox[0]);
    const res = await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'short' });
    expect(res.status).toBe(422);
  });
});

describe('POST /auth/change-password', () => {
  test('verifies the current password', async () => {
    const user = await createUser({ branches: [branch] });
    const session = await loginAs(user);
    const res = await session.post('/api/v1/auth/change-password').send({
      currentPassword: 'WrongPass1',
      newPassword: 'BrandNew123',
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_CURRENT_PASSWORD');
  });

  test('changes the password and signs out other sessions only', async () => {
    const user = await createUser({ branches: [branch] });
    const current = await loginAs(user);
    const other = await loginAs(user);

    const res = await current.post('/api/v1/auth/change-password').send({
      currentPassword: user.password,
      newPassword: 'BrandNew123',
    });
    expect(res.status).toBe(200);
    expect((await current.get('/api/v1/auth/me')).status).toBe(200);
    expect((await other.get('/api/v1/auth/me')).status).toBe(401);

    const notes = await pool.query("SELECT type FROM notifications WHERE user_id = $1", [user.id]);
    expect(notes.rows.map((r) => r.type)).toContain('PASSWORD_CHANGED');
  });
});
