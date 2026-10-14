const config = require('../config');

/**
 * Normalizes page/limit and resolves sorting against a whitelist.
 * `sortable` maps API field names to trusted SQL expressions; client input
 * is only ever used as a lookup key, never concatenated into SQL.
 * `exportLimit` (server-side only, for exports) returns one page of up to
 * that many rows instead of honouring the client's page and limit.
 */
function parseListParams(query, { sortable, defaultSort, defaultOrder = 'desc', exportLimit }) {
  const page = exportLimit ? 1 : Math.max(1, Number.parseInt(query.page, 10) || 1);
  const requestedLimit = Number.parseInt(query.limit, 10) || config.pagination.defaultLimit;
  const limit = exportLimit || Math.min(Math.max(1, requestedLimit), config.pagination.maxLimit);

  const sortKey = Object.prototype.hasOwnProperty.call(sortable, query.sortBy) ? query.sortBy : defaultSort;
  const order = String(query.sortOrder || defaultOrder).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  return {
    page,
    limit,
    offset: (page - 1) * limit,
    orderBy: `${sortable[sortKey]} ${order}`,
  };
}

/**
 * Tiny helper for building parameterized WHERE clauses.
 *   const w = whereBuilder(); w.add('status = ?', status); w.sql -> 'WHERE status = $1'
 */
function whereBuilder(initialParams = []) {
  const clauses = [];
  const params = [...initialParams];
  return {
    params,
    add(clause, ...values) {
      let sql = clause;
      for (const value of values) {
        params.push(value);
        sql = sql.replace('?', `$${params.length}`);
      }
      clauses.push(sql);
      return this;
    },
    param(value) {
      params.push(value);
      return `$${params.length}`;
    },
    get sql() {
      return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    },
    get conditions() {
      return clauses;
    },
  };
}

module.exports = { parseListParams, whereBuilder };
