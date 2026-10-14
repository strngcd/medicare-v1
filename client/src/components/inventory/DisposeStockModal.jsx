import { useState } from 'react';
import { api, newIdempotencyKey } from '../../api/client.js';
import { useAction } from '../../hooks/useAction.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ConfirmDialog, TextArea, Checkbox, Details } from '../ui/index.js';
import { formatDate, formatMoney, formatNumber } from '../../utils/format.js';

/**
 * Writes off all remaining units of a batch row. Expired or expiring stock
 * needs no reason; in-date stock (damaged, recalled...) does.
 * `item` needs inventoryId (or id), medicineName, batchNumber, expiryDate and
 * quantity; purchasePrice is optional and only used for the loss estimate.
 */
export function DisposeStockModal({ item, onClose, onDone }) {
  const { can } = useAuth();
  const action = useAction();
  const [notes, setNotes] = useState('');
  const [archive, setArchive] = useState(can('INVENTORY_BATCH_ARCHIVE'));
  const [recordAsLoss, setRecordAsLoss] = useState(true);
  const [key] = useState(() => newIdempotencyKey('dispose'));
  const inventoryId = item.inventoryId || item.id;
  const estimate = item.purchasePrice !== undefined ? Number(item.purchasePrice) * item.quantity : null;
  // Inventory rows carry `status`; alerts carry `type`.
  const inDate = !['EXPIRED', 'EXPIRING_SOON'].includes(item.status || item.type);
  const [reasonMissing, setReasonMissing] = useState(false);

  const confirm = async () => {
    if (inDate && !notes.trim()) {
      setReasonMissing(true);
      return;
    }
    const result = await action.run(
      () => api.post(`/inventory/${inventoryId}/dispose`, { notes: notes.trim() || undefined, archive, recordAsLoss }, { idempotencyKey: key }),
      { success: recordAsLoss ? 'Stock disposed and recorded as a loss.' : 'Stock disposed (not recorded as a loss).' },
    );
    if (result) onDone();
  };

  return (
    <ConfirmDialog open title="Dispose of stock" tone="danger" confirmLabel={`Dispose of ${formatNumber(item.quantity)} units`}
      loading={action.running} onClose={onClose} onConfirm={confirm}>
      <p>All remaining units leave inventory{recordAsLoss ? ' and are recorded as a stock loss at their purchase cost' : ''}. The batch stays in history{inDate ? '' : ' and its alert clears'}.</p>
      <Details items={[
        { label: 'Product', value: item.medicineName },
        { label: 'Batch', value: item.batchNumber },
        { label: 'Expiry', value: formatDate(item.expiryDate) },
        { label: 'Units', value: formatNumber(item.quantity) },
        estimate !== null && { label: recordAsLoss ? 'Loss (cost)' : 'Cost (not a loss)', value: formatMoney(estimate) },
      ].filter(Boolean)} />
      {inDate && <p className="warning-text small">This batch has not expired. All of its remaining stock will be removed.</p>}
      <TextArea label={inDate ? 'Reason' : 'Note'} required={inDate}
        placeholder={inDate ? 'e.g. Damaged in storage, recalled by supplier' : 'e.g. Handed to the disposal contractor'}
        value={notes} onChange={(e) => { setNotes(e.target.value); setReasonMissing(false); }}
        error={action.fieldErrors.notes || (reasonMissing ? 'Say why this in-date stock is being disposed of.' : undefined)} />
      <Checkbox label="Record as a loss (counts in the stock loss and profit reports)" checked={recordAsLoss} onChange={(e) => setRecordAsLoss(e.target.checked)} />
      {can('INVENTORY_BATCH_ARCHIVE') && (
        <Checkbox label="Archive the batch afterwards (hides it from stock lists)" checked={archive} onChange={(e) => setArchive(e.target.checked)} />
      )}
    </ConfirmDialog>
  );
}
