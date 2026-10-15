import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PackageCheck, Pencil, Send, XCircle, Wallet, Plus, Trash2 } from 'lucide-react';
import { api, newIdempotencyKey } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useAction } from '../../hooks/useAction.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Can } from '../../permissions/Can.jsx';
import {
  PageHeader, Panel, Button, StatusBadge, Details, DataTable, ErrorState, SkeletonRows, EmptyState, Modal,
  TextInput, TextArea, SelectInput, InlineAlert, IconButton, ConfirmDialog, Kpi, LearnHow,
} from '../../components/ui/index.js';
import { formatDate, formatDateTime, formatMoney, formatNumber, humanize, todayIso } from '../../utils/format.js';
import { suggestedSellingPrice } from '../../utils/money.js';
import { ProductName } from '../../components/ProductName.jsx';

function newLine(item, markupPercent) {
  return {
    key: Math.random().toString(36).slice(2),
    purchaseItemId: item.id,
    batchNumber: '',
    manufacturingDate: '',
    expiryDate: '',
    quantity: String(item.remainingQuantity),
    sellingPrice: suggestedSellingPrice(item.unitPurchasePrice, markupPercent),
  };
}

/** Receive one delivery: one or more batch lines per outstanding item. */
function ReceiveModal({ purchase, onClose, onDone }) {
  const { pharmacy } = useAuth();
  const markup = pharmacy && pharmacy.defaultMarkupPercent;
  const outstanding = purchase.items.filter((i) => i.remainingQuantity > 0);
  const [lines, setLines] = useState(() => outstanding.map((item) => newLine(item, markup)));
  const [notes, setNotes] = useState('');
  const [key] = useState(() => newIdempotencyKey('receive'));
  const action = useAction();
  const showCost = purchase.total !== undefined;

  const setLine = (k, field, value) => setLines((list) => list.map((l) => (l.key === k ? { ...l, [field]: value } : l)));
  const receiving = lines.filter((l) => Number(l.quantity) > 0);

  const submit = async () => {
    const result = await action.run(() => api.post(`/purchases/${purchase.id}/receive`, {
      notes: notes || undefined,
      items: receiving.map((l) => ({
        purchaseItemId: l.purchaseItemId,
        batchNumber: l.batchNumber.trim() || null,
        manufacturingDate: l.manufacturingDate || null,
        expiryDate: l.expiryDate || null,
        quantity: Number(l.quantity),
        sellingPrice: l.sellingPrice,
      })),
    }, { idempotencyKey: key }), { success: (r) => (r.data.status === 'RECEIVED' ? 'Purchase fully received.' : 'Delivery received.') });
    if (result) onDone();
  };

  const errorFor = (index, field) => {
    const receivingIndex = receiving.findIndex((l) => l.key === lines[index].key);
    return receivingIndex >= 0 ? action.fieldErrors[`items.${receivingIndex}.${field}`] : undefined;
  };

  return (
    <Modal open title={`Receive stock — ${purchase.purchaseNumber}`} size="xl" onClose={onClose} closeDisabled={action.running}
      footer={(
        <>
          <span className="grow small muted">{receiving.length} line(s), {formatNumber(receiving.reduce((s, l) => s + Number(l.quantity), 0))} units</span>
          <Button variant="secondary" onClick={onClose} disabled={action.running}>Cancel</Button>
          <Button icon={PackageCheck} onClick={submit} loading={action.running} disabled={receiving.length === 0}>Receive</Button>
        </>
      )}>
      <InlineAlert tone="info">Receiving adds stock to {purchase.branchName}. You can receive part of an order now and the rest later, and split one item across several batches. Set quantity to 0 to skip a line.</InlineAlert>
      {action.error && ['BATCH_COST_CONFLICT', 'BATCH_DATA_CONFLICT', 'OVER_RECEIVING', 'BATCH_EXPIRED'].includes(action.error.code) && (
        <InlineAlert tone="danger">{action.error.message}</InlineAlert>
      )}
      {outstanding.map((item) => (
        <div key={item.id} className="panel">
          <div className="panel-header">
            <ProductName row={item} as="h3" />
            <span className="small muted">
              Ordered {item.orderedQuantity} · received {item.receivedQuantity} · remaining {item.remainingQuantity}
              {showCost && <> · unit cost <strong>{formatMoney(item.unitPurchasePrice)}</strong></>}
            </span>
          </div>
          <div className="panel-body stack-sm">
            {lines.map((line, index) => line.purchaseItemId === item.id && (
              <div key={line.key} className="grid-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', alignItems: 'end' }}>
                <TextInput label="Batch number" value={line.batchNumber} onChange={(e) => setLine(line.key, 'batchNumber', e.target.value)} error={errorFor(index, 'batchNumber')}
                  placeholder={item.productType === 'COSMETIC' ? 'Auto' : undefined} />
                <TextInput label="Quantity" type="number" min="0" value={line.quantity} onChange={(e) => setLine(line.key, 'quantity', e.target.value)} error={errorFor(index, 'quantity')} />
                <TextInput label="Manufactured" type="date" max={todayIso()} value={line.manufacturingDate} onChange={(e) => setLine(line.key, 'manufacturingDate', e.target.value)} error={errorFor(index, 'manufacturingDate')} />
                <TextInput label="Expiry" type="date" min={todayIso()} value={line.expiryDate} onChange={(e) => setLine(line.key, 'expiryDate', e.target.value)} error={errorFor(index, 'expiryDate')}
                  hint={item.productType === 'COSMETIC' ? 'Optional for cosmetics' : undefined} />
                {showCost && <TextInput label="Unit cost" value={formatMoney(item.unitPurchasePrice, { withCurrency: false })} readOnly disabled hint="From the order" />}
                <TextInput label="Selling price" inputMode="decimal" value={line.sellingPrice} onChange={(e) => setLine(line.key, 'sellingPrice', e.target.value)} error={errorFor(index, 'sellingPrice')}
                  hint={showCost ? `Cost + ${Number(markup ?? 15)}%` : undefined} />
                {lines.filter((l) => l.purchaseItemId === item.id).length > 1 && (
                  <IconButton icon={Trash2} label="Remove batch line" onClick={() => setLines((list) => list.filter((l) => l.key !== line.key))} />
                )}
              </div>
            ))}
            <div><Button variant="ghost" size="sm" icon={Plus} onClick={() => setLines((list) => [...list, { ...newLine(item, markup), quantity: '' }])}>Another batch</Button></div>
          </div>
        </div>
      ))}
      <TextArea label="Delivery notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
    </Modal>
  );
}

