import { useEffect, useState } from 'react';
import { api, newIdempotencyKey } from '../../api/client.js';
import { useAction } from '../../hooks/useAction.js';
import { Modal, Button, TextInput, SelectInput, TextArea, InlineAlert, Details, LearnHow } from '../ui/index.js';
import { formatNumber, humanize } from '../../utils/format.js';

const REASONS = [
  { value: 'DAMAGED', label: 'Damaged', direction: -1 },
  { value: 'EXPIRED', label: 'Expired', direction: -1 },
  { value: 'LOST', label: 'Lost', direction: -1 },
  { value: 'FOUND', label: 'Found', direction: 1 },
  { value: 'CORRECTION', label: 'Correction (count)', direction: 0 },
  { value: 'OTHER', label: 'Other', direction: 0 },
];

/**
 * Adjustment workflow: current quantity -> change and reason -> server
 * preview -> confirmation -> transaction (guarded against stale previews).
 */
export function AdjustStockModal({ open, onClose, inventory, onSaved }) {
  const [form, setForm] = useState({ reason: 'DAMAGED', quantity: '', increase: false, notes: '' });
  const [preview, setPreview] = useState(null);
  const [key, setKey] = useState(() => newIdempotencyKey('adjust'));
  const action = useAction();
  const reason = REASONS.find((r) => r.value === form.reason);
  const direction = reason.direction !== 0 ? reason.direction : form.increase ? 1 : -1;
  const change = Number(form.quantity) > 0 ? direction * Math.trunc(Number(form.quantity)) : 0;

  useEffect(() => {
    setPreview(null);
  }, [form.reason, form.quantity, form.increase, form.notes]);

  const body = { inventoryId: inventory.id, reason: form.reason, quantityChange: change, notes: form.notes || undefined };

  const review = async () => {
    const result = await action.run(() => api.post('/inventory/adjustments/preview', body));
    if (result) setPreview(result.data);
  };

  const confirm = async () => {
    const result = await action.run(
      () => api.post('/inventory/adjustments', { ...body, expectedQuantityBefore: preview.quantityBefore }, { idempotencyKey: key }),
      { success: (r) => `Adjustment ${r.data.adjustmentNumber} recorded.` },
    );
    if (result) {
      onSaved(result.data);
      onClose();
    } else {
      setPreview(null);
      setKey(newIdempotencyKey('adjust'));
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Adjust stock" closeDisabled={action.running}
      footer={(
        <>
          <Button variant="secondary" onClick={preview ? () => setPreview(null) : onClose} disabled={action.running}>{preview ? 'Back' : 'Cancel'}</Button>
          {preview ? (
            <Button onClick={confirm} loading={action.running} disabled={!preview.valid}>Confirm adjustment</Button>
          ) : (
            <Button onClick={review} loading={action.running} disabled={change === 0}>Review</Button>
          )}
        </>
      )}>
      <Details items={[
        { label: 'Medicine', value: inventory.medicineName },
        { label: 'Batch', value: inventory.batchNumber },
        { label: 'Branch', value: inventory.branchName },
        { label: 'Current quantity', value: formatNumber(inventory.quantity) },
      ]} />
      {!preview ? (
        <div className="form-grid">
          <SelectInput label="Reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} options={REASONS} />
          <TextInput label="Quantity" type="number" min="1" step="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} error={action.fieldErrors.quantityChange} />
          {reason.direction === 0 && (
            <SelectInput label="Direction" fieldClassName="span-2" value={form.increase ? 'in' : 'out'} onChange={(e) => setForm({ ...form, increase: e.target.value === 'in' })}
              options={[{ value: 'out', label: 'Decrease stock' }, { value: 'in', label: 'Increase stock' }]} />
          )}
          <TextArea label={form.reason === 'OTHER' ? 'Note (required)' : 'Note'} fieldClassName="span-2" rows={2} value={form.notes} error={action.fieldErrors.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
      ) : (
        <div className="stack-sm">
          <Details items={[
            { label: 'Reason', value: humanize(preview.reason) },
            { label: 'Before', value: formatNumber(preview.quantityBefore) },
            { label: 'Change', value: `${preview.quantityChange > 0 ? '+' : ''}${preview.quantityChange}` },
            { label: 'After', value: formatNumber(preview.quantityAfter) },
          ]} />
          {preview.valid ? (
            <InlineAlert tone="warning">Adjustments cannot be edited or deleted. Confirm only if the numbers are correct.</InlineAlert>
          ) : (
            <InlineAlert tone="danger">{Object.values(preview.errors).join(' ')}</InlineAlert>
          )}
        </div>
      )}
      <LearnHow slug="inventory-adjustments" />
    </Modal>
  );
}
