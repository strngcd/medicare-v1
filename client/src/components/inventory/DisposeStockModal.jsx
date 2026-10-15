import { useState } from 'react';
import { api, newIdempotencyKey } from '../../api/client.js';
import { useAction } from '../../hooks/useAction.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ConfirmDialog, TextArea, TextInput, Checkbox, Details } from '../ui/index.js';
import { formatDate, formatMoney, formatNumber } from '../../utils/format.js';
import { productLabel } from '../ProductName.jsx';

/**
 * Writes off units of a batch row: all of them by default, or fewer if the
 * user changes the amount. Expired or expiring stock needs no reason;
 * in-date stock (damaged, recalled...) does.
 * `item` needs inventoryId (or id), medicineName, batchNumber, expiryDate and
 * quantity; purchasePrice is optional and only used for the loss estimate.
 */
export function DisposeStockModal({ item, onClose, onDone }) {
  const { can } = useAuth();
  const action = useAction();
  const [units, setUnits] = useState(String(item.quantity));
  const [notes, setNotes] = useState('');
  const [archive, setArchive] = useState(can('INVENTORY_BATCH_ARCHIVE'));
  const [recordAsLoss, setRecordAsLoss] = useState(true);
  const [key] = useState(() => newIdempotencyKey('dispose'));
  const [reasonMissing, setReasonMissing] = useState(false);
  const inventoryId = item.inventoryId || item.id;
  // Inventory rows carry `status`; alerts carry `type`.
  const inDate = !['EXPIRED', 'EXPIRING_SOON'].includes(item.status || item.type);

  const quantity = Number(units);
  const validQuantity = Number.isInteger(quantity) && quantity >= 1 && quantity <= item.quantity;
  const all = validQuantity && quantity === item.quantity;
  const estimate = item.purchasePrice !== undefined && validQuantity ? Number(item.purchasePrice) * quantity : null;
  const unitsError = units !== '' && !validQuantity ? `Enter 1 to ${formatNumber(item.quantity)}.` : undefined;

  const confirm = async () => {
    if (!validQuantity) return; // the Units field already shows why
    if (inDate && !notes.trim()) {
      setReasonMissing(true);
      return;
    }
    const result = await action.run(
      () => api.post(`/inventory/${inventoryId}/dispose`, {
        quantity, notes: notes.trim() || undefined, archive: all && archive, recordAsLoss,
      }, { idempotencyKey: key }),
      { success: recordAsLoss ? 'Stock disposed and recorded as a loss.' : 'Stock disposed (not recorded as a loss).' },
    );
    if (result) onDone();
  };

  return (
    <ConfirmDialog open title="Dispose of stock" tone="danger"
      confirmLabel={validQuantity ? `Dispose of ${formatNumber(quantity)} unit${quantity === 1 ? '' : 's'}` : 'Dispose'}
      loading={action.running} onClose={onClose} onConfirm={confirm}>
      <p>
        The units leave inventory{recordAsLoss ? ' and are recorded as a stock loss at their purchase cost' : ''}.
        The batch stays in history{!inDate && all ? ' and its alert clears' : ''}.
      </p>
      <Details items={[
        { label: 'Product', value: productLabel(item) },
        { label: 'Batch', value: item.batchNumber },
        { label: 'Expiry', value: formatDate(item.expiryDate) },
        { label: 'In stock', value: formatNumber(item.quantity) },
        estimate !== null && { label: recordAsLoss ? 'Loss (cost)' : 'Cost (not a loss)', value: formatMoney(estimate) },
      ].filter(Boolean)} />
      <TextInput label="Units to dispose of" required type="number" min="1" max={item.quantity} step="1" inputMode="numeric"
        value={units} onChange={(e) => setUnits(e.target.value)} onFocus={(e) => e.target.select()}
        error={action.fieldErrors.quantity || unitsError || (units === '' ? 'Enter how many units.' : undefined)}
        hint={validQuantity && !all ? `${formatNumber(item.quantity - quantity)} unit(s) will stay in stock.` : 'All remaining units.'} />
      {inDate && <p className="warning-text small">This batch has not expired.</p>}
      <TextArea label={inDate ? 'Reason' : 'Note'} required={inDate}
        placeholder={inDate ? 'e.g. Damaged in storage, recalled by supplier' : 'e.g. Handed to the disposal contractor'}
        value={notes} onChange={(e) => { setNotes(e.target.value); setReasonMissing(false); }}
        error={action.fieldErrors.notes || (reasonMissing ? 'Say why this in-date stock is being disposed of.' : undefined)} />
      <Checkbox label="Record as a loss (counts in the stock loss and profit reports)" checked={recordAsLoss} onChange={(e) => setRecordAsLoss(e.target.checked)} />
      {can('INVENTORY_BATCH_ARCHIVE') && all && (
        <Checkbox label="Archive the batch afterwards (hides it from stock lists)" checked={archive} onChange={(e) => setArchive(e.target.checked)} />
      )}
    </ConfirmDialog>
  );
}