function PaymentModal({ purchase, onClose, onDone }) {
  const [form, setForm] = useState({ amount: purchase.balance, paymentMethod: 'BANK_TRANSFER', referenceNumber: '', notes: '' });
  const [key] = useState(() => newIdempotencyKey('payment'));
  const action = useAction();
  const submit = async () => {
    const result = await action.run(() => api.post('/supplier-payments', {
      purchaseId: purchase.id, amount: form.amount, paymentMethod: form.paymentMethod,
      referenceNumber: form.referenceNumber || undefined, notes: form.notes || undefined,
    }, { idempotencyKey: key }), { success: 'Payment recorded.' });
    if (result) onDone();
  };
  return (
    <Modal open title="Record supplier payment" onClose={onClose} closeDisabled={action.running}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={action.running}>Record payment</Button></>}>
      <p className="muted">Balance due on {purchase.purchaseNumber}: <strong>{formatMoney(purchase.balance)}</strong></p>
      <div className="form-grid">
        <TextInput label="Amount" required inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} error={action.fieldErrors.amount} />
        <SelectInput label="Method" value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
          options={[{ value: 'BANK_TRANSFER', label: 'Bank transfer' }, { value: 'CASH', label: 'Cash' }, { value: 'OTHER', label: 'Other' }]} />
        <TextInput label="Reference number" value={form.referenceNumber} onChange={(e) => setForm({ ...form, referenceNumber: e.target.value })} />
        <TextArea label="Notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} fieldClassName="span-2" />
      </div>
      {action.error && action.error.code === 'OVERPAYMENT_NOT_ALLOWED' && <InlineAlert tone="danger">{action.error.message}</InlineAlert>}
      <InlineAlert tone="info">Payments cannot be edited or deleted after recording, and they do not change stock.</InlineAlert>
    </Modal>
  );
}

