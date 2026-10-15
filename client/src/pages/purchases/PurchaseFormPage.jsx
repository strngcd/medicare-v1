import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useAction } from '../../hooks/useAction.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useSuppliers, toOptions } from '../../hooks/useLookups.js';
import { PageHeader, Panel, Button, SelectInput, TextInput, TextArea, IconButton, InlineAlert, ErrorState, SkeletonRows, EmptyState, LearnHow, Checkbox } from '../../components/ui/index.js';
import { MedicinePicker } from '../../components/MedicinePicker.jsx';
import { ProductName } from '../../components/ProductName.jsx';
import { formatDateTime, formatMoney, todayIso } from '../../utils/format.js';
import { toCents, fromCents, percentOfCents, suggestedSellingPrice } from '../../utils/money.js';

/**
 * Line amounts in cents. Discount and tax are each entered as an amount or a
 * percent (discount of the line cost, tax of the cost after discount); only
 * the resulting amounts are sent to the server.
 */
function lineAmounts(item) {
  const base = toCents(item.unitPurchasePrice || '0') * (Number(item.orderedQuantity) || 0);
  const discount = item.discountMode === 'PERCENT' ? percentOfCents(base, Math.min(Number(item.discount) || 0, 100)) : toCents(item.discount || '0');
  const tax = item.taxMode === 'PERCENT' ? percentOfCents(base - discount, item.tax) : toCents(item.tax || '0');
  return { base, discount, tax, total: base - discount + tax };
}
const lineTotal = (item) => lineAmounts(item).total;

const MODE_OPTIONS = [['AMOUNT', 'Amt'], ['PERCENT', '%']];

