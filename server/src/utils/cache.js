/**
 * Tiny in-process cache for expensive aggregate reads.
 *
 * Keys must include everything that affects the response for the caller
 * (branch scope, permission flags, filters) so cached data never crosses an
 * authorization boundary.
 *
 * Every successful write moves the data version on. By default an entry
 * computed before the latest write is never served, so reports and the
 * dashboard reflect a sale or refund on the very next read. Callers may opt
 * into a short staleness window (`maxStaleMs`) where exactness matters less.
 */
const MAX_ENTRIES = 500;
const TTL_MS = 60 * 1000;

let version = 0;
const store = new Map();

/** Data changed: entries from before now are stale (but may still serve a staleness window). */
function markWrite() {
  version += 1;
}

/** Drops everything immediately (e.g. after a database reset). */
function bumpVersion() {
  version += 1;
  store.clear();
}

async function cached(keyParts, compute, { maxStaleMs = 0 } = {}) {
  const key = JSON.stringify(keyParts);
  const now = Date.now();
  const hit = store.get(key);
  if (hit && now - hit.computedAt < TTL_MS && (hit.version === version || now - hit.computedAt < maxStaleMs)) {
    return hit.value;
  }

  const computedFor = version;
  const value = await compute();
  if (!store.has(key) && store.size >= MAX_ENTRIES) store.delete(store.keys().next().value);
  // A write during the computation already made this result stale for exact readers.
  store.set(key, { value, version: computedFor, computedAt: now });
  return value;
}

/** Express middleware: mark data as changed after any successful write. */
function invalidateOnWrite(req, res, next) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    res.on('finish', () => {
      if (res.statusCode < 400) markWrite();
    });
  }
  next();
}

module.exports = { cached, bumpVersion, markWrite, invalidateOnWrite, _store: store };
