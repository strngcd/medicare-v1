import { useState } from 'react';
import { api } from '../../api/client.js';
import { useAction } from '../../hooks/useAction.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Modal, Button, TextInput, TextArea } from '../../components/ui/index.js';

export function SupplierModal({ supplier, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    companyName: supplier ? supplier.companyName : '',
    phone: supplier ? supplier.phone : '',
    contactPerson: supplier ? supplier.contactPerson || '' : '',
    email: supplier ? supplier.email || '' : '',
    address: supplier ? supplier.address || '' : '',
    notes: supplier ? supplier.notes || '' : '',
  });
  const action = useAction();
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const save = async () => {
    const call = supplier ? () => api.patch(`/suppliers/${supplier.id}`, form) : () => api.post('/suppliers', form);
    const result = await action.run(call, { success: supplier ? 'Supplier updated.' : 'Supplier created.' });
    if (result) {
      const similar = result.data.warnings.similarSuppliers;
      if (similar.length) toast.info(`Note: a supplier with a similar name already exists (${similar.map((s) => s.companyName).join(', ')}).`);
      onSaved(result.data.supplier);
    }
  };

  return (
    <Modal open title={supplier ? 'Edit supplier' : 'New supplier'} size="lg" onClose={onClose} closeDisabled={action.running}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={action.running}>Save</Button></>}>
      <div className="form-grid">
        <TextInput label="Company name" required value={form.companyName} onChange={set('companyName')} error={action.fieldErrors.companyName} fieldClassName="span-2" />
        <TextInput label="Phone" required value={form.phone} onChange={set('phone')} error={action.fieldErrors.phone} />
        <TextInput label="Contact person" value={form.contactPerson} onChange={set('contactPerson')} />
        <TextInput label="Email" type="email" value={form.email} onChange={set('email')} error={action.fieldErrors.email} />
        <TextInput label="Address" value={form.address} onChange={set('address')} />
        <TextArea label="Notes" rows={2} value={form.notes} onChange={set('notes')} fieldClassName="span-2" />
      </div>
    </Modal>
  );
}
