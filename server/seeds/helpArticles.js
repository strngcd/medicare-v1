const ARTICLES = require('./helpContent');

/** Upserts help articles by slug so content updates ship with the code. */
async function seedHelpArticles(client) {
  for (const [index, article] of ARTICLES.entries()) {
    await client.query(
      `INSERT INTO help_articles (slug, category, title, summary, body, status, sort_order)
       VALUES ($1, $2, $3, $4, $5, 'PUBLISHED', $6)
       ON CONFLICT (slug) DO UPDATE
         SET category = EXCLUDED.category, title = EXCLUDED.title, summary = EXCLUDED.summary,
             body = EXCLUDED.body, sort_order = EXCLUDED.sort_order`,
      [article.slug, article.category, article.title, article.summary, article.body.trim(), index],
    );
  }
}

module.exports = { seedHelpArticles };
