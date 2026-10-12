import { useState } from 'react';
import { api } from '../../api/client.js';
import { useAction } from '../../hooks/useAction.js';
import { Modal, Button, TextInput, SelectInput } from '../../components/ui/index.js';

export function BranchModal({ branch, staff = [], onClose, onSaved }) {
  const [form, setForm] = useState({
    name: branch ? branch.name : '',
    code: branch ? branch.code : '',
    phone: branch ? branch.phone || '' : '',
    email: branch ? branch.email || '' : '',
    address: branch ? branch.address || '' : '',
    city: branch ? branch.city || '' : '',
    country: branch ? branch.country : 'Ethiopia',
    managerUserId: branch ? branch.managerUserId || '' : '',
  });
  const action = useAction();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    const payload = { ...form, managerUserId: form.managerUserId || null };
    if (branch) delete payload.code;
    if (!branch) delete payload.managerUserId;
    const call = branch ? () => api.patch(`/branches/${branch.id}`, payload) : () => api.post('/branches', payload);
    const result = await action.run(call, { success: branch ? 'Branch updated.' : 'Branch created.' });
    if (result) onSaved(result.data);
  };

  return (
    <Modal open size="lg" title={branch ? 'Edit branch' : 'New branch'} onClose={onClose} closeDisabled={action.running}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={action.running}>Save</Button></>}>
      <div className="form-grid">
        <TextInput label="Name" required value={form.name} onChange={set('name')} error={action.fieldErrors.name} />
        <TextInput label="Code" required value={form.code} onChange={set('code')} disabled={Boolean(branch)}
          error={action.fieldErrors.code || (action.error && action.error.code === 'DUPLICATE_BRANCH_CODE' ? action.error.message : undefined)}
          hint={branch ? 'The branch code cannot be changed.' : 'Short identifier, e.g. BOLE. It cannot be changed later.'} />
        <TextInput label="Phone" value={form.phone} onChange={set('phone')} />
        <TextInput label="Email" type="email" value={form.email} onChange={set('email')} error={action.fieldErrors.email} />
        <TextInput label="Address" value={form.address} onChange={set('address')} />
        <TextInput label="City" value={form.city} onChange={set('city')} />
        <TextInput label="Country" value={form.country} onChange={set('country')} />
        {branch && (
          <SelectInput label="Branch manager" value={form.managerUserId} placeholder="No manager" onChange={set('managerUserId')}
            options={staff.filter((u) => u.status === 'ACTIVE').map((u) => ({ value: u.id, label: `${u.fullName} (${u.roleName})` }))}
            error={action.fieldErrors.managerUserId} hint="A label only; it does not grant extra permissions." />
        )}
      </div>
    </Modal>
  );
}
