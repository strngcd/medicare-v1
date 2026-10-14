/**
 * Thin wrapper around fetch for the Medicar API.
 *
 * - Sends cookies (same-origin session) and the CSRF token on unsafe methods.
 * - Normalizes errors into ApiError with the server's stable code.
 * - Never exposes raw server/database messages: unexpected failures get a
 *   generic, user-friendly message.
 */
const BASE = '/api/v1';
const CSRF_COOKIE = 'medicar_csrf';

export class ApiError extends Error {
  constructor({ status, code, message, details }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details || {};
  }

  /** Field-level messages from a 422 validation error, if any. */
  get fieldErrors() {
    return (this.details && this.details.fields) || {};
  }
}

function readCookie(name) {
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=')[1]) : null;
}

let unauthorizedHandler = null;
/** The auth provider registers a callback for expired/revoked sessions. */
export function onUnauthorized(handler) {
  unauthorizedHandler = handler;
}

function buildUrl(path, params) {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    }
  }
  return url.pathname + url.search;
}

/* In-flight request tracking so the shell can show a global loading indicator. */
let pending = 0;
const activityListeners = new Set();
function setPending(delta) {
  pending = Math.max(0, pending + delta);
  activityListeners.forEach((listener) => listener(pending));
}
/** Subscribes to the number of in-flight API requests; returns an unsubscribe function. */
export function onActivity(listener) {
  activityListeners.add(listener);
  listener(pending);
  return () => activityListeners.delete(listener);
}

export async function request(method, path, options = {}) {
  setPending(1);
  try {
    return await send(method, path, options);
  } finally {
    setPending(-1);
  }
}

async function send(method, path, { params, body, idempotencyKey, raw = false }) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!['GET', 'HEAD'].includes(method)) {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  let response;
  try {
    response = await fetch(buildUrl(path, params), {
      method,
      headers,
      credentials: 'same-origin',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError({ status: 0, code: 'NETWORK_ERROR', message: 'Cannot reach the server. Check your connection and try again.' });
  }

  if (raw && response.ok) return response;

  let payload = null;
  const isJson = (response.headers.get('content-type') || '').includes('application/json');
  if (isJson) payload = await response.json().catch(() => null);

  if (!response.ok || (payload && payload.success === false)) {
    const error = payload && payload.error;
    if (response.status === 401 && unauthorizedHandler && !path.startsWith('/auth/login')) unauthorizedHandler();
    throw new ApiError({
      status: response.status,
      code: (error && error.code) || 'UNEXPECTED_ERROR',
      message:
        response.status >= 500 || !error
          ? 'Something went wrong on our side. Please try again.'
          : error.message,
      details: error && error.details,
    });
  }
  return payload;
}

export const api = {
  get: (path, params) => request('GET', path, { params }),
  post: (path, body, options) => request('POST', path, { body: body ?? {}, ...options }),
  patch: (path, body, options) => request('PATCH', path, { body: body ?? {}, ...options }),
  put: (path, body, options) => request('PUT', path, { body: body ?? {}, ...options }),
  delete: (path, options) => request('DELETE', path, options),
  /** Downloads a file response (exports). */
  async download(path, params, fallbackName) {
    const response = await request('GET', path, { params, raw: true });
    const disposition = response.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/);
    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = match ? match[1] : fallbackName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  },
};

/** A fresh idempotency key for one business operation attempt. */
export function newIdempotencyKey(prefix = 'op') {
  const random = window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}
