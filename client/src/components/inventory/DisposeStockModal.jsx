import { useState } from 'react';
import { api, newIdempotencyKey } from '../../api/client.js';
import { useAction } from '../../hooks/useAction.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ConfirmDialog, TextArea, Checkbox, Details } from '../ui/index.js';
import { formatDate, formatMoney, formatNumber } from '../../utils/format.js';

/**
 * Writes off all remaining units of an expired or expiring batch row.
 * `item` needs inventoryId (or id), medicineName, batchNumber, expiryDate and
 * quantity; purchasePrice is optional and only used for the loss estimate.
 */
export function DisposeStockModal({ item, onClose, onDone }) {
  const { can } = useAuth();
  const action = useAction();
  const [notes, setNotes] = useState('');
  const [archive, setArchive] = useState(can('INVENTORY_BATCH_ARCHIVE'));
  const [key] = useState(() => newIdempotencyKey('dispose'));
  const inventoryId = item.inventoryId || item.id;
  const estimate = item.purchasePrice !== undefined ? Number(item.purchasePrice) * item.quantity : null;

  const confirm = async () => {
    const result = await action.run(
      () => api.post(`/inventory/${inventoryId}/dispose`, { notes: notes.trim() || undefined, archive }, { idempotencyKey: key }),
      { success: 'Stock disposed and recorded as a loss.' },
    );
    if (result) onDone();
  };

  return (
    <ConfirmDialog open title="Dispose of stock" tone="danger" confirmLabel={`Dispose of ${formatNumber(item.quantity)} units`}
      loading={action.running} onClose={onClose} onConfirm={confirm}>
      <p>All remaining units leave inventory and are recorded as a stock loss at their purchase cost. The batch stays in history and its alert clears.</p>
      <Details items={[
        { label: 'Medicine', value: item.medicineName },
        { label: 'Batch', value: item.batchNumber },
        { label: 'Expiry', value: formatDate(item.expiryDate) },
        { label: 'Units', value: formatNumber(item.quantity) },
        estimate !== null && { label: 'Loss (cost)', value: formatMoney(estimate) },
      ].filter(Boolean)} />
      <TextArea label="Note" placeholder="e.g. Handed to the disposal contractor" value={notes} onChange={(e) => setNotes(e.target.value)} error={action.fieldErrors.notes} />
      {can('INVENTORY_BATCH_ARCHIVE') && (
        <Checkbox label="Archive the batch afterwards (hides it from stock lists)" checked={archive} onChange={(e) => setArchive(e.target.checked)} />
      )}
    </ConfirmDialog>
  );
}
