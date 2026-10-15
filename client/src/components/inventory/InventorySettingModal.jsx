import { useState } from 'react';
import { api } from '../../api/client.js';
import { useAction } from '../../hooks/useAction.js';
import { Modal, Button, TextInput, InlineAlert } from '../ui/index.js';
import { productLabel } from '../ProductName.jsx';

/** Edits minimum stock or selling price of one branch inventory record. */
export function InventorySettingModal({ open, onClose, inventory, field, onSaved }) {
  const isPrice = field === 'sellingPrice';
  const [value, setValue] = useState(String(isPrice ? inventory.sellingPrice : inventory.minimumStock));
  const action = useAction();

  const save = async () => {
    const path = isPrice ? 'selling-price' : 'minimum-stock';
    const result = await action.run(
      () => api.patch(`/inventory/${inventory.id}/${path}`, { [field]: isPrice ? value : Number(value) }),
      { success: isPrice ? 'Selling price updated.' : 'Minimum stock updated.' },
    );
    if (result) {
      onSaved(result.data);
      onClose();
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={isPrice ? 'Change selling price' : 'Change minimum stock'} closeDisabled={action.running}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={action.running}>Save</Button></>}>
      <p className="muted">{productLabel(inventory)} · batch {inventory.batchNumber || '—'} · {inventory.branchName}</p>
      <TextInput label={isPrice ? 'Selling price (per unit)' : 'Minimum stock (units)'} inputMode={isPrice ? 'decimal' : 'numeric'}
        value={value} onChange={(e) => setValue(e.target.value)} error={action.fieldErrors[field]} autoFocus />
      <InlineAlert tone="info">
        {isPrice ? 'New sales from this batch at this branch use the new price. Past sales keep their recorded price.' : 'Applies to this branch only. Low-stock alerts compare sellable stock with this level.'}
      </InlineAlert>
    </Modal>
  );
}
