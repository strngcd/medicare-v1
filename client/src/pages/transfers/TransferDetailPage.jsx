import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Send, CheckCircle2, Truck, PackageCheck, XCircle } from 'lucide-react';
import { api, newIdempotencyKey } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useAction } from '../../hooks/useAction.js';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  PageHeader, Panel, Button, StatusBadge, Steps, Details, DataTable, ErrorState, SkeletonRows, Modal, TextArea, InlineAlert, ConfirmDialog, LearnHow,
} from '../../components/ui/index.js';
import { formatDate, formatDateTime } from '../../utils/format.js';
import { ProductName } from '../../components/ProductName.jsx';

const STEPS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'REQUESTED', label: 'Requested' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'IN_TRANSIT', label: 'In transit' },
  { value: 'RECEIVED', label: 'Received' },
];

const STAGE = {
  approve: { title: 'Approve transfer', previous: 'requestedQuantity', label: 'Approve', path: 'approve', icon: CheckCircle2, done: 'Transfer approved.' },
  ship: { title: 'Ship transfer', previous: 'approvedQuantity', label: 'Ship', path: 'ship', icon: Truck, idempotent: true, done: 'Transfer shipped.' },
  receive: { title: 'Receive transfer', previous: 'shippedQuantity', label: 'Receive', path: 'receive', icon: PackageCheck, idempotent: true, done: 'Transfer received.' },
};