/** Discount or tax input with an amount / percent switch. */
function AmountOrPercent({ label, value, mode, amountCents, invalid, onValue, onMode }) {
  return (
    <span className="stack-sm" style={{ gap: 2, alignItems: 'flex-end' }}>
      <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
        <select className="select" style={{ width: 64 }} value={mode || 'AMOUNT'} onChange={(e) => onMode(e.target.value)} aria-label={`${label} type`}>
          {MODE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input className="input" style={{ width: 80 }} inputMode="decimal" value={value} placeholder={mode === 'PERCENT' ? '0' : '0.00'} aria-label={label}
          aria-invalid={invalid ? 'true' : undefined} onChange={(e) => onValue(e.target.value)} />
      </span>
      {mode === 'PERCENT' && Number(value) > 0 && <span className="small muted">= {formatMoney(fromCents(amountCents))}</span>}
    </span>
  );
}

const EMPTY_PAYMENT = { enabled: false, amount: '', paymentMethod: 'BANK_TRANSFER', referenceNumber: '' };

// Unsaved new purchases are kept in this browser only, per user.
const draftKey = (userId) => `medicar.purchaseDraft.${userId}`;

function readDraft(userId) {
  try {
    const raw = localStorage.getItem(draftKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeDraft(userId, draft) {
  try {
    if (draft) localStorage.setItem(draftKey(userId), JSON.stringify(draft));
    else localStorage.removeItem(draftKey(userId));
  } catch {
    /* storage unavailable: the draft simply is not kept */
  }
}

/** Create or edit a purchase (edit only before anything is received). */
export default function PurchaseFormPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { activeBranches, branchParam, user, can, pharmacy } = useAuth();
  const suppliers = useSuppliers();
  const existing = useApi(() => api.get(`/purchases/${id}`).then((r) => r.data), [id], { enabled: Boolean(id) });
  const action = useAction();
  const markup = pharmacy && pharmacy.defaultMarkupPercent;
  const isNew = !id;
  const canReceive = isNew && can('PURCHASE_RECEIVE');
  const canPay = isNew && can('SUPPLIER_PAYMENT_CREATE') && can('FINANCIAL_VIEW_PURCHASE_COST');
  const defaultBranch = branchParam || (activeBranches[0] && activeBranches[0].id) || '';

  const [restored] = useState(() => (isNew && user ? readDraft(user.id) : null));
  const [form, setForm] = useState(() => (restored && restored.form) || {
    supplierId: search.get('supplierId') || '',
    branchId: defaultBranch,
    purchaseDate: todayIso(),
    expectedDate: '',
    notes: '',
  });
  const [items, setItems] = useState(() => (restored && restored.items) || []);
  const [receiveNow, setReceiveNow] = useState(() => Boolean(restored && restored.receiveNow));
  const [payment, setPayment] = useState(() => (restored && restored.payment) || EMPTY_PAYMENT);
  const [showRestored, setShowRestored] = useState(Boolean(restored));
  const saved = useRef(false);

  useEffect(() => {
    if (!existing.data) return;
    const p = existing.data;
    setForm({ supplierId: p.supplierId, branchId: p.branchId, purchaseDate: p.purchaseDate, expectedDate: p.expectedDate || '', notes: p.notes || '' });
    setItems(p.items.map((i) => ({
      medicineId: i.medicineId, medicineName: i.medicineName, strength: i.strength, dosageForm: i.dosageForm, packageSize: i.packageSize,
      productType: i.productType, orderedQuantity: String(i.orderedQuantity),
      unitPurchasePrice: i.unitPurchasePrice, discount: i.discount, tax: i.tax, notes: i.notes || '',
    })));
  }, [existing.data]);

  // Keep the unsaved new purchase so leaving the page does not lose it.
  useEffect(() => {
    if (!isNew || !user || saved.current) return;
    const empty = items.length === 0 && !form.notes && !form.supplierId;
    writeDraft(user.id, empty ? null : { form, items, receiveNow, payment, savedAt: new Date().toISOString() });
  }, [isNew, user, form, items, receiveNow, payment]);

  const discardDraft = () => {
    writeDraft(user.id, null);
    setShowRestored(false);
    setForm({ supplierId: '', branchId: defaultBranch, purchaseDate: todayIso(), expectedDate: '', notes: '' });
    setItems([]);
    setReceiveNow(false);
    setPayment(EMPTY_PAYMENT);
  };

  const totalCents = useMemo(() => items.reduce((sum, i) => sum + lineTotal(i), 0), [items]);
  const setItem = (index, key, value) => setItems((list) => list.map((item, i) => {
    if (i !== index) return item;
    const next = { ...item, [key]: value };
    // The selling price keeps following the unit cost until the user edits it.
    if (key === 'receiveSellingPrice') next.sellingPriceEdited = true;
    return next;
  }));
  const sellingPriceOf = (item) => (item.sellingPriceEdited ? item.receiveSellingPrice : suggestedSellingPrice(item.unitPurchasePrice, markup));
  const receiveQuantityOf = (item) => item.receiveQuantity ?? item.orderedQuantity;

  const receivingLines = receiveNow ? items.filter((i) => Number(receiveQuantityOf(i)) > 0) : [];

  const save = async (status) => {
    const payload = {
      supplierId: form.supplierId,
      purchaseDate: form.purchaseDate,
      expectedDate: form.expectedDate || null,
      notes: form.notes || null,
      status,
      items: items.map((i) => {
        const amounts = lineAmounts(i);
        return {
          medicineId: i.medicineId,
          orderedQuantity: Number(i.orderedQuantity),
          unitPurchasePrice: i.unitPurchasePrice,
          discount: fromCents(amounts.discount),
          tax: fromCents(amounts.tax),
          notes: i.notes || null,
        };
      }),
    };
    if (receivingLines.length > 0) {
      payload.receive = {
        items: receivingLines.map((i) => ({
          medicineId: i.medicineId,
          batchNumber: (i.batchNumber || '').trim() || null,
          manufacturingDate: i.manufacturingDate || null,
          expiryDate: i.expiryDate || null,
          quantity: Number(receiveQuantityOf(i)),
          sellingPrice: sellingPriceOf(i) || '',
        })),
      };
    }
    if (payment.enabled) {
      payload.payment = { amount: payment.amount, paymentMethod: payment.paymentMethod, referenceNumber: payment.referenceNumber || undefined };
    }
    const call = id ? () => api.patch(`/purchases/${id}`, payload) : () => api.post('/purchases', { ...payload, branchId: form.branchId });
    const result = await action.run(call, { success: status === 'PENDING' ? 'Purchase submitted.' : 'Purchase saved as draft.' });
    if (result) {
      if (isNew) {
        saved.current = true;
        writeDraft(user.id, null);
      }
      navigate(`/purchases/${result.data.id}`, { replace: true });
    }
  };

  if (id && existing.error) return <Panel><ErrorState error={existing.error} onRetry={existing.reload} /></Panel>;
  if (id && !existing.data) return <Panel><SkeletonRows /></Panel>;
  const editingPending = existing.data && existing.data.status === 'PENDING';
  const errors = action.fieldErrors;
  const receiveError = (item, field) => {
    const index = receivingLines.findIndex((l) => l.medicineId === item.medicineId);
    return index >= 0 ? errors[`receive.items.${index}.${field}`] : undefined;
  };
  const extras = receivingLines.length > 0 || payment.enabled;

  return (
    <div className="stack">
      <PageHeader
        title={id ? `Edit ${existing.data.purchaseNumber}` : 'New purchase'}
        breadcrumbs={[{ label: 'Purchases', to: '/purchases' }, { label: id ? existing.data.purchaseNumber : 'New' }]}
        actions={<LearnHow slug="purchasing-and-receiving" />}
      />
      {showRestored && (
        <InlineAlert tone="info">
          <span className="spread" style={{ flexWrap: 'wrap', gap: 8 }}>
            <span>Restored your unsaved purchase from {formatDateTime(restored.savedAt)}.</span>
            <Button size="sm" variant="ghost" onClick={discardDraft}>Discard and start over</Button>
          </span>
        </InlineAlert>
      )}
      <Panel title="Supplier and branch">
        <div className="form-grid">
          <SelectInput label="Supplier" required value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
            options={toOptions(suppliers.data, 'companyName')} placeholder="Select supplier" error={errors.supplierId} />
          <SelectInput label="Receiving branch" required value={form.branchId} disabled={Boolean(id)} onChange={(e) => setForm({ ...form, branchId: e.target.value })}
            options={activeBranches.map((b) => ({ value: b.id, label: b.name }))} placeholder="Select branch" error={errors.branchId} hint={id ? 'The branch cannot be changed after creation.' : undefined} />
          <TextInput label="Purchase date" type="date" max={todayIso()} value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} error={errors.purchaseDate} />
          <TextInput label="Expected delivery" type="date" min={form.purchaseDate} value={form.expectedDate} onChange={(e) => setForm({ ...form, expectedDate: e.target.value })} error={errors.expectedDate} />
          <TextArea label="Notes" rows={2} fieldClassName="span-2" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
      </Panel>

      <Panel title="Products" flush footer={<div className="spread"><span className="muted">Estimated total (the server calculates the final amount)</span><strong>{formatMoney(fromCents(totalCents))}</strong></div>}>
        <div className="panel-body"><MedicinePicker withFilters exclude={items.map((i) => i.medicineId)} onSelect={(m) => setItems((list) => [...list, {
          medicineId: m.id, medicineName: m.name, strength: m.strength, dosageForm: m.dosageForm, packageSize: m.packageSize, brandName: m.brandName,
          productType: m.productType, orderedQuantity: '', unitPurchasePrice: '', discount: '', tax: '', notes: '',
        }])} /></div>
        {items.length === 0 ? (
          <EmptyState title="No medicines added" message="Search above to add the medicines you are ordering. Only active medicines can be purchased." />
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr><th>Product</th><th className="num">Quantity</th><th className="num">Unit cost</th><th className="num">Discount</th><th className="num">Tax</th><th className="num">Line total</th><th /></tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={item.medicineId}>
                    <td data-label="Product"><ProductName row={item} /></td>
                    <td data-label="Quantity" className="num"><input className="input" style={{ width: 90 }} type="number" min="1" value={item.orderedQuantity} aria-label="Quantity"
                      aria-invalid={errors[`items.${index}.orderedQuantity`] ? 'true' : undefined} onChange={(e) => setItem(index, 'orderedQuantity', e.target.value)} /></td>
                    <td data-label="Unit cost" className="num"><input className="input" style={{ width: 100 }} inputMode="decimal" value={item.unitPurchasePrice} aria-label="Unit cost"
                      aria-invalid={errors[`items.${index}.unitPurchasePrice`] ? 'true' : undefined} onChange={(e) => setItem(index, 'unitPurchasePrice', e.target.value)} /></td>
                    <td data-label="Discount" className="num">
                      <AmountOrPercent label="Discount" value={item.discount} mode={item.discountMode} amountCents={lineAmounts(item).discount}
                        invalid={errors[`items.${index}.discount`]} onValue={(v) => setItem(index, 'discount', v)} onMode={(v) => setItem(index, 'discountMode', v)} />
                    </td>
                    <td data-label="Tax" className="num">
                      <AmountOrPercent label="Tax" value={item.tax} mode={item.taxMode} amountCents={lineAmounts(item).tax}
                        invalid={errors[`items.${index}.tax`]} onValue={(v) => setItem(index, 'tax', v)} onMode={(v) => setItem(index, 'taxMode', v)} />
                    </td>
                    <td data-label="Line total" className="num">{formatMoney(fromCents(lineTotal(item)))}</td>
                    <td data-label=""><IconButton icon={Trash2} label="Remove" onClick={() => setItems((list) => list.filter((_, i) => i !== index))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {canReceive && items.length > 0 && (
        <Panel title={<Checkbox label="Receive stock now (optional)" checked={receiveNow} onChange={(e) => setReceiveNow(e.target.checked)} />}>
          {!receiveNow ? (
            <p className="muted small">Tick this if the delivery has arrived. You can receive all or part of the order now and the rest later from the purchase page.</p>
          ) : (
            <div className="stack">
              <p className="muted small">Set quantity to 0 to skip an item. Selling price starts at unit cost + {Number(markup ?? 15)}% and can be changed.</p>
              {items.map((item, index) => (
                <div key={item.medicineId} className="stack-sm">
                  <ProductName row={item} as="strong" />
                  <div className="grid-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', alignItems: 'start' }}>
                    <TextInput label="Batch number" value={item.batchNumber || ''} onChange={(e) => setItem(index, 'batchNumber', e.target.value)} error={receiveError(item, 'batchNumber')}
                      placeholder={item.productType === 'COSMETIC' ? 'Auto' : undefined} />
                    <TextInput label="Quantity" type="number" min="0" max={item.orderedQuantity} value={receiveQuantityOf(item)}
                      onChange={(e) => setItem(index, 'receiveQuantity', e.target.value)} error={receiveError(item, 'quantity')} />
                    <TextInput label="Manufactured" type="date" max={todayIso()} value={item.manufacturingDate || ''} onChange={(e) => setItem(index, 'manufacturingDate', e.target.value)} error={receiveError(item, 'manufacturingDate')} />
                    <TextInput label="Expiry" type="date" min={todayIso()} value={item.expiryDate || ''} onChange={(e) => setItem(index, 'expiryDate', e.target.value)} error={receiveError(item, 'expiryDate')}
                      hint={item.productType === 'COSMETIC' ? 'Optional for cosmetics' : undefined} />
                    <TextInput label="Selling price" inputMode="decimal" value={sellingPriceOf(item)}
                      onChange={(e) => setItem(index, 'receiveSellingPrice', e.target.value)} error={receiveError(item, 'sellingPrice')} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      {canPay && items.length > 0 && (
        <Panel title={<Checkbox label="Record a payment now (optional)" checked={payment.enabled} onChange={(e) => setPayment({ ...payment, enabled: e.target.checked })} />}>
          {!payment.enabled ? (
            <p className="muted small">Tick this if you are paying the supplier now. Partial payments are allowed; the rest can be paid later.</p>
          ) : (
            <div className="stack-sm">
              <div className="form-grid">
                <TextInput label="Amount" required inputMode="decimal" value={payment.amount} onChange={(e) => setPayment({ ...payment, amount: e.target.value })} error={errors['payment.amount']} />
                <SelectInput label="Method" value={payment.paymentMethod} onChange={(e) => setPayment({ ...payment, paymentMethod: e.target.value })}
                  options={[{ value: 'BANK_TRANSFER', label: 'Bank transfer' }, { value: 'CASH', label: 'Cash' }, { value: 'OTHER', label: 'Other' }]} />
                <TextInput label="Reference number" value={payment.referenceNumber} onChange={(e) => setPayment({ ...payment, referenceNumber: e.target.value })} />
              </div>
              <div><Button size="sm" variant="ghost" onClick={() => setPayment({ ...payment, amount: fromCents(totalCents) })}>Pay the full {formatMoney(fromCents(totalCents))}</Button></div>
            </div>
          )}
        </Panel>
      )}

      {Object.keys(errors).some((k) => k.startsWith('items')) && <InlineAlert tone="danger">Check the highlighted item quantities and prices.</InlineAlert>}
      {action.error && ['OVERPAYMENT_NOT_ALLOWED', 'BATCH_COST_CONFLICT', 'BATCH_DATA_CONFLICT', 'BATCH_EXPIRED', 'OVER_RECEIVING'].includes(action.error.code) && (
        <InlineAlert tone="danger">{action.error.message} Nothing was saved.</InlineAlert>
      )}
      <div className="form-actions">
        <Button variant="secondary" onClick={() => navigate(-1)} disabled={action.running}>Cancel</Button>
        {!editingPending && <Button variant="secondary" onClick={() => save('DRAFT')} loading={action.running} disabled={items.length === 0 || extras}
          title={extras ? 'Drafts cannot include receiving or a payment' : undefined}>Save draft</Button>}
        <Button onClick={() => save('PENDING')} loading={action.running} disabled={items.length === 0}>{editingPending ? 'Save changes' : 'Submit order'}</Button>
      </div>
    </div>
  );
}