export default function PurchaseDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [modal, setModal] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const action = useAction();
  const purchase = useApi(() => api.get(`/purchases/${id}`).then((r) => r.data), [id]);

  if (purchase.error) return <Panel><ErrorState error={purchase.error} onRetry={purchase.reload} /></Panel>;
  if (!purchase.data) return <Panel><SkeletonRows rows={8} /></Panel>;
  const p = purchase.data;
  const showCost = p.total !== undefined;
  const editable = ['DRAFT', 'PENDING'].includes(p.status);
  const receivable = ['PENDING', 'PARTIALLY_RECEIVED'].includes(p.status);
  const payable = showCost && !['DRAFT', 'CANCELLED'].includes(p.status) && Number(p.balance) > 0;
  const refresh = () => { setModal(null); purchase.reload({ silent: true }); };

  const submit = async () => {
    const result = await action.run(() => api.patch(`/purchases/${id}`, { status: 'PENDING' }), { success: 'Purchase submitted.' });
    if (result) refresh();
  };
  const cancel = async () => {
    const result = await action.run(() => api.post(`/purchases/${id}/cancel`, { reason: cancelReason }), { success: 'Purchase cancelled.' });
    if (result) refresh();
  };

  return (
    <div className="stack">
      <PageHeader
        breadcrumbs={[{ label: 'Purchases', to: '/purchases' }, { label: p.purchaseNumber }]}
        title={<span className="row-wrap"><span className="mono" style={{ fontSize: 19 }}>{p.purchaseNumber}</span> <StatusBadge status={p.status} /> {p.paymentStatus && <StatusBadge status={p.paymentStatus} />}</span>}
        description={`${p.supplierName} → ${p.branchName}`}
        actions={(
          <>
            {receivable && <Can permission="PURCHASE_RECEIVE"><Button icon={PackageCheck} onClick={() => setModal('receive')}>Receive stock</Button></Can>}
            {p.status === 'DRAFT' && <Can permission="PURCHASE_EDIT"><Button variant="secondary" icon={Send} onClick={submit} loading={action.running}>Submit order</Button></Can>}
            {editable && <Can permission="PURCHASE_EDIT"><Button variant="secondary" icon={Pencil} onClick={() => navigate(`/purchases/${id}/edit`)}>Edit</Button></Can>}
            {payable && <Can permission="SUPPLIER_PAYMENT_CREATE"><Button variant="secondary" icon={Wallet} onClick={() => setModal('pay')}>Record payment</Button></Can>}
            {editable && <Can permission="PURCHASE_CANCEL"><Button variant="ghost" icon={XCircle} onClick={() => setModal('cancel')}>Cancel</Button></Can>}
          </>
        )}
      />

      {p.status === 'DRAFT' && <InlineAlert tone="info">Draft purchases cannot be received. Submit the order when it has been placed with the supplier.</InlineAlert>}
      {p.status === 'CANCELLED' && <InlineAlert tone="warning">Cancelled{p.cancelReason ? `: ${p.cancelReason}` : ''}.</InlineAlert>}

      {showCost && (
        <div className="grid-4">
          <Kpi label="Subtotal" value={formatMoney(p.subtotal)} note={`Discount ${formatMoney(p.discount)} · Tax ${formatMoney(p.tax)}`} />
          <Kpi label="Total" value={formatMoney(p.total)} />
          <Kpi label="Paid" value={formatMoney(p.amountPaid)} />
          <Kpi label="Balance due" value={formatMoney(p.balance)} tone={Number(p.balance) > 0 && p.status !== 'DRAFT' ? 'warning' : undefined} />
        </div>
      )}

      <Panel title="Details">
        <Details items={[
          { label: 'Supplier', value: p.supplierName },
          { label: 'Branch', value: p.branchName },
          { label: 'Purchase date', value: formatDate(p.purchaseDate) },
          { label: 'Expected', value: formatDate(p.expectedDate) },
          { label: 'Created by', value: p.createdByName },
          { label: 'Created', value: formatDateTime(p.createdAt) },
          { label: 'Notes', value: p.notes },
        ]} />
      </Panel>

      <Panel title="Items" flush>
        <DataTable rows={p.items} columns={[
          { key: 'medicineName', label: 'Product', render: (i) => <ProductName row={i} /> },
          { key: 'orderedQuantity', label: 'Ordered', align: 'right', render: (i) => formatNumber(i.orderedQuantity) },
          { key: 'receivedQuantity', label: 'Received', align: 'right', render: (i) => formatNumber(i.receivedQuantity) },
          { key: 'remainingQuantity', label: 'Remaining', align: 'right', render: (i) => <span className={i.remainingQuantity > 0 && p.status !== 'CANCELLED' ? 'warning-text' : undefined}>{formatNumber(i.remainingQuantity)}</span> },
          showCost && { key: 'unitPurchasePrice', label: 'Unit cost', align: 'right', render: (i) => formatMoney(i.unitPurchasePrice) },
          showCost && { key: 'lineTotal', label: 'Line total', align: 'right', render: (i) => formatMoney(i.lineTotal) },
        ].filter(Boolean)} />
      </Panel>

      <Panel title="Receiving history" flush>
        <DataTable rows={p.receivings} onRowClick={(r) => setModal({ receiving: r.id })} columns={[
          { key: 'receivedAt', label: 'Received', render: (r) => formatDateTime(r.receivedAt) },
          { key: 'receivedByName', label: 'By' },
          { key: 'lineCount', label: 'Lines', align: 'right' },
          { key: 'totalQuantity', label: 'Units', align: 'right', render: (r) => formatNumber(r.totalQuantity) },
          showCost && { key: 'totalCost', label: 'Cost', align: 'right', render: (r) => formatMoney(r.totalCost) },
          { key: 'notes', label: 'Notes', render: (r) => r.notes || '—' },
        ].filter(Boolean)} empty={<EmptyState title="Nothing received yet" learnHow="purchasing-and-receiving" />} />
      </Panel>

      {p.payments && (
        <Panel title="Payments" flush>
          <DataTable rows={p.payments} columns={[
            { key: 'paidAt', label: 'Paid', render: (x) => formatDateTime(x.paidAt) },
            { key: 'paymentMethod', label: 'Method', render: (x) => humanize(x.paymentMethod) },
            { key: 'referenceNumber', label: 'Reference', render: (x) => x.referenceNumber || '—' },
            { key: 'recordedByName', label: 'Recorded by' },
            { key: 'amount', label: 'Amount', align: 'right', render: (x) => formatMoney(x.amount) },
          ]} empty={<EmptyState title="No payments recorded" learnHow="supplier-payments" />} />
        </Panel>
      )}

      {modal === 'receive' && <ReceiveModal purchase={p} onClose={() => setModal(null)} onDone={refresh} />}
      {modal === 'pay' && <PaymentModal purchase={p} onClose={() => setModal(null)} onDone={refresh} />}
      {modal && modal.receiving && <ReceivingModal id={modal.receiving} showCost={showCost} onClose={() => setModal(null)} />}
      <ConfirmDialog open={modal === 'cancel'} title="Cancel purchase" tone="danger" confirmLabel="Cancel purchase" loading={action.running}
        onClose={() => setModal(null)} onConfirm={cancel}>
        <p>Cancelling is only possible before any stock is received or payment recorded. It cannot be undone.</p>
        <TextArea label="Reason" required rows={2} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} error={action.fieldErrors.reason} />
        <LearnHow slug="purchasing-and-receiving" />
      </ConfirmDialog>
    </div>
  );
}

