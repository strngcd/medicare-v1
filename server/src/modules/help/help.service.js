const AppError = require('../../errors/AppError');
const { camelize } = require('../../utils/camelize');
const repo = require('./help.repository');

const CATEGORY_LABELS = {
  GETTING_STARTED: 'Getting started',
  MEDICINES: 'Medicines',
  INVENTORY: 'Inventory',
  PURCHASING: 'Purchasing',
  POS_SALES: 'POS and sales',
  REFUNDS: 'Refunds',
  REPORTS: 'Reports',
  STAFF_PERMISSIONS: 'Staff and permissions',
  BRANCHES: 'Branches',
  SETTINGS: 'Settings',
};

async function listArticles(category) {
  const articles = camelize(await repo.list(category));
  const categories = Object.entries(CATEGORY_LABELS).map(([code, label]) => ({
    code,
    label,
    articles: articles.filter((a) => a.category === code),
  })).filter((c) => c.articles.length > 0);
  return { categories };
}

async function searchArticles(term) {
  return camelize(await repo.search(term)).map(({ rank, excerpt, ...rest }) => ({
    ...rest,
    excerpt: excerpt ? excerpt.replace(/<<|>>/g, '') : null,
  }));
}

async function getArticle(idOrSlug) {
  const article = await repo.find(idOrSlug);
  if (!article) throw AppError.notFound('Help article not found.');
  return { ...camelize(article), categoryLabel: CATEGORY_LABELS[article.category] };
}

module.exports = { listArticles, searchArticles, getArticle, CATEGORY_LABELS };
