import { useEffect, useMemo, useRef, useState } from 'react';
import { ScanBarcode, Trash2, Minus, Plus, AlertTriangle, ShoppingCart, Layers, Store } from 'lucide-react';
import { api, newIdempotencyKey } from '../../api/client.js';
import { useApi, useDebouncedValue } from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useCategories, toOptions } from '../../hooks/useLookups.js';
import {
  PageHeader, Panel, Button, Badge, EmptyState, InlineAlert, Modal, TextInput, SelectInput, IconButton, SkeletonRows, ErrorState, LearnHow, FilterToolbar,
} from '../../components/ui/index.js';
import { ReceiptModal } from '../../components/sales/ReceiptModal.jsx';
import { estimateTotals, toCents, fromCents } from '../../utils/money.js';
import { formatDate, formatMoney, formatNumber, PRODUCT_TYPE_OPTIONS } from '../../utils/format.js';

/** Optional FEFO override: pick exact batches with a reason (permission-gated). */
function BatchOverrideModal({ line, branchId, onClose, onApply }) {
  const preview = useApi(() => api.post('/inventory/fefo-preview', { branchId, medicineId: line.medicineId, quantity: line.quantity }).then((r) => r.data), []);
  const [picked, setPicked] = useState(() => Object.fromEntries((line.batchAllocations || []).map((a) => [a.batchId, String(a.quantity)])));
  const [reason, setReason] = useState(line.fefoOverrideReason || '');
  const total = Object.values(picked).reduce((s, v) => s + (Number(v) || 0), 0);

  return (
    <Modal open size="lg" title={`Choose batches — ${line.name}`} onClose={onClose}
      footer={(
        <>
          {line.batchAllocations && <Button variant="ghost" onClick={() => onApply(null)}>Use FEFO again</Button>}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={total !== line.quantity || !reason.trim()} onClick={() => onApply({
            batchAllocations: Object.entries(picked).filter(([, q]) => Number(q) > 0).map(([batchId, q]) => ({ batchId, quantity: Number(q) })),
            fefoOverrideReason: reason.trim(),
          })}>Apply</Button>
        </>
      )}>
      <InlineAlert tone="warning">FEFO sells the batch that expires first. Overrides are recorded with your name and reason.</InlineAlert>
      {preview.error && <ErrorState error={preview.error} onRetry={preview.reload} />}
      {!preview.data && !preview.error && <SkeletonRows rows={3} />}
      {preview.data && (
        <table className="table">
          <thead><tr><th>Batch</th><th>Expiry</th><th className="num">Available</th><th className="num">Price</th><th className="num">Take</th></tr></thead>
          <tbody>
            {preview.data.sellableBatches.map((b) => (
              <tr key={b.batchId}>
                <td className="mono">{b.batchNumber}{preview.data.allocation[0] && preview.data.allocation[0].batchId === b.batchId && <> <Badge tone="primary">FEFO</Badge></>}</td>
                <td>{formatDate(b.expiryDate)}</td>
                <td className="num">{formatNumber(b.available)}</td>
                <td className="num">{formatMoney(b.sellingPrice)}</td>
                <td className="num"><input className="input" style={{ width: 80 }} type="number" min="0" max={b.available} value={picked[b.batchId] || ''}
                  onChange={(e) => setPicked({ ...picked, [b.batchId]: e.target.value })} aria-label={`Quantity from ${b.batchNumber}`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className={total === line.quantity ? 'muted' : 'warning-text'}>Selected {total} of {line.quantity} units.</p>
      <TextInput label="Reason for override" required value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}

export default function PosPage() {
  const { branchParam, selectedBranch, isAllBranches, pharmacy, can } = useAuth();
  const toast = useToast();
  const categories = useCategories();
  const [term, setTerm] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [productType, setProductType] = useState('');
  const [cart, setCart] = useState([]);
  const [discount, setDiscount] = useState({ type: 'PERCENTAGE', value: '' });
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [submitting, setSubmitting] = useState(false);
  const [confirmTotal, setConfirmTotal] = useState(null);
  const [overrideFor, setOverrideFor] = useState(null);
  const [completedSale, setCompletedSale] = useState(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey('sale'));
  const searchRef = useRef(null);
  const debounced = useDebouncedValue(term.trim(), 200);
  const branchId = branchParam;

  const results = useApi(
    () => api.get('/medicines/search', { branchId, q: debounced || undefined, categoryId: categoryId || undefined, productType: productType || undefined, limit: 30 }).then((r) => r.data),
    [branchId, debounced, categoryId, productType],
    { enabled: Boolean(branchId) },
  );

  // Any change to the cart is a new sale attempt with a new idempotency key.
  useEffect(() => setIdempotencyKey(newIdempotencyKey('sale')), [cart, discount, paymentMethod]);
  // A different branch means a different price list and stock: start over.
  useEffect(() => setCart([]), [branchId]);

  const addToCart = (m) => {
    if (m.sellableQuantity <= 0) {
      toast.error(`${m.name} is out of stock at this branch.`);
      return;
    }
    setCart((list) => {
      const existing = list.find((l) => l.medicineId === m.id);
      if (existing) {
        if (existing.quantity >= m.sellableQuantity) {
          toast.error(`Only ${m.sellableQuantity} unit(s) of ${m.name} available.`);
          return list;
        }
        return list.map((l) => (l.medicineId === m.id ? { ...l, quantity: l.quantity + 1, batchAllocations: undefined } : l));
      }
      return [...list, {
        medicineId: m.id,
        name: m.name,
        detail: [m.strength, m.dosageForm, m.packageSize].filter(Boolean).join(' · '),
        unitPrice: m.nextPrice,
        priceVaries: m.priceVaries,
        available: m.sellableQuantity,
        prescriptionRequired: m.prescriptionRequired,
        quantity: 1,
      }];
    });
  };

  const onSearchKey = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const rows = results.data || [];
    const exact = rows.find((m) => m.barcodeMatch) || (rows.length === 1 ? rows[0] : null);
    if (exact) {
      addToCart(exact);
      setTerm('');
    }
  };

  const setQuantity = (medicineId, value) => {
    setCart((list) => list.map((l) => {
      if (l.medicineId !== medicineId) return l;
      const q = Math.max(1, Math.min(l.available, Math.trunc(Number(value) || 1)));
      return { ...l, quantity: q, batchAllocations: undefined, fefoOverrideReason: undefined };
    }));
  };

  const canDiscount = can('SALES_APPLY_DISCOUNT');
  const activeDiscount = canDiscount && Number(discount.value) > 0 ? discount : null;
  const totals = useMemo(() => estimateTotals(cart, activeDiscount, pharmacy && pharmacy.tax), [cart, activeDiscount, pharmacy]);
  const prescriptionItems = cart.filter((l) => l.prescriptionRequired);

  const complete = async (amountPaid = totals.total) => {
    setSubmitting(true);
    try {
      const res = await api.post('/sales', {
        branchId,
        items: cart.map((l) => ({
          medicineId: l.medicineId,
          quantity: l.quantity,
          ...(l.batchAllocations ? { batchAllocations: l.batchAllocations, fefoOverrideReason: l.fefoOverrideReason } : {}),
        })),
        discount: activeDiscount,
        paymentMethod,
        amountPaid,
      }, { idempotencyKey });
      setCompletedSale(res.data);
      setCart([]);
      setDiscount({ type: 'PERCENTAGE', value: '' });
      setConfirmTotal(null);
      toast.success(`Sale ${res.data.receiptNumber} completed.`);
      results.reload({ silent: true });
    } catch (err) {
      if (err.code === 'INVALID_PAYMENT_AMOUNT' && err.details.total) {
        // Batch prices differ from the estimate: confirm the exact server total.
        setConfirmTotal(err.details.total);
      } else {
        toast.error(err.code === 'INSUFFICIENT_STOCK' && err.details.medicineName
          ? `Not enough ${err.details.medicineName} in stock (available: ${err.details.available}).`
          : err.message);
        if (err.code === 'INSUFFICIENT_STOCK') results.reload({ silent: true });
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!branchId) {
    return (
      <div className="stack">
        <PageHeader title="Point of sale" />
        <Panel><EmptyState icon={Store} title={isAllBranches ? 'Choose a branch to sell from' : 'No active branch'}
          message={isAllBranches ? 'Sales are always recorded against one branch. Pick it in the branch selector at the top.' : 'You are not assigned to an active branch.'} /></Panel>
      </div>
    );
  }

  return (
    <div className="stack">
      <PageHeader title="Point of sale" description={selectedBranch ? selectedBranch.name : ''} actions={<LearnHow slug="using-the-pos" />} />
      <div className="pos">
        <Panel flush>
          <FilterToolbar>
            <div className="field search-field">
              <span className="field-label">Search or scan</span>
              <div className="input-with-icon">
                <ScanBarcode aria-hidden="true" />
                <input ref={searchRef} className="input" type="search" autoFocus placeholder="Name or barcode, then Enter"
                  value={term} onChange={(e) => setTerm(e.target.value)} onKeyDown={onSearchKey} aria-label="Search or scan medicine" />
              </div>
            </div>
            <SelectInput label="Type" value={productType} placeholder="All products" options={PRODUCT_TYPE_OPTIONS}
              onChange={(e) => { setProductType(e.target.value); setCategoryId(''); }} />
            <SelectInput label="Category" value={categoryId} placeholder="All categories"
              options={toOptions((categories.data || []).filter((c) => !productType || c.productType === productType))} onChange={(e) => setCategoryId(e.target.value)} />
          </FilterToolbar>
          <div className="pos-results" aria-busy={results.loading || undefined}>
            {results.error && <ErrorState error={results.error} onRetry={results.reload} />}
            {!results.data && !results.error && <SkeletonRows rows={6} columns={3} />}
            {results.data && results.data.length === 0 && (
              <EmptyState title={debounced ? 'No matching products' : 'No active products'} message={debounced ? 'Check the spelling or scan the barcode again.' : 'Active medicines and cosmetics with stock appear here.'} />
            )}
            {results.data && results.data.map((m) => (
              <button key={m.id} type="button" className="pos-item" onClick={() => addToCart(m)} disabled={m.sellableQuantity <= 0}>
                <span className="grow stack-sm" style={{ gap: 2 }}>
                  <span className="row-wrap">
                    <strong>{m.name}</strong>
                    {m.prescriptionRequired && <Badge tone="info">Rx</Badge>}
                    {m.sellableQuantity <= 0 && <Badge tone="danger">Out of stock</Badge>}
                  </span>
                  <span className="small muted">{[m.productType === 'COSMETIC' && 'Cosmetic', m.brandName, m.strength, m.dosageForm, m.packageSize, m.categoryName].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="stack-sm" style={{ gap: 2, alignItems: 'flex-end' }}>
                  <strong className="nowrap">{m.nextPrice ? formatMoney(m.nextPrice) : '—'}</strong>
                  <span className="small muted nowrap">{formatNumber(m.sellableQuantity)} in stock{m.priceVaries ? ' · price varies' : ''}</span>
                </span>
              </button>
            ))}
          </div>
        </Panel>

        <Panel className="cart" title={<span className="row"><ShoppingCart size={18} aria-hidden="true" /> <h2>Cart</h2></span>}
          actions={cart.length > 0 && <Button variant="ghost" size="sm" onClick={() => setCart([])}>Clear</Button>} flush>
          {cart.length === 0 ? (
            <EmptyState title="Cart is empty" message="Search or scan a medicine to add it." />
          ) : (
            <div className="cart-lines">
              {cart.map((l) => (
                <div key={l.medicineId} className="cart-line">
                  <div className="stack-sm" style={{ gap: 2 }}>
                    <strong>{l.name} {l.prescriptionRequired && <Badge tone="info">Rx</Badge>}</strong>
                    <span className="small muted">{l.detail}</span>
                    <span className="small">{formatMoney(l.unitPrice)} each{l.priceVaries ? ' (varies by batch)' : ''}</span>
                    {l.batchAllocations && <span className="small warning-text">Batches chosen manually</span>}
                  </div>
                  <IconButton icon={Trash2} label={`Remove ${l.name}`} onClick={() => setCart((list) => list.filter((x) => x.medicineId !== l.medicineId))} />
                  <div className="row">
                    <div className="qty-control">
                      <button type="button" aria-label="Decrease" onClick={() => setQuantity(l.medicineId, l.quantity - 1)}><Minus size={14} /></button>
                      <input value={l.quantity} inputMode="numeric" aria-label={`Quantity of ${l.name}`} onChange={(e) => setQuantity(l.medicineId, e.target.value)} />
                      <button type="button" aria-label="Increase" onClick={() => setQuantity(l.medicineId, l.quantity + 1)} disabled={l.quantity >= l.available}><Plus size={14} /></button>
                    </div>
                    {can('SALES_OVERRIDE_FEFO') && <IconButton icon={Layers} label="Choose batches" onClick={() => setOverrideFor(l)} />}
                  </div>
                  <strong className="num">{formatMoney(fromCents(toCents(l.unitPrice) * l.quantity))}</strong>
                </div>
              ))}
            </div>
          )}

          {prescriptionItems.length > 0 && (
            <div style={{ padding: '10px 14px' }}>
              <InlineAlert tone="warning" icon={AlertTriangle}>
                Prescription required: {prescriptionItems.map((l) => l.name).join(', ')}. Check the customer’s prescription before completing the sale.
              </InlineAlert>
            </div>
          )}

          {canDiscount && cart.length > 0 && (
            <div className="row" style={{ padding: '10px 14px', borderTop: '1px solid var(--border)' }}>
              <span className="small muted grow">Discount</span>
              <select className="select" style={{ width: 90 }} value={discount.type} onChange={(e) => setDiscount({ ...discount, type: e.target.value })} aria-label="Discount type">
                <option value="PERCENTAGE">%</option>
                <option value="FIXED">Amount</option>
              </select>
              <input className="input" style={{ width: 100 }} inputMode="decimal" placeholder="0" value={discount.value} onChange={(e) => setDiscount({ ...discount, value: e.target.value })} aria-label="Discount value" />
            </div>
          )}

          <div className="totals">
            <div className="line"><span>Subtotal</span><span>{formatMoney(totals.subtotal)}</span></div>
            {Number(totals.discount) > 0 && <div className="line"><span>Discount</span><span>-{formatMoney(totals.discount)}</span></div>}
            {pharmacy && pharmacy.tax.enabled && (
              <div className="line muted"><span>{pharmacy.tax.name} {Number(pharmacy.tax.rate)}%{pharmacy.tax.mode === 'INCLUDED' ? ' (included)' : ''}</span><span>{formatMoney(totals.tax)}</span></div>
            )}
            <div className="line grand"><span>Total</span><span>{formatMoney(totals.total)}</span></div>
          </div>

          <div className="stack-sm" style={{ padding: '0 14px 14px' }}>
            <div className="segmented" role="radiogroup" aria-label="Payment method">
              {[['CASH', 'Cash'], ['BANK_TRANSFER', 'Bank transfer']].map(([value, label]) => (
                <button key={value} type="button" role="radio" aria-checked={paymentMethod === value} className={paymentMethod === value ? 'active' : ''} onClick={() => setPaymentMethod(value)}>{label}</button>
              ))}
            </div>
            <p className="small muted">Payment must equal the total. The final amount is confirmed by the server.</p>
            <Button size="lg" block onClick={() => complete()} loading={submitting} disabled={cart.length === 0}>
              Complete sale · {formatMoney(totals.total)}
            </Button>
          </div>
        </Panel>
      </div>

      {overrideFor && (
        <BatchOverrideModal line={overrideFor} branchId={branchId} onClose={() => setOverrideFor(null)} onApply={(choice) => {
          setCart((list) => list.map((l) => (l.medicineId === overrideFor.medicineId
            ? { ...l, batchAllocations: choice ? choice.batchAllocations : undefined, fefoOverrideReason: choice ? choice.fefoOverrideReason : undefined }
            : l)));
          setOverrideFor(null);
        }} />
      )}

      <Modal open={Boolean(confirmTotal)} title="Confirm total" onClose={() => setConfirmTotal(null)} closeDisabled={submitting}
        footer={<><Button variant="secondary" onClick={() => setConfirmTotal(null)} disabled={submitting}>Back</Button><Button onClick={() => complete(confirmTotal)} loading={submitting}>Take payment of {formatMoney(confirmTotal)}</Button></>}>
        <p>Some units come from batches with a different selling price, so the exact total is <strong>{formatMoney(confirmTotal)}</strong> (estimate was {formatMoney(totals.total)}).</p>
      </Modal>

      {completedSale && (
        <ReceiptModal saleId={completedSale.id} onClose={() => { setCompletedSale(null); if (searchRef.current) searchRef.current.focus(); }} />
      )}
    </div>
  );
}
