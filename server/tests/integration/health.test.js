const request = require('supertest');
const { createApp } = require('../../src/app');
const pool = require('../../src/database/pool');

afterAll(() => pool.end());

describe('API shell', () => {
  const app = createApp();

  test('GET /api/v1/health returns the success envelope', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { status: 'ok' }, message: 'Service is healthy.' });
  });

  test('unknown API routes return a stable 404 error', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  test('malformed JSON returns 400 without leaking parser details', async () => {
    const res = await request(app)
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MALFORMED_REQUEST');
  });
});