/** Per-item quantities for approve / ship / receive (defaults to the previous step). */
function StepModal({ transfer, stage, onClose, onDone }) {
  const config = STAGE[stage];
  const [quantities, setQuantities] = useState(() => Object.fromEntries(transfer.items.map((i) => [i.id, String(i[config.previous])])));
  const [reason, setReason] = useState('');
  const [key] = useState(() => newIdempotencyKey(stage));
  const action = useAction();
  const shortfall = stage === 'receive' ? transfer.items.reduce((s, i) => s + (i.shippedQuantity - (Number(quantities[i.id]) || 0)), 0) : 0;

  const submit = async () => {
    const body = { items: transfer.items.map((i) => ({ transferItemId: i.id, quantity: Number(quantities[i.id]) || 0 })) };
    if (stage === 'receive' && shortfall > 0) body.discrepancyReason = reason;
    const result = await action.run(
      () => api.post(`/transfers/${transfer.id}/${config.path}`, body, config.idempotent ? { idempotencyKey: key } : undefined),
      { success: config.done },
    );
    if (result) onDone();
  };

  return (
    <Modal open size="lg" title={config.title} onClose={onClose} closeDisabled={action.running}
      footer={<><Button variant="secondary" onClick={onClose} disabled={action.running}>Cancel</Button><Button icon={config.icon} onClick={submit} loading={action.running}>{config.label}</Button></>}>
      {stage === 'ship' && <InlineAlert tone="info">Shipping removes the stock from {transfer.sourceBranchName} now.</InlineAlert>}
      {stage === 'receive' && <InlineAlert tone="info">Only the quantity you receive enters {transfer.destinationBranchName}. Missing units are recorded as a discrepancy.</InlineAlert>}
      <table className="table responsive">
        <thead><tr><th>Product</th><th>Batch</th><th className="num">Requested</th><th className="num">Approved</th><th className="num">Shipped</th><th className="num">{config.label}</th></tr></thead>
        <tbody>
          {transfer.items.map((i) => (
            <tr key={i.id}>
              <td data-label="Product"><ProductName row={i} /></td>
              <td data-label="Batch" className="mono">{i.batchNumber}</td>
              <td data-label="Requested" className="num">{i.requestedQuantity}</td>
              <td data-label="Approved" className="num">{i.approvedQuantity ?? '—'}</td>
              <td data-label="Shipped" className="num">{i.shippedQuantity ?? '—'}</td>
              <td data-label={config.label} className="num">
                <input className="input" style={{ width: 90 }} type="number" min="0" max={i[config.previous]} value={quantities[i.id]}
                  onChange={(e) => setQuantities({ ...quantities, [i.id]: e.target.value })} aria-label={`${config.label} quantity for ${i.medicineName}`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {stage === 'receive' && shortfall > 0 && (
        <TextArea label={`Reason for the ${shortfall}-unit discrepancy`} required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} error={action.fieldErrors.discrepancyReason} />
      )}
      {action.error && ['TRANSFER_INSUFFICIENT_STOCK', 'BATCH_EXPIRED', 'BRANCH_ACCESS_DENIED'].includes(action.error.code) && <InlineAlert tone="danger">{action.error.message}</InlineAlert>}
    </Modal>
  );
}

export default function TransferDetailPage() {
  const { id } = useParams();
  const { can, canAny } = useAuth();
  const [modal, setModal] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const action = useAction();
  const transfer = useApi(() => api.get(`/transfers/${id}`).then((r) => r.data), [id]);

  if (transfer.error) return <Panel><ErrorState error={transfer.error} onRetry={transfer.reload} /></Panel>;
  if (!transfer.data) return <Panel><SkeletonRows rows={8} /></Panel>;
  const t = transfer.data;
  const refresh = () => { setModal(null); transfer.reload({ silent: true }); };

  const request = async () => {
    const result = await action.run(() => api.post(`/transfers/${id}/request`), { success: 'Transfer requested.' });
    if (result) refresh();
  };
  const cancel = async () => {
    const result = await action.run(() => api.post(`/transfers/${id}/cancel`, { reason: cancelReason }), { success: 'Transfer cancelled.' });
    if (result) refresh();
  };

  return (
    <div className="stack">
      <PageHeader
        breadcrumbs={[{ label: 'Transfers', to: '/transfers' }, { label: t.transferNumber }]}
        title={<span className="row-wrap"><span className="mono" style={{ fontSize: 19 }}>{t.transferNumber}</span> <StatusBadge status={t.status} /></span>}
        description={`${t.sourceBranchName} → ${t.destinationBranchName}`}
        actions={(
          <>
            {t.status === 'DRAFT' && can('INVENTORY_TRANSFER_CREATE') && <Button icon={Send} onClick={request} loading={action.running}>Request</Button>}
            {t.status === 'REQUESTED' && can('INVENTORY_TRANSFER_APPROVE') && <Button icon={CheckCircle2} onClick={() => setModal('approve')}>Approve</Button>}
            {t.status === 'APPROVED' && can('INVENTORY_TRANSFER_SHIP') && <Button icon={Truck} onClick={() => setModal('ship')}>Ship</Button>}
            {t.status === 'IN_TRANSIT' && can('INVENTORY_TRANSFER_RECEIVE') && <Button icon={PackageCheck} onClick={() => setModal('receive')}>Receive</Button>}
            {['DRAFT', 'REQUESTED', 'APPROVED'].includes(t.status) && canAny('INVENTORY_TRANSFER_CREATE', 'INVENTORY_TRANSFER_APPROVE') && (
              <Button variant="ghost" icon={XCircle} onClick={() => setModal('cancel')}>Cancel</Button>
            )}
            <LearnHow slug="branch-transfers" />
          </>
        )}
      />
      {t.status !== 'CANCELLED' ? <Steps steps={STEPS} current={t.status === 'RECEIVED' ? 'RECEIVED' : t.status} /> : (
        <InlineAlert tone="warning">Cancelled {formatDateTime(t.cancelledAt)}{t.cancelReason ? `: ${t.cancelReason}` : ''}.</InlineAlert>
      )}
      {t.discrepancyQuantity && (
        <InlineAlert tone="danger">{t.discrepancyQuantity} unit(s) shipped did not arrive. Reason: {t.discrepancyReason}</InlineAlert>
      )}
      <Panel title="Progress">
        <Details items={[
          { label: 'Created', value: `${formatDateTime(t.createdAt)} by ${t.createdByName}` },
          { label: 'Requested', value: t.requestedAt ? formatDateTime(t.requestedAt) : null },
          { label: 'Approved', value: t.approvedAt ? `${formatDateTime(t.approvedAt)} by ${t.approvedByName}` : null },
          { label: 'Shipped', value: t.shippedAt ? `${formatDateTime(t.shippedAt)} by ${t.shippedByName}` : null },
          { label: 'Received', value: t.receivedAt ? `${formatDateTime(t.receivedAt)} by ${t.receivedByName}` : null },
          { label: 'Notes', value: t.notes },
        ]} />
      </Panel>
      <Panel title="Batches" flush>
        <DataTable rows={t.items} columns={[
          { key: 'medicineName', label: 'Product', render: (i) => <ProductName row={i} /> },
          { key: 'batchNumber', label: 'Batch', render: (i) => <span className="mono">{i.batchNumber}</span> },
          { key: 'expiryDate', label: 'Expiry', render: (i) => formatDate(i.expiryDate) },
          { key: 'requestedQuantity', label: 'Requested', align: 'right' },
          { key: 'approvedQuantity', label: 'Approved', align: 'right', render: (i) => i.approvedQuantity ?? '—' },
          { key: 'shippedQuantity', label: 'Shipped', align: 'right', render: (i) => i.shippedQuantity ?? '—' },
          { key: 'receivedQuantity', label: 'Received', align: 'right', render: (i) => i.receivedQuantity ?? '—' },
          { key: 'discrepancyQuantity', label: 'Discrepancy', align: 'right', render: (i) => (i.discrepancyQuantity ? <span className="danger-text">{i.discrepancyQuantity}</span> : '—') },
        ]} />
      </Panel>
      {modal && STAGE[modal] && <StepModal transfer={t} stage={modal} onClose={() => setModal(null)} onDone={refresh} />}
      <ConfirmDialog open={modal === 'cancel'} title="Cancel transfer" tone="danger" confirmLabel="Cancel transfer" loading={action.running} onClose={() => setModal(null)} onConfirm={cancel}>
        <p>Transfers can be cancelled until they are shipped.</p>
        <TextArea label="Reason" required rows={2} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} error={action.fieldErrors.reason} />
      </ConfirmDialog>
    </div>
  );
}
