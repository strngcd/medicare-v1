const AppError = require('../../errors/AppError');
const { withTransaction } = require('../../database/db');
const { recordAudit, diff } = require('../audit/audit.recorder');
const { parseListParams } = require('../../utils/pagination');
const { camelize } = require('../../utils/camelize');
const { businessToday } = require('../../utils/time');
const { resolveBranchScope, loadAccessibleBranch } = require('../../permissions/branchAccess');
const repo = require('./medicines.repository');

const SORTABLE = {
  name: 'm.name',
  status: 'm.status',
  category: 'c.name',
  createdAt: 'm.created_at',
  updatedAt: 'm.updated_at',
  stock: 'stock.sellable_quantity',
};

const AUDITED_FIELDS = [
  'name', 'genericName', 'brandName', 'categoryId', 'manufacturer', 'countryOfOrigin', 'strength',
  'dosageForm', 'packageSize', 'prescriptionRequired', 'description', 'storageInstructions', 'status',
];

function toDto(row) {
  const dto = camelize(row);
  delete dto.totalCount;
  return dto;
}

async function assertAssignableCategory(client, categoryId) {
  if (!categoryId) return;
  const category = await repo.findCategory(client, categoryId);
  if (!category) throw AppError.validation('Category not found.', { fields: { categoryId: 'Select a valid category.' } });
  if (category.status !== 'ACTIVE') {
    throw AppError.conflict('CATEGORY_ARCHIVED', 'Archived categories cannot be assigned to medicines.', {
      fields: { categoryId: 'This category is archived.' },
    });
  }
}

async function assertBarcodeAvailable(client, barcode, excludeId) {
  if (!barcode) return;
  const owner = await repo.barcodeOwner(client, barcode, excludeId);
  if (owner) {
    throw AppError.conflict('DUPLICATE_BARCODE', `This barcode is already assigned to ${owner.name}.`, {
      fields: { barcode: 'This barcode is already in use.' },
    });
  }
}

function toDuplicateWarnings(rows) {
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    strength: r.strength,
    dosageForm: r.dosage_form,
    packageSize: r.package_size,
    status: r.status,
  }));
}

async function listMedicines(auth, query) {
  const params = parseListParams(query, { sortable: SORTABLE, defaultSort: 'name', defaultOrder: 'asc' });
  const { rows, total } = await repo.list({
    branchIds: resolveBranchScope(auth, query.branchId),
    today: businessToday(),
    search: query.search,
    categoryId: query.categoryId,
    status: query.status,
    prescriptionRequired: query.prescriptionRequired,
    ...params,
  });
  return { rows: rows.map(toDto), total, page: params.page, limit: params.limit };
}

async function getMedicine(auth, id, branchId) {
  const row = await repo.findById(id, undefined, {
    branchIds: resolveBranchScope(auth, branchId),
    today: businessToday(),
  });
  if (!row) throw AppError.notFound('Medicine not found.');
  return toDto(row);
}

async function searchForSale(auth, { q, branchId, categoryId, limit }) {
  await loadAccessibleBranch(auth, branchId);
  const rows = await repo.searchForSale({
    branchId,
    today: businessToday(),
    term: q,
    categoryId,
    limit: limit || 20,
  });
  return rows.map((r) => {
    const dto = camelize(r);
    dto.priceVaries = dto.minPrice !== null && dto.minPrice !== dto.maxPrice;
    return dto;
  });
}

async function createMedicine(auth, actor, data) {
  return withTransaction(async (client) => {
    await assertAssignableCategory(client, data.categoryId);
    await assertBarcodeAvailable(client, data.barcode);
    const duplicates = toDuplicateWarnings(await repo.findDuplicates(client, data));

    const id = await repo.insert(client, data, auth.userId);
    const created = toDto(await repo.findById(id, client));
    await recordAudit(client, actor, {
      action: 'MEDICINE_CREATED',
      entityType: 'MEDICINE',
      entityId: id,
      description: `Medicine ${created.name} created as draft`,
      newValues: Object.fromEntries([...AUDITED_FIELDS, 'barcode'].map((k) => [k, created[k] ?? null])),
    });
    // Duplicates are a warning only: the medicine is still created.
    return { medicine: created, warnings: { duplicates } };
  });
}

