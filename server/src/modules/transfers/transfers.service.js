const AppError = require('../../errors/AppError');
const config = require('../../config');
const { withTransaction } = require('../../database/db');
const { recordAudit } = require('../audit/audit.recorder');
const { runIdempotent } = require('../idempotency/idempotency');
const { nextDocumentNumber } = require('../documents/documentNumbers');
const { notifyUsers, findBranchRecipients } = require('../notifications/notification.writer');
const { parseListParams } = require('../../utils/pagination');
const { camelize } = require('../../utils/camelize');
const { businessToday } = require('../../utils/time');
const { PERMISSIONS: P } = require('../../permissions/catalog');
const { canAccessBranch, resolveBranchScope, loadAccessibleBranch } = require('../../permissions/branchAccess');
const ledger = require('../inventory/inventory.ledger');
const repo = require('./transfers.repository');

const SORTABLE = { createdAt: 't.created_at', transferNumber: 't.transfer_number', status: 't.status' };

function toDto(row) {
  const dto = camelize(row);
  delete dto.totalCount;
  return dto;
}

function invalidState(transfer, action) {
  return AppError.conflict('TRANSFER_INVALID_STATE', `A ${transfer.status.toLowerCase().replace('_', ' ')} transfer cannot be ${action}.`, {
    status: transfer.status,
  });
}

/** Access to either end of the transfer. */
function assertTransferAccess(auth, transfer) {
  if (canAccessBranch(auth, transfer.source_branch_id) || canAccessBranch(auth, transfer.destination_branch_id)) return;
  throw AppError.notFound('Transfer not found.');
}

function assertSideAccess(auth, branchId, side) {
  if (!canAccessBranch(auth, branchId)) {
    throw AppError.forbidden('BRANCH_ACCESS_DENIED', `Only staff of the ${side} branch can perform this step.`);
  }
}

async function loadTransfer(auth, id, client, options) {
  const transfer = await repo.findById(id, client, options);
  if (!transfer) throw AppError.notFound('Transfer not found.');
  assertTransferAccess(auth, transfer);
  return transfer;
}

async function notifyBranch(client, branchId, permission, auth, notification) {
  const recipients = await findBranchRecipients(client, branchId, permission, auth.userId);
  await notifyUsers(client, recipients, { ...notification, branchId, entityType: 'TRANSFER' });
}

/**
 * Applies per-item quantities for a step. Missing items default to the
 * previous step's quantity; every value must respect
 * received <= shipped <= approved <= requested.
 */
