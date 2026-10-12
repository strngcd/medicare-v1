import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Printer, Undo2, Ban } from 'lucide-react';
import { api, newIdempotencyKey } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useAction } from '../../hooks/useAction.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Can } from '../../permissions/Can.jsx';
import {
  PageHeader, Panel, Button, StatusBadge, Details, DataTable, ErrorState, SkeletonRows, EmptyState, Modal,
  SelectInput, TextArea, InlineAlert, ConfirmDialog, Kpi, LearnHow,
} from '../../components/ui/index.js';
import { ReceiptModal } from '../../components/sales/ReceiptModal.jsx';
import { formatDate, formatDateTime, formatMoney, formatNumber, humanize } from '../../utils/format.js';
import { toCents, fromCents } from '../../utils/money.js';

const REASONS = ['CUSTOMER_RETURN', 'DAMAGED_PRODUCT', 'WRONG_ITEM', 'WRONG_QUANTITY', 'DUPLICATE_SALE', 'OTHER'].map((r) => ({ value: r, label: humanize(r) }));

/** Estimated refund for display; the server calculates the exact amount. */
function estimateRefund(item, quantity) {
  const line = toCents(item.lineTotal);
  const before = Math.round((line * item.refundedQuantity) / item.quantity);
  const after = Math.round((line * (item.refundedQuantity + quantity)) / item.quantity);
  return after - before;
}

