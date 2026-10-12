const { query } = require('../../database/db');

const COLUMNS = 'id, slug, category, title, summary, updated_at';

async function list(category) {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM help_articles
      WHERE status = 'PUBLISHED' AND ($1::text IS NULL OR category = $1)
      ORDER BY category, sort_order, title`,
    [category || null],
  );
  return rows;
}

async function search(term) {
  const { rows } = await query(
    `SELECT ${COLUMNS},
            ts_headline('english', body, websearch_to_tsquery('english', $1),
                        'MaxWords=25, MinWords=10, StartSel=<<, StopSel=>>') AS excerpt,
            ts_rank(search_vector, websearch_to_tsquery('english', $1)) AS rank
       FROM help_articles
      WHERE status = 'PUBLISHED'
        AND (search_vector @@ websearch_to_tsquery('english', $1) OR title ILIKE '%' || $1 || '%')
      ORDER BY rank DESC, title
      LIMIT 20`,
    [term],
  );
  return rows;
}

/** By id or slug; only published articles are ever returned. */
async function find(idOrSlug) {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug);
  const { rows } = await query(
    `SELECT ${COLUMNS}, body FROM help_articles
      WHERE status = 'PUBLISHED' AND ${isUuid ? 'id = $1::uuid' : 'slug = $1'}`,
    [idOrSlug],
  );
  return rows[0] || null;
}

module.exports = { list, search, find };
