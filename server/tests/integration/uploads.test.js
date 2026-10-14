const { resetDatabase, pool } = require('../helpers/db');
const { createBranch, createUser } = require('../helpers/factories');
const { loginAs, request, app } = require('../helpers/session');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

let branch;
let owner;
let admin;
let cashier;
let cashierUser;

beforeEach(async () => {
  await resetDatabase();
  branch = await createBranch({ name: 'Bole', code: 'BOLE' });
  owner = await loginAs(await createUser({ role: 'OWNER' }));
  admin = await loginAs(await createUser({ role: 'ADMIN', branches: [branch] }));
  cashierUser = await createUser({ role: 'CASHIER', branches: [branch], fullName: 'Selam Cashier' });
  cashier = await loginAs(cashierUser);
});

afterAll(() => pool.end());

describe('pharmacy logo', () => {
  test('uploads, is served publicly, appears in branding, and can be removed', async () => {
    const res = await owner.put('/api/v1/settings/logo').set('Content-Type', 'image/png').set('X-File-Name', 'logo.png').send(PNG);
    expect(res.status).toBe(200);
    expect(res.body.data.logoUrl).toMatch(/^\/api\/v1\/branding\/logo\?v=[0-9a-f-]{36}$/);

    const branding = await request(app).get('/api/v1/branding');
    expect(branding.body.data.logoUrl).toBe(res.body.data.logoUrl);

    const image = await request(app).get(res.body.data.logoUrl);
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(image.body, PNG)).toBe(0);

    const removed = await owner.delete('/api/v1/settings/logo');
    expect(removed.body.data.logoUrl).toBeNull();
    expect((await request(app).get('/api/v1/branding/logo')).status).toBe(404);

    const { rows } = await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE description LIKE 'Pharmacy logo%'");
    expect(rows[0].n).toBe(2);
  });

  test('rejects wrong types, disguised files, oversize files and missing permissions', async () => {
    const pdfAsLogo = await owner.put('/api/v1/settings/logo').set('Content-Type', 'application/pdf').send(PDF);
    expect(pdfAsLogo.status).toBe(400);

    const disguised = await owner.put('/api/v1/settings/logo').set('Content-Type', 'image/png').send(Buffer.from('<svg onload=alert(1)>'));
    expect(disguised.status).toBe(400);
    expect(disguised.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');

    const huge = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
    const tooBig = await owner.put('/api/v1/settings/logo').set('Content-Type', 'image/png').send(huge);
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error.code).toBe('FILE_TOO_LARGE');

    expect((await cashier.put('/api/v1/settings/logo').set('Content-Type', 'image/png').send(PNG)).status).toBe(403);
  });

  test('requires the CSRF token', async () => {
    const res = await owner.agent.put('/api/v1/settings/logo').set('Content-Type', 'image/png').send(PNG);
    expect(res.status).toBe(403);
  });

  test('no longer accepts a logo URL', async () => {
    const res = await owner.patch('/api/v1/settings').send({ logoUrl: 'https://example.com/logo.png' });
    expect(res.status).toBe(422);
  });
});

describe('staff CV', () => {
  test('admin uploads, views, replaces and removes a CV; it shows on the staff record', async () => {
    const url = `/api/v1/users/${cashierUser.id}/cv`;
    const up = await admin.put(url).set('Content-Type', 'application/pdf').set('X-File-Name', encodeURIComponent('Selam CV.pdf')).send(PDF);
    expect(up.status).toBe(200);
    expect(up.body.data.cv).toMatchObject({ fileName: 'Selam CV.pdf', sizeBytes: PDF.length });

    const file = await admin.get(url).buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['content-disposition']).toMatch(/^inline;/);
    expect(Buffer.compare(file.body, PDF)).toBe(0);

    const replaced = await admin.put(url).set('Content-Type', 'application/pdf').set('X-File-Name', 'new.pdf').send(PDF);
    expect(replaced.body.data.cv.fileName).toBe('new.pdf');
    expect(replaced.body.data.cv.id).not.toBe(up.body.data.cv.id);

    const removed = await admin.delete(url);
    expect(removed.body.data.cv).toBeNull();
    expect((await admin.get(url)).status).toBe(404);
  });

  test('only PDFs, and only by staff managers with authority over the user', async () => {
    const url = `/api/v1/users/${cashierUser.id}/cv`;
    const png = await admin.put(url).set('Content-Type', 'image/png').send(PNG);
    expect(png.status).toBe(400);

    const fakePdf = await admin.put(url).set('Content-Type', 'application/pdf').send(Buffer.from('not a pdf'));
    expect(fakePdf.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');

    expect((await cashier.put(url).set('Content-Type', 'application/pdf').send(PDF)).status).toBe(403);
    expect((await cashier.get(url)).status).toBe(403);

    const ownerUser = (await pool.query("SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'OWNER'")).rows[0];
    const onOwner = await admin.put(`/api/v1/users/${ownerUser.id}/cv`).set('Content-Type', 'application/pdf').send(PDF);
    expect(onOwner.status).toBe(403);

    await owner.put(`/api/v1/users/${ownerUser.id}/cv`).set('Content-Type', 'application/pdf').send(PDF).expect(200);
  });

  test('stored files are immutable', async () => {
    await admin.put(`/api/v1/users/${cashierUser.id}/cv`).set('Content-Type', 'application/pdf').send(PDF).expect(200);
    await expect(pool.query("UPDATE stored_files SET file_name = 'x.pdf'")).rejects.toThrow(/append-only/);
  });
});

test('other JSON endpoints still reject non-JSON bodies', async () => {
  const res = await owner.post('/api/v1/branches').set('Content-Type', 'text/plain').send('name=x');
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('UNSUPPORTED_CONTENT_TYPE');
});
