import { Printer } from 'lucide-react';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Modal, Button, ErrorState, SkeletonRows } from '../ui/index.js';
import { Receipt, printReceipt } from './Receipt.jsx';

export function ReceiptModal({ saleId, onClose, extraActions }) {
  const { can } = useAuth();
  const receipt = useApi(() => api.get(`/sales/${saleId}/receipt`).then((r) => r.data), [saleId], { enabled: can('SALES_PRINT_RECEIPT') });
  return (
    <Modal open title="Receipt" onClose={onClose}
      footer={(
        <>
          {extraActions}
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {can('SALES_PRINT_RECEIPT') && <Button icon={Printer} onClick={printReceipt} disabled={!receipt.data}>Print</Button>}
        </>
      )}>
      {!can('SALES_PRINT_RECEIPT') && <p className="muted">You do not have permission to print receipts.</p>}
      {receipt.error && <ErrorState error={receipt.error} onRetry={receipt.reload} />}
      {can('SALES_PRINT_RECEIPT') && !receipt.data && !receipt.error && <SkeletonRows rows={6} columns={2} />}
      {receipt.data && <Receipt receipt={receipt.data} />}
    </Modal>
  );
}
