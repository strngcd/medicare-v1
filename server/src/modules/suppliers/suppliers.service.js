const AppError = require('../../errors/AppError');
const { withTransaction } = require('../../database/db');
const { recordAudit, diff } = require('../audit/audit.recorder');
const { parseListParams } = require('../../utils/pagination');
const { camelize } = require('../../utils/camelize');
const repo = require('./suppliers.repository');

const SORTABLE = { companyName: 's.company_name', status: 's.status', createdAt: 's.created_at' };

function toDto(row) {
  const dto = camelize(row);
  delete dto.totalCount;
  return dto;
}

function toWarnings(similar) {
  return { similarSuppliers: similar.map((s) => ({ id: s.id, companyName: s.company_name, phone: s.phone, status: s.status })) };
}

async function listSuppliers(query) {
  const params = parseListParams(query, { sortable: SORTABLE, defaultSort: 'companyName', defaultOrder: 'asc' });
  const { rows, total } = await repo.list({ status: query.status, search: query.search, ...params });
  return { rows: rows.map(toDto), total, page: params.page, limit: params.limit };
}

async function getSupplier(id) {
  const row = await repo.findById(id);
  if (!row) throw AppError.notFound('Supplier not found.');
  // Only a supplier nothing was ever bought from or paid may be deleted.
  return { ...toDto(row), canDelete: !(await repo.hasActivity(id)) };
}

async function createSupplier(auth, actor, data) {
  return withTransaction(async (client) => {
    const similar = await repo.findSimilar(client, data.companyName);
    const id = await repo.insert(client, data, auth.userId);
    const created = toDto(await repo.findById(id, client));
    await recordAudit(client, actor, {
      action: 'SUPPLIER_CREATED',
      entityType: 'SUPPLIER',
      entityId: id,
      description: `Supplier ${created.companyName} created`,
      newValues: data,
    });
    return { supplier: created, warnings: toWarnings(similar) };
  });
}

async function updateSupplier(auth, actor, id, changes) {
  return withTransaction(async (client) => {
    const existing = await repo.findById(id, client, { forUpdate: true });
    if (!existing) throw AppError.notFound('Supplier not found.');
    const before = toDto(existing);
    const { previous, next, changed } = diff(before, changes, Object.keys(changes));
    if (!changed) return { supplier: before, warnings: toWarnings([]) };

    await repo.update(client, id, changes, auth.userId);
    const similar = changes.companyName ? await repo.findSimilar(client, changes.companyName, id) : [];
    await recordAudit(client, actor, {
      action: 'SUPPLIER_UPDATED',
      entityType: 'SUPPLIER',
      entityId: id,
      description: `Supplier ${existing.company_name} updated`,
      previousValues: previous,
      newValues: next,
    });
    return { supplier: toDto(await repo.findById(id, client)), warnings: toWarnings(similar) };
  });
}

async function changeStatus(auth, actor, id, targetStatus) {
  return withTransaction(async (client) => {
    const existing = await repo.findById(id, client, { forUpdate: true });
    if (!existing) throw AppError.notFound('Supplier not found.');
    if (existing.status === targetStatus) {
      throw AppError.conflict('INVALID_STATUS_TRANSITION', `This supplier is already ${targetStatus.toLowerCase()}.`);
    }
    await repo.setStatus(client, id, targetStatus, auth.userId);
    await recordAudit(client, actor, {
      action: targetStatus === 'ARCHIVED' ? 'SUPPLIER_ARCHIVED' : 'SUPPLIER_RESTORED',
      entityType: 'SUPPLIER',
      entityId: id,
      description: `Supplier ${existing.company_name} ${targetStatus === 'ARCHIVED' ? 'archived' : 'restored'}`,
      previousValues: { status: existing.status },
      newValues: { status: targetStatus },
    });
    return toDto(await repo.findById(id, client));
  });
}

/** Deletes a supplier created by mistake (soft delete, only while unused). */
async function deleteSupplier(auth, actor, id) {
  return withTransaction(async (client) => {
    const existing = await repo.findById(id, client, { forUpdate: true });
    if (!existing) throw AppError.notFound('Supplier not found.');
    if (await repo.hasActivity(id, client)) {
      throw AppError.conflict(
        'RECORD_IN_USE',
        'This supplier already has purchases or payments, so it cannot be deleted. Archive it instead.',
      );
    }
    await repo.markDeleted(client, id, auth.userId);
    await recordAudit(client, actor, {
      action: 'SUPPLIER_DELETED',
      entityType: 'SUPPLIER',
      entityId: id,
      description: `Supplier ${existing.company_name} deleted`,
      previousValues: toDto(existing),
    });
    return { id };
  });
}

module.exports = {
  deleteSupplier,
  listSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  archiveSupplier: (auth, actor, id) => changeStatus(auth, actor, id, 'ARCHIVED'),
  restoreSupplier: (auth, actor, id) => changeStatus(auth, actor, id, 'ACTIVE'),
};