function RefundModal({ sale, onClose, onDone }) {
  const refundable = sale.items.filter((i) => i.refundableQuantity > 0);
  const [quantities, setQuantities] = useState({});
  const [reason, setReason] = useState('CUSTOMER_RETURN');
  const [notes, setNotes] = useState('');
  const [key] = useState(() => newIdempotencyKey('refund'));
  const action = useAction();
  const lines = refundable.filter((i) => Number(quantities[i.id]) > 0);
  const estimate = lines.reduce((s, i) => s + estimateRefund(i, Number(quantities[i.id])), 0);

  const submit = async () => {
    const result = await action.run(() => api.post('/refunds', {
      saleId: sale.id,
      reason,
      notes: notes || undefined,
      items: lines.map((i) => ({ saleItemId: i.id, quantity: Number(quantities[i.id]) })),
    }, { idempotencyKey: key }), { success: (r) => `Refund ${r.data.refundNumber} processed (${formatMoney(r.data.refundTotal)}).` });
    if (result) onDone();
  };

  return (
    <Modal open size="lg" title={`Refund — ${sale.receiptNumber}`} onClose={onClose} closeDisabled={action.running}
      footer={(
        <>
          <span className="grow">Refund: <strong>{formatMoney(fromCents(estimate))}</strong> by {humanize(sale.paymentMethod)}</span>
          <Button variant="secondary" onClick={onClose} disabled={action.running}>Cancel</Button>
          <Button onClick={submit} loading={action.running} disabled={lines.length === 0}>Process refund</Button>
        </>
      )}>
      <div className="row-wrap">
        <Button variant="secondary" size="sm" onClick={() => setQuantities(Object.fromEntries(refundable.map((i) => [i.id, String(i.refundableQuantity)])))}>Refund everything remaining</Button>
        <LearnHow slug="refunds-and-voids" />
      </div>
      <table className="table responsive">
        <thead><tr><th>Medicine</th><th className="num">Sold</th><th className="num">Already refunded</th><th className="num">Remaining</th><th className="num">Unit price</th><th className="num">Refund qty</th></tr></thead>
        <tbody>
          {sale.items.map((i) => (
            <tr key={i.id}>
              <td data-label="Medicine" className="cell-strong">{i.medicineName}</td>
              <td data-label="Sold" className="num">{i.quantity}</td>
              <td data-label="Already refunded" className="num">{i.refundedQuantity}</td>
              <td data-label="Remaining" className="num">{i.refundableQuantity}</td>
              <td data-label="Unit price" className="num">{formatMoney(i.unitSellingPrice)}</td>
              <td data-label="Refund qty" className="num">
                <input className="input" style={{ width: 80 }} type="number" min="0" max={i.refundableQuantity} disabled={i.refundableQuantity === 0}
                  value={quantities[i.id] || ''} onChange={(e) => setQuantities({ ...quantities, [i.id]: String(Math.min(i.refundableQuantity, Math.max(0, Math.trunc(Number(e.target.value) || 0)))) })}
                  aria-label={`Refund quantity for ${i.medicineName}`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="form-grid">
        <SelectInput label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} options={REASONS} />
        <TextArea label={reason === 'OTHER' ? 'Note (required)' : 'Note'} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} error={action.fieldErrors.notes} />
      </div>
      <InlineAlert tone="info">Stock returns to the original batches. The refund uses the original sale price and payment method.</InlineAlert>
      {action.error && action.error.code === 'REFUND_EXCEEDS_REMAINING' && <InlineAlert tone="danger">{action.error.message}</InlineAlert>}
    </Modal>
  );
}

export default function SaleDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const [modal, setModal] = useState(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidKey] = useState(() => newIdempotencyKey('void'));
  const action = useAction();
  const sale = useApi(() => api.get(`/sales/${id}`).then((r) => r.data), [id]);

  if (sale.error) return <Panel><ErrorState error={sale.error} onRetry={sale.reload} /></Panel>;
  if (!sale.data) return <Panel><SkeletonRows rows={8} /></Panel>;
  const s = sale.data;
  const refundable = s.status === 'COMPLETED' && s.items.some((i) => i.refundableQuantity > 0);
  const voidable = s.status === 'COMPLETED' && s.refunds.length === 0;
  const refresh = () => { setModal(null); sale.reload({ silent: true }); };

  const doVoid = async () => {
    const result = await action.run(() => api.post(`/sales/${id}/void`, { reason: voidReason }, { idempotencyKey: voidKey }), { success: 'Sale voided and stock restored.' });
    if (result) refresh();
  };

  return (
    <div className="stack">
      <PageHeader
        breadcrumbs={[{ label: 'Sales', to: '/sales' }, { label: s.receiptNumber }]}
        title={<span className="row-wrap"><span className="mono" style={{ fontSize: 19 }}>{s.receiptNumber}</span> <StatusBadge status={s.status} /></span>}
        description={`${s.branchName} · ${formatDateTime(s.completedAt)} · ${s.soldByName}`}
        actions={(
          <>
            <Can permission="SALES_PRINT_RECEIPT"><Button variant="secondary" icon={Printer} onClick={() => setModal('receipt')}>Receipt</Button></Can>
            {refundable && <Can permission="SALES_PROCESS_REFUND"><Button icon={Undo2} onClick={() => setModal('refund')}>Refund</Button></Can>}
            {voidable && <Can permission="SALES_VOID"><Button variant="ghost" icon={Ban} onClick={() => setModal('void')}>Void</Button></Can>}
          </>
        )}
      />
      {s.status === 'VOIDED' && <InlineAlert tone="warning">Voided {formatDateTime(s.voidedAt)} by {s.voidedByName}: {s.voidReason}. Stock was restored; the sale remains in history.</InlineAlert>}
      {s.status === 'COMPLETED' && s.refunds.length > 0 && can('SALES_VOID') && <InlineAlert tone="info">This sale has refunds, so it can no longer be voided.</InlineAlert>}

      <div className="grid-4">
        <Kpi label="Total" value={formatMoney(s.total)} note={`${humanize(s.paymentMethod)}`} />
        <Kpi label="Subtotal" value={formatMoney(s.subtotal)} note={Number(s.discount) > 0 ? `Discount ${formatMoney(s.discount)}${s.discountType === 'PERCENTAGE' ? ` (${Number(s.discountValue)}%)` : ''}` : 'No discount'} />
        <Kpi label="Tax" value={formatMoney(s.tax)} note={s.taxName ? `${s.taxName} ${Number(s.taxRate)}% ${s.taxMode === 'INCLUDED' ? 'included' : 'added'}` : 'Tax not applied'} />
        <Kpi label="Refunded" value={formatMoney(s.refundedTotal)} />
        {s.grossProfit !== undefined && <Kpi label="Gross profit" value={formatMoney(s.grossProfit)} note={`COGS ${formatMoney(s.cogs)}`} />}
      </div>

      <Panel title="Items" flush>
        <DataTable rows={s.items} columns={[
          { key: 'medicineName', label: 'Medicine', render: (i) => <span className="cell-strong">{i.medicineName}</span> },
          { key: 'quantity', label: 'Qty', align: 'right' },
          { key: 'unitSellingPrice', label: 'Unit price', align: 'right', render: (i) => formatMoney(i.unitSellingPrice) },
          { key: 'discount', label: 'Discount', align: 'right', render: (i) => formatMoney(i.discount) },
          { key: 'tax', label: 'Tax', align: 'right', render: (i) => formatMoney(i.tax) },
          { key: 'lineTotal', label: 'Line total', align: 'right', render: (i) => formatMoney(i.lineTotal) },
          { key: 'refundedQuantity', label: 'Refunded', align: 'right', render: (i) => (i.refundedQuantity ? formatNumber(i.refundedQuantity) : '—') },
          { key: 'allocations', label: 'Batches', render: (i) => (
            <span className="small">{i.allocations.map((a) => `${a.batchNumber} ×${a.quantity}${a.purchasePriceAtSale !== undefined ? ` @${formatMoney(a.purchasePriceAtSale, { withCurrency: false })}` : ''}`).join(', ')}</span>
          ) },
        ]} />
      </Panel>

      <Panel title="Refunds" flush>
        <DataTable rows={s.refunds} columns={[
          { key: 'refundNumber', label: 'Refund', render: (r) => <Link className="mono" to={`/refunds?search=${r.refundNumber}`}>{r.refundNumber}</Link> },
          { key: 'createdAt', label: 'Date', render: (r) => formatDateTime(r.createdAt) },
          { key: 'reason', label: 'Reason', render: (r) => humanize(r.reason) },
          { key: 'processedByName', label: 'Processed by' },
          { key: 'refundTotal', label: 'Amount', align: 'right', render: (r) => formatMoney(r.refundTotal) },
        ]} empty={<EmptyState title="No refunds" />} />
      </Panel>

      <Panel title="Details">
        <Details items={[
          { label: 'Branch', value: s.branchName },
          { label: 'Staff', value: s.soldByName },
          { label: 'Completed', value: formatDateTime(s.completedAt) },
          { label: 'Payment', value: humanize(s.paymentMethod) },
          { label: 'Business date', value: formatDate(s.completedAt) },
        ]} />
      </Panel>

      {modal === 'receipt' && <ReceiptModal saleId={s.id} onClose={() => setModal(null)} />}
      {modal === 'refund' && <RefundModal sale={s} onClose={() => setModal(null)} onDone={refresh} />}
      <ConfirmDialog open={modal === 'void'} title="Void sale" tone="danger" confirmLabel="Void sale" loading={action.running} onClose={() => setModal(null)} onConfirm={doVoid}>
        <p>Voiding cancels the whole sale and returns every unit to its original batch. The sale stays in history as voided. This cannot be undone.</p>
        <TextArea label="Reason" required rows={2} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} error={action.fieldErrors.reason} />
      </ConfirmDialog>
    </div>
  );
}
