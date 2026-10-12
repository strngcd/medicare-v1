/**
 * Tiny in-process cache for expensive aggregate reads.
 *
 * Keys must include everything that affects the response for the caller
 * (branch scope, permission flags, filters) so cached data never crosses an
 * authorization boundary. Any successful write bumps a global version that
 * is part of every key, so cached aggregates are never stale.
 */
const MAX_ENTRIES = 500;
const TTL_MS = 60 * 1000;

let version = 0;
const store = new Map();

function bumpVersion() {
  version += 1;
  store.clear();
}

async function cached(keyParts, compute) {
  const key = JSON.stringify([version, keyParts]);
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const value = await compute();
  if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value);
  store.set(key, { value, expires: Date.now() + TTL_MS });
  return value;
}

/** Express middleware: invalidate the cache after any successful write. */
function invalidateOnWrite(req, res, next) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    res.on('finish', () => {
      if (res.statusCode < 400) bumpVersion();
    });
  }
  next();
}

module.exports = { cached, bumpVersion, invalidateOnWrite, _store: store };
