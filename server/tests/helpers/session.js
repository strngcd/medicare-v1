const request = require('supertest');
const { createApp } = require('../../src/app');

const app = createApp();

/**
 * A logged-in client that keeps the session cookie and automatically sends
 * the CSRF header on state-changing requests, like the real SPA does.
 */
async function loginAs(user, password = user.password) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ email: user.email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${user.email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const csrfCookie = res.headers['set-cookie'].find((c) => c.startsWith('medicar_csrf='));
  const csrfToken = decodeURIComponent(csrfCookie.split(';')[0].split('=')[1]);

  const withCsrf = (method) => (url) => agent[method](url).set('X-CSRF-Token', csrfToken);
  return {
    agent,
    csrfToken,
    session: res.body.data,
    get: (url) => agent.get(url),
    post: withCsrf('post'),
    put: withCsrf('put'),
    patch: withCsrf('patch'),
    delete: withCsrf('delete'),
  };
}

module.exports = { app, loginAs, request };