function ReceivingModal({ id, showCost, onClose }) {
  const receiving = useApi(() => api.get(`/purchase-receivings/${id}`).then((r) => r.data), [id]);
  const r = receiving.data;
  return (
    <Modal open title="Receiving record" size="lg" onClose={onClose}>
      {receiving.error && <ErrorState error={receiving.error} onRetry={receiving.reload} />}
      {!r && !receiving.error && <SkeletonRows rows={3} />}
      {r && (
        <>
          <Details items={[
            { label: 'Purchase', value: r.purchaseNumber },
            { label: 'Branch', value: r.branchName },
            { label: 'Received by', value: r.receivedByName },
            { label: 'Received', value: formatDateTime(r.receivedAt) },
          ]} />
          <DataTable rows={r.items} columns={[
            { key: 'medicineName', label: 'Product', render: (i) => <ProductName row={i} /> },
            { key: 'batchNumber', label: 'Batch', render: (i) => <span className="mono">{i.batchNumber}</span> },
            { key: 'expiryDate', label: 'Expiry', render: (i) => formatDate(i.expiryDate) },
            { key: 'quantity', label: 'Qty', align: 'right' },
            showCost && { key: 'purchasePrice', label: 'Unit cost', align: 'right', render: (i) => formatMoney(i.purchasePrice) },
            { key: 'sellingPrice', label: 'Selling price', align: 'right', render: (i) => formatMoney(i.sellingPrice) },
          ].filter(Boolean)} />
        </>
      )}
    </Modal>
  );
}
