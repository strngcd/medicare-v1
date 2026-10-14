const AppError = require('../../errors/AppError');
const { withTransaction } = require('../../database/db');
const { recordAudit, diff } = require('../audit/audit.recorder');
const { parseListParams } = require('../../utils/pagination');
const { camelize } = require('../../utils/camelize');
const repo = require('./categories.repository');

const SORTABLE = { name: 'c.name', status: 'c.status', createdAt: 'c.created_at', medicineCount: 'medicine_count' };

function toDto(row) {
  const dto = camelize(row);
  delete dto.totalCount;
  return dto;
}

async function assertNameAvailable(client, name, excludeId) {
  if (name && (await repo.nameExists(client, name, excludeId))) {
    throw AppError.conflict('DUPLICATE_CATEGORY', 'A category with this name already exists.', {
      fields: { name: 'This name is already used.' },
    });
  }
}

async function listCategories(query) {
  const params = parseListParams(query, { sortable: SORTABLE, defaultSort: 'name', defaultOrder: 'asc' });
  const { rows, total } = await repo.list({ status: query.status, productType: query.productType, search: query.search, ...params });
  return { rows: rows.map(toDto), total, page: params.page, limit: params.limit };
}

async function createCategory(auth, actor, data) {
  return withTransaction(async (client) => {
    await assertNameAvailable(client, data.name);
    const id = await repo.insert(client, data, auth.userId);
    const created = toDto(await repo.findById(id, client));
    await recordAudit(client, actor, {
      action: 'CATEGORY_CREATED',
      entityType: 'CATEGORY',
      entityId: id,
      description: `Category ${created.name} created`,
      newValues: { name: created.name, description: created.description, productType: created.productType },
    });
    return created;
  });
}

async function updateCategory(auth, actor, id, changes) {
  return withTransaction(async (client) => {
    const existing = await repo.findById(id, client, { forUpdate: true });
    if (!existing) throw AppError.notFound('Category not found.');
    await assertNameAvailable(client, changes.name, id);

    const before = toDto(existing);
    const { previous, next, changed } = diff(before, changes, Object.keys(changes));
    if (!changed) return before;
    await repo.update(client, id, changes, auth.userId);
    await recordAudit(client, actor, {
      action: 'CATEGORY_UPDATED',
      entityType: 'CATEGORY',
      entityId: id,
      description: `Category ${existing.name} updated`,
      previousValues: previous,
      newValues: next,
    });
    return toDto(await repo.findById(id, client));
  });
}

async function changeStatus(auth, actor, id, targetStatus) {
  return withTransaction(async (client) => {
    const existing = await repo.findById(id, client, { forUpdate: true });
    if (!existing) throw AppError.notFound('Category not found.');
    if (existing.status === targetStatus) {
      throw AppError.conflict('INVALID_STATUS_TRANSITION', `This category is already ${targetStatus.toLowerCase()}.`);
    }
    // Existing medicines keep their category; archived categories just cannot be newly assigned.
    await repo.setStatus(client, id, targetStatus, auth.userId);
    await recordAudit(client, actor, {
      action: targetStatus === 'ARCHIVED' ? 'CATEGORY_ARCHIVED' : 'CATEGORY_RESTORED',
      entityType: 'CATEGORY',
      entityId: id,
      description: `Category ${existing.name} ${targetStatus === 'ARCHIVED' ? 'archived' : 'restored'}`,
      previousValues: { status: existing.status },
      newValues: { status: targetStatus },
    });
    return toDto(await repo.findById(id, client));
  });
}

module.exports = {
  listCategories,
  createCategory,
  updateCategory,
  archiveCategory: (auth, actor, id) => changeStatus(auth, actor, id, 'ARCHIVED'),
  restoreCategory: (auth, actor, id) => changeStatus(auth, actor, id, 'ACTIVE'),
};