function resolveStepQuantities(items, input, previousColumn, label) {
  const provided = new Map((input || []).map((i) => [i.transferItemId, i.quantity]));
  for (const id of provided.keys()) {
    if (!items.some((item) => item.id === id)) {
      throw AppError.validation('An item does not belong to this transfer.', { transferItemId: id });
    }
  }
  return items.map((item) => {
    const max = item[previousColumn];
    const quantity = provided.has(item.id) ? provided.get(item.id) : max;
    if (quantity > max) {
      throw AppError.validation(`${label} quantity for ${item.medicine_name} cannot exceed ${max}.`, {
        transferItemId: item.id,
        maximum: max,
      });
    }
    return { item, quantity };
  });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

async function listTransfers(auth, query) {
  const params = parseListParams(query, { sortable: SORTABLE, defaultSort: 'createdAt' });
  const { rows, total } = await repo.list({
    branchIds: resolveBranchScope(auth, query.branchId),
    status: query.status,
    sourceBranchId: query.sourceBranchId,
    destinationBranchId: query.destinationBranchId,
    search: query.search,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    timezone: config.businessTimezone,
    ...params,
  });
  return { rows: rows.map(toDto), total, page: params.page, limit: params.limit };
}

async function getTransfer(auth, id) {
  const transfer = await loadTransfer(auth, id);
  const items = await repo.listItems(id);
  return { ...toDto(transfer), items: camelize(items) };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function createTransfer(auth, actor, input) {
  if (input.sourceBranchId === input.destinationBranchId) {
    throw AppError.validation('Source and destination must be different branches.', {
      fields: { destinationBranchId: 'Choose a different branch.' },
    });
  }
  if (!canAccessBranch(auth, input.sourceBranchId) && !canAccessBranch(auth, input.destinationBranchId)) {
    throw AppError.forbidden('BRANCH_ACCESS_DENIED', 'You must belong to the source or destination branch.');
  }
  const batchIds = input.items.map((i) => i.batchId);
  if (new Set(batchIds).size !== batchIds.length) {
    throw AppError.validation('Each batch can appear only once in a transfer.');
  }
  const today = businessToday();

  const id = await withTransaction(async (client) => {
    const source = await loadBranchForTransfer(client, input.sourceBranchId);
    const destination = await loadBranchForTransfer(client, input.destinationBranchId);

    const batches = await repo.findBatches(client, batchIds);
    const batchesById = new Map(batches.map((b) => [b.id, b]));
    const available = await repo.sourceQuantities(client, source.id, batchIds);
    for (const item of input.items) {
      const batch = batchesById.get(item.batchId);
      if (!batch) throw AppError.validation('Batch not found.', { batchId: item.batchId });
      if (batch.medicine_status !== 'ACTIVE') {
        throw AppError.conflict('MEDICINE_NOT_ACTIVE', `${batch.medicine_name} is not active.`, { batchId: batch.id });
      }
      if (batch.expiry_date < today) {
        throw AppError.conflict('BATCH_EXPIRED', `Batch ${batch.batch_number} is expired and cannot be transferred.`, { batchId: batch.id });
      }
      const onHand = available.get(batch.id) || 0;
      if (item.requestedQuantity > onHand) {
        throw AppError.conflict('TRANSFER_INSUFFICIENT_STOCK', `Only ${onHand} unit(s) of batch ${batch.batch_number} are available at ${source.name}.`, {
          batchId: batch.id,
          available: onHand,
          requested: item.requestedQuantity,
        });
      }
    }

    const transferNumber = await nextDocumentNumber(client, 'TRANSFER');
    const transferId = await repo.insertTransfer(client, {
      transferNumber,
      sourceBranchId: source.id,
      destinationBranchId: destination.id,
      userId: auth.userId,
      notes: input.notes,
    });
    for (const item of input.items) {
      await repo.insertItem(client, transferId, { ...item, medicineId: batchesById.get(item.batchId).medicine_id });
    }
    await recordAudit(client, actor, {
      action: 'TRANSFER_CREATED',
      entityType: 'TRANSFER',
      entityId: transferId,
      branchId: source.id,
      description: `Transfer ${transferNumber} created from ${source.name} to ${destination.name}`,
      newValues: { transferNumber, source: source.code, destination: destination.code, items: input.items.length },
    });
    return transferId;
  });
  return getTransfer(auth, id);
}

async function loadBranchForTransfer(client, branchId) {
  const branch = await repo.findBranch(client, branchId);
  if (!branch) throw AppError.notFound('Branch not found.');
  if (branch.status !== 'ACTIVE') {
    throw AppError.conflict('BRANCH_INACTIVE', `${branch.name} is inactive and cannot take part in transfers.`);
  }
  return branch;
}

async function requestTransfer(auth, actor, id) {
  await withTransaction(async (client) => {
    const transfer = await loadTransfer(auth, id, client, { forUpdate: true });
    if (transfer.status !== 'DRAFT') throw invalidState(transfer, 'requested');
    await repo.setStatus(client, id, 'REQUESTED', auth.userId);
    await recordAudit(client, actor, {
      action: 'TRANSFER_REQUESTED',
      entityType: 'TRANSFER',
      entityId: id,
      branchId: transfer.source_branch_id,
      description: `Transfer ${transfer.transfer_number} requested`,
      previousValues: { status: 'DRAFT' },
      newValues: { status: 'REQUESTED' },
    });
    await notifyBranch(client, transfer.source_branch_id, P.INVENTORY_TRANSFER_APPROVE, auth, {
      type: 'TRANSFER_REQUESTED',
      title: 'Transfer requested',
      message: `${transfer.transfer_number} to ${transfer.destination_branch_name} is waiting for approval.`,
      entityId: id,
    });
  });
  return getTransfer(auth, id);
}

async function approveTransfer(auth, actor, id, input) {
  await withTransaction(async (client) => {
    const transfer = await loadTransfer(auth, id, client, { forUpdate: true });
    if (transfer.status !== 'REQUESTED') throw invalidState(transfer, 'approved');
    assertSideAccess(auth, transfer.source_branch_id, 'source');

    const items = await repo.listItems(id, client);
    const resolved = resolveStepQuantities(items, input.items, 'requested_quantity', 'Approved');
    if (resolved.every((r) => r.quantity === 0)) {
      throw AppError.validation('Approve at least one unit, or cancel the transfer instead.');
    }
    for (const { item, quantity } of resolved) await repo.setItemQuantity(client, item.id, 'approved_quantity', quantity);
    await repo.setStatus(client, id, 'APPROVED', auth.userId);

    await recordAudit(client, actor, {
      action: 'TRANSFER_APPROVED',
      entityType: 'TRANSFER',
      entityId: id,
      branchId: transfer.source_branch_id,
      description: `Transfer ${transfer.transfer_number} approved`,
      previousValues: { status: 'REQUESTED' },
      newValues: { status: 'APPROVED', approved: resolved.map((r) => ({ batch: r.item.batch_number, quantity: r.quantity })) },
    });
    await notifyBranch(client, transfer.destination_branch_id, P.INVENTORY_TRANSFER_VIEW, auth, {
      type: 'TRANSFER_APPROVED',
      title: 'Transfer approved',
      message: `${transfer.transfer_number} from ${transfer.source_branch_name} was approved.`,
      entityId: id,
    });
  });
  return getTransfer(auth, id);
}

/** Ships: stock leaves the source branch now (TRANSFER_OUT). */
async function shipTransfer(auth, actor, id, input, idempotencyKey) {
  const today = businessToday();
  const result = await runIdempotent(
    { userId: auth.userId, scope: `transfers.ship:${id}`, key: idempotencyKey, payload: input, successStatus: 200 },
    async (client) => {
      const transfer = await loadTransfer(auth, id, client, { forUpdate: true });
      if (transfer.status !== 'APPROVED') throw invalidState(transfer, 'shipped');
      assertSideAccess(auth, transfer.source_branch_id, 'source');
      await loadBranchForTransfer(client, transfer.source_branch_id);
      await loadBranchForTransfer(client, transfer.destination_branch_id);

      const items = await repo.listItems(id, client);
      const resolved = resolveStepQuantities(items, input.items, 'approved_quantity', 'Shipped');
      for (const { item, quantity } of resolved) {
        if (quantity > 0 && item.expiry_date < today) {
          throw AppError.conflict('BATCH_EXPIRED', `Batch ${item.batch_number} has expired and cannot be shipped.`, { batchId: item.batch_id });
        }
      }

      // Lock source rows in a stable order before moving stock.
      const ordered = [...resolved].sort((a, b) => (a.item.batch_id < b.item.batch_id ? -1 : 1));
      for (const { item, quantity } of ordered) {
        await repo.setItemQuantity(client, item.id, 'shipped_quantity', quantity);
        if (quantity === 0) continue;
        try {
          await ledger.applyMovement(client, {
            branchId: transfer.source_branch_id,
            batchId: item.batch_id,
            change: -quantity,
            movementType: 'TRANSFER_OUT',
            referenceType: 'TRANSFER',
            referenceId: id,
            reason: `Shipped on ${transfer.transfer_number} to ${transfer.destination_branch_name}`,
            userId: auth.userId,
          });
        } catch (err) {
          if (err.code === 'INSUFFICIENT_STOCK') {
            throw AppError.conflict('TRANSFER_INSUFFICIENT_STOCK', `Not enough stock of batch ${item.batch_number} to ship.`, {
              ...err.details,
              batchNumber: item.batch_number,
            });
          }
          throw err;
        }
      }
      await repo.setStatus(client, id, 'IN_TRANSIT', auth.userId);
      await recordAudit(client, actor, {
        action: 'TRANSFER_SHIPPED',
        entityType: 'TRANSFER',
        entityId: id,
        branchId: transfer.source_branch_id,
        description: `Transfer ${transfer.transfer_number} shipped`,
        previousValues: { status: 'APPROVED' },
        newValues: { status: 'IN_TRANSIT', shipped: resolved.map((r) => ({ batch: r.item.batch_number, quantity: r.quantity })) },
      });
      await notifyBranch(client, transfer.destination_branch_id, P.INVENTORY_TRANSFER_RECEIVE, auth, {
        type: 'TRANSFER_SHIPPED',
        title: 'Transfer shipped',
        message: `${transfer.transfer_number} from ${transfer.source_branch_name} is on its way.`,
        entityId: id,
      });
      return { id };
    },
  );
  return { ...result, body: await getTransfer(auth, id) };
}

/**
 * Receives: only the received quantity enters the destination
 * (TRANSFER_IN). Any shortfall is recorded as a discrepancy with a reason;
 * missing stock is never created.
 */
async function receiveTransfer(auth, actor, id, input, idempotencyKey) {
  const result = await runIdempotent(
    { userId: auth.userId, scope: `transfers.receive:${id}`, key: idempotencyKey, payload: input, successStatus: 200 },
    async (client) => {
      const transfer = await loadTransfer(auth, id, client, { forUpdate: true });
      if (transfer.status !== 'IN_TRANSIT') throw invalidState(transfer, 'received');
      assertSideAccess(auth, transfer.destination_branch_id, 'destination');
      const destination = await loadAccessibleBranch(auth, transfer.destination_branch_id, { requireActive: true, client });

      const items = await repo.listItems(id, client);
      const resolved = resolveStepQuantities(items, input.items, 'shipped_quantity', 'Received');
      const discrepancy = resolved.reduce((sum, r) => sum + (r.item.shipped_quantity - r.quantity), 0);
      if (discrepancy > 0 && !(input.discrepancyReason && input.discrepancyReason.trim())) {
        throw AppError.validation('Explain why fewer units arrived than were shipped.', {
          fields: { discrepancyReason: 'A reason is required when quantities differ.' },
          discrepancyQuantity: discrepancy,
        });
      }

      const ordered = [...resolved].sort((a, b) => (a.item.batch_id < b.item.batch_id ? -1 : 1));
      for (const { item, quantity } of ordered) {
        await repo.setItemQuantity(client, item.id, 'received_quantity', quantity);
        if (quantity === 0) continue;
        await ledger.ensureInventoryRow(client, {
          branchId: destination.id,
          batchId: item.batch_id,
          sellingPrice: await repo.findSellingPrice(client, transfer.source_branch_id, item.batch_id),
        });
        await ledger.applyMovement(client, {
          branchId: destination.id,
          batchId: item.batch_id,
          change: quantity,
          movementType: 'TRANSFER_IN',
          referenceType: 'TRANSFER',
          referenceId: id,
          reason: `Received on ${transfer.transfer_number} from ${transfer.source_branch_name}`,
          userId: auth.userId,
        });
      }

      const extra = discrepancy > 0
        ? {
            discrepancy_quantity: discrepancy,
            discrepancy_reason: input.discrepancyReason.trim(),
            discrepancy_recorded_by: auth.userId,
            discrepancy_recorded_at: new Date(),
          }
        : {};
      await repo.setStatus(client, id, 'RECEIVED', auth.userId, extra);

      await recordAudit(client, actor, {
        action: 'TRANSFER_RECEIVED',
        entityType: 'TRANSFER',
        entityId: id,
        branchId: destination.id,
        description: `Transfer ${transfer.transfer_number} received at ${destination.name}`,
        previousValues: { status: 'IN_TRANSIT' },
        newValues: { status: 'RECEIVED', received: resolved.map((r) => ({ batch: r.item.batch_number, quantity: r.quantity })) },
      });
      await notifyBranch(client, transfer.source_branch_id, P.INVENTORY_TRANSFER_VIEW, auth, {
        type: 'TRANSFER_RECEIVED',
        title: 'Transfer received',
        message: `${transfer.transfer_number} was received at ${destination.name}.`,
        entityId: id,
      });

      if (discrepancy > 0) {
        await recordAudit(client, actor, {
          action: 'TRANSFER_DISCREPANCY_RECORDED',
          entityType: 'TRANSFER',
          entityId: id,
          branchId: destination.id,
          description: `${discrepancy} unit(s) missing on ${transfer.transfer_number}`,
          newValues: { discrepancyQuantity: discrepancy, reason: input.discrepancyReason.trim() },
        });
        for (const branchId of [transfer.source_branch_id, destination.id]) {
          await notifyBranch(client, branchId, P.INVENTORY_TRANSFER_VIEW, auth, {
            type: 'TRANSFER_DISCREPANCY',
            title: 'Transfer discrepancy',
            message: `${discrepancy} unit(s) shipped on ${transfer.transfer_number} did not arrive: ${input.discrepancyReason.trim()}`,
            entityId: id,
          });
        }
      }
      return { id };
    },
  );
  return { ...result, body: await getTransfer(auth, id) };
}

async function cancelTransfer(auth, actor, id, reason) {
  await withTransaction(async (client) => {
    const transfer = await loadTransfer(auth, id, client, { forUpdate: true });
    if (!['DRAFT', 'REQUESTED', 'APPROVED'].includes(transfer.status)) throw invalidState(transfer, 'cancelled');
    await repo.setStatus(client, id, 'CANCELLED', auth.userId, { cancel_reason: reason });
    await recordAudit(client, actor, {
      action: 'TRANSFER_CANCELLED',
      entityType: 'TRANSFER',
      entityId: id,
      branchId: transfer.source_branch_id,
      description: `Transfer ${transfer.transfer_number} cancelled`,
      previousValues: { status: transfer.status },
      newValues: { status: 'CANCELLED', reason },
    });
  });
  return getTransfer(auth, id);
}

module.exports = {
  listTransfers,
  getTransfer,
  createTransfer,
  requestTransfer,
  approveTransfer,
  shipTransfer,
  receiveTransfer,
  cancelTransfer,
};
