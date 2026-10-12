import { useState } from 'react';
import { api, newIdempotencyKey } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useAction } from '../../hooks/useAction.js';
import { useSuppliers, toOptions } from '../../hooks/useLookups.js';
import { Modal, Button, TextInput, SelectInput, TextArea, InlineAlert } from '../ui/index.js';
import { todayIso } from '../../utils/format.js';

const empty = {
  batchNumber: '', manufacturingDate: '', expiryDate: '', purchasePrice: '', sellingPrice: '', quantity: '', supplierId: '', notes: '',
};

/** Fields for one batch; also used by the medicine wizard. */
export function BatchFields({ form, setForm, errors, branchOptions, showBranch }) {
  const suppliers = useSuppliers();
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  return (
    <div className="form-grid">
      {showBranch && (
        <SelectInput label="Branch" required value={form.branchId || ''} onChange={set('branchId')} options={branchOptions} placeholder="Select branch" error={errors.branchId} />
      )}
      <TextInput label="Batch number" required value={form.batchNumber} onChange={set('batchNumber')} error={errors.batchNumber} />
      <TextInput label="Quantity (units)" required type="number" min="1" step="1" value={form.quantity} onChange={set('quantity')} error={errors.quantity} />
      <TextInput label="Manufacturing date" type="date" max={todayIso()} value={form.manufacturingDate} onChange={set('manufacturingDate')} error={errors.manufacturingDate} />
      <TextInput label="Expiry date" required type="date" min={todayIso()} value={form.expiryDate} onChange={set('expiryDate')} error={errors.expiryDate} />
      <TextInput label="Purchase price (per unit)" required inputMode="decimal" value={form.purchasePrice} onChange={set('purchasePrice')} error={errors.purchasePrice} hint="Historical cost; cannot be changed later." />
      <TextInput label="Selling price (per unit)" required inputMode="decimal" value={form.sellingPrice} onChange={set('sellingPrice')} error={errors.sellingPrice} />
      <SelectInput label="Supplier" value={form.supplierId} onChange={set('supplierId')} options={toOptions(suppliers.data, 'companyName')} placeholder="Not specified" error={errors.supplierId} />
      <TextArea label="Notes" fieldClassName="span-2" rows={2} value={form.notes} onChange={set('notes')} />
    </div>
  );
}

export function batchPayload(form, medicineId) {
  return {
    branchId: form.branchId,
    medicineId,
    batchNumber: form.batchNumber.trim(),
    manufacturingDate: form.manufacturingDate || null,
    expiryDate: form.expiryDate,
    purchasePrice: form.purchasePrice,
    sellingPrice: form.sellingPrice,
    quantity: Number(form.quantity),
    supplierId: form.supplierId || null,
    notes: form.notes || undefined,
  };
}

export function AddStockModal({ open, onClose, medicine, onSaved }) {
  const { activeBranches, branchParam } = useAuth();
  const [form, setForm] = useState({ ...empty, branchId: branchParam || (activeBranches[0] && activeBranches[0].id) || '' });
  const [key] = useState(() => newIdempotencyKey('stock'));
  const action = useAction();

  const save = async () => {
    const result = await action.run(
      () => api.post('/inventory/stock', batchPayload(form, medicine.id), { idempotencyKey: key }),
      { success: 'Stock added.' },
    );
    if (result) {
      onSaved(result.data);
      onClose();
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Add stock — ${medicine.name}`} size="lg" closeDisabled={action.running}
      footer={<><Button variant="secondary" onClick={onClose} disabled={action.running}>Cancel</Button><Button onClick={save} loading={action.running}>Add stock</Button></>}>
      <InlineAlert tone="info">Use Purchasing to receive supplier deliveries. Add stock directly only for opening stock or stock that did not come through a purchase.</InlineAlert>
      <BatchFields form={form} setForm={setForm} errors={action.fieldErrors} showBranch branchOptions={activeBranches.map((b) => ({ value: b.id, label: b.name }))} />
      {action.error && ['BATCH_COST_CONFLICT', 'BATCH_DATA_CONFLICT'].includes(action.error.code) && (
        <InlineAlert tone="danger">{action.error.message} A batch keeps one purchase price and expiry date. Use a different batch number if this is a different lot.</InlineAlert>
      )}
    </Modal>
  );
}
