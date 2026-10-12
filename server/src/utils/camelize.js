/**
 * Converts snake_case row keys to camelCase for API responses.
 * Repositories select explicit columns, so nothing sensitive is ever mapped.
 */
function toCamel(key) {
  return key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function camelize(row) {
  if (row === null || row === undefined) return row;
  if (Array.isArray(row)) return row.map(camelize);
  if (typeof row !== 'object' || row instanceof Date) return row;
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[toCamel(key)] = value !== null && typeof value === 'object' && !(value instanceof Date) ? camelize(value) : value;
  }
  return out;
}

module.exports = { camelize };