async function updateMedicine(auth, actor, id, changes) {
  return withTransaction(async (client) => {
    const existing = await repo.findById(id, client, { forUpdate: true });
    if (!existing) throw AppError.notFound('Medicine not found.');
    if (existing.status === 'ARCHIVED') {
      throw AppError.conflict('MEDICINE_ARCHIVED', 'Restore this medicine before editing it.');
    }
    if (changes.status === 'ACTIVE' && existing.status !== 'DRAFT') delete changes.status;
    if (changes.categoryId && changes.categoryId !== existing.category_id) {
      await assertAssignableCategory(client, changes.categoryId);
    }

    const before = toDto(existing);
    const { previous, next, changed } = diff(before, changes, Object.keys(changes));
    if (!changed) return { medicine: before, warnings: { duplicates: [] } };

    await repo.update(client, id, changes, auth.userId);
    const updated = toDto(await repo.findById(id, client));
    const duplicates = toDuplicateWarnings(await repo.findDuplicates(client, updated, id));
    await recordAudit(client, actor, {
      action: 'MEDICINE_UPDATED',
      entityType: 'MEDICINE',
      entityId: id,
      description: changes.status === 'ACTIVE' ? `Medicine ${updated.name} activated` : `Medicine ${updated.name} updated`,
      previousValues: previous,
      newValues: next,
    });
    return { medicine: updated, warnings: { duplicates } };
  });
}

async function changeBarcode(auth, actor, id, barcode) {
  return withTransaction(async (client) => {
    const existing = await repo.findById(id, client, { forUpdate: true });
    if (!existing) throw AppError.notFound('Medicine not found.');
    if (existing.barcode === barcode) return toDto(existing);
    await assertBarcodeAvailable(client, barcode, id);

    await repo.update(client, id, { barcode }, auth.userId);
    await recordAudit(client, actor, {
      action: 'BARCODE_CHANGED',
      entityType: 'MEDICINE',
      entityId: id,
      description: `Barcode of ${existing.name} ${barcode ? 'set' : 'removed'}`,
      previousValues: { barcode: existing.barcode },
      newValues: { barcode },
    });
    return toDto(await repo.findById(id, client));
  });
}

async function setArchived(auth, actor, id, archived) {
  return withTransaction(async (client) => {
    const existing = await repo.findById(id, client, { forUpdate: true });
    if (!existing) throw AppError.notFound('Medicine not found.');
    if (archived && existing.status === 'ARCHIVED') {
      throw AppError.conflict('INVALID_STATUS_TRANSITION', 'This medicine is already archived.');
    }
    if (!archived && existing.status !== 'ARCHIVED') {
      throw AppError.conflict('INVALID_STATUS_TRANSITION', 'Only archived medicines can be restored.');
    }

    await repo.setArchived(client, id, archived, auth.userId);
    await recordAudit(client, actor, {
      action: archived ? 'MEDICINE_ARCHIVED' : 'MEDICINE_RESTORED',
      entityType: 'MEDICINE',
      entityId: id,
      description: `Medicine ${existing.name} ${archived ? 'archived' : 'restored'}`,
      previousValues: { status: existing.status },
      newValues: { status: archived ? 'ARCHIVED' : 'ACTIVE' },
    });
    return toDto(await repo.findById(id, client));
  });
}

module.exports = {
  listMedicines,
  getMedicine,
  searchForSale,
  createMedicine,
  updateMedicine,
  changeBarcode,
  archiveMedicine: (auth, actor, id) => setArchived(auth, actor, id, true),
  restoreMedicine: (auth, actor, id) => setArchived(auth, actor, id, false),
};
