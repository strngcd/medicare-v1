import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { api } from '../api/client.js';
import { useAction } from '../hooks/useAction.js';
import { Button, ConfirmDialog } from './ui/index.js';

/**
 * Delete for a branch, staff member or supplier that has no activity yet.
 * The server re-checks and refuses once anything refers to the record.
 */
export function DeleteRecordButton({ path, name, what, listPath, onDeleted }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const action = useAction();
  const confirm = async () => {
    const result = await action.run(() => api.delete(path), { success: `${name} deleted.` });
    setOpen(false);
    if (!result) return;
    if (onDeleted) await onDeleted();
    navigate(listPath, { replace: true });
  };
  return (
    <>
      <Button variant="ghost" icon={Trash2} onClick={() => setOpen(true)}>Delete</Button>
      <ConfirmDialog open={open} title={`Delete ${what}`} tone="danger" confirmLabel="Delete" loading={action.running}
        onClose={() => setOpen(false)} onConfirm={confirm}>
        <p>Delete <strong>{name}</strong>? It has no activity yet, so it can be removed. It disappears from every list and cannot be brought back.</p>
      </ConfirmDialog>
    </>
  );
}
