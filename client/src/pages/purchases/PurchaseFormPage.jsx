import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useAction } from '../../hooks/useAction.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useSuppliers, toOptions } from '../../hooks/useLookups.js';
import { PageHeader, Panel, Button, SelectInput, TextInput, TextArea, IconButton, InlineAlert, ErrorState, SkeletonRows, EmptyState, LearnHow } from '../../components/ui/index.js';
import { MedicinePicker } from '../../components/MedicinePicker.jsx';
import { formatMoney, todayIso } from '../../utils/format.js';
import { toCents, fromCents } from '../../utils/money.js';

function lineTotal(item) {
  return toCents(item.unitPurchasePrice || '0') * (Number(item.orderedQuantity) || 0) - toCents(item.discount || '0') + toCents(item.tax || '0');
}

/** Create or edit a purchase (edit only before anything is received). */
export default function PurchaseFormPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { activeBranches, branchParam } = useAuth();
  const suppliers = useSuppliers();
  const existing = useApi(() => api.get(`/purchases/${id}`).then((r) => r.data), [id], { enabled: Boolean(id) });
  const action = useAction();

  const [form, setForm] = useState({
    supplierId: search.get('supplierId') || '',
    branchId: branchParam || (activeBranches[0] && activeBranches[0].id) || '',
    purchaseDate: todayIso(),
    expectedDate: '',
    notes: '',
  });
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (!existing.data) return;
    const p = existing.data;
    setForm({ supplierId: p.supplierId, branchId: p.branchId, purchaseDate: p.purchaseDate, expectedDate: p.expectedDate || '', notes: p.notes || '' });
    setItems(p.items.map((i) => ({
      medicineId: i.medicineId, medicineName: i.medicineName, orderedQuantity: String(i.orderedQuantity),
      unitPurchasePrice: i.unitPurchasePrice, discount: i.discount, tax: i.tax, notes: i.notes || '',
    })));
  }, [existing.data]);

  const totalCents = useMemo(() => items.reduce((sum, i) => sum + lineTotal(i), 0), [items]);
  const setItem = (index, key, value) => setItems((list) => list.map((item, i) => (i === index ? { ...item, [key]: value } : item)));

  const save = async (status) => {
    const payload = {
      supplierId: form.supplierId,
      purchaseDate: form.purchaseDate,
      expectedDate: form.expectedDate || null,
      notes: form.notes || null,
      status,
      items: items.map((i) => ({
        medicineId: i.medicineId,
        orderedQuantity: Number(i.orderedQuantity),
        unitPurchasePrice: i.unitPurchasePrice,
        discount: i.discount || '0',
        tax: i.tax || '0',
        notes: i.notes || null,
      })),
    };
    const call = id ? () => api.patch(`/purchases/${id}`, payload) : () => api.post('/purchases', { ...payload, branchId: form.branchId });
    const result = await action.run(call, { success: status === 'PENDING' ? 'Purchase submitted.' : 'Purchase saved as draft.' });
    if (result) navigate(`/purchases/${result.data.id}`, { replace: true });
  };

  if (id && existing.error) return <Panel><ErrorState error={existing.error} onRetry={existing.reload} /></Panel>;
  if (id && !existing.data) return <Panel><SkeletonRows /></Panel>;
  const editingPending = existing.data && existing.data.status === 'PENDING';
  const errors = action.fieldErrors;

  return (
    <div className="stack">
      <PageHeader
        title={id ? `Edit ${existing.data.purchaseNumber}` : 'New purchase'}
        breadcrumbs={[{ label: 'Purchases', to: '/purchases' }, { label: id ? existing.data.purchaseNumber : 'New' }]}
        actions={<LearnHow slug="purchasing-and-receiving" />}
      />
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

      <Panel title="Medicines" flush footer={<div className="spread"><span className="muted">Estimated total (the server calculates the final amount)</span><strong>{formatMoney(fromCents(totalCents))}</strong></div>}>
        <div className="panel-body"><MedicinePicker exclude={items.map((i) => i.medicineId)} onSelect={(m) => setItems((list) => [...list, {
          medicineId: m.id, medicineName: `${m.name}${m.strength ? ` ${m.strength}` : ''}`, orderedQuantity: '', unitPurchasePrice: '', discount: '', tax: '', notes: '',
        }])} /></div>
        {items.length === 0 ? (
          <EmptyState title="No medicines added" message="Search above to add the medicines you are ordering. Only active medicines can be purchased." />
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr><th>Medicine</th><th className="num">Quantity</th><th className="num">Unit cost</th><th className="num">Discount</th><th className="num">Tax</th><th className="num">Line total</th><th /></tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={item.medicineId}>
                    <td data-label="Medicine" className="cell-strong">{item.medicineName}</td>
                    <td data-label="Quantity"><input className="input" style={{ width: 90 }} type="number" min="1" value={item.orderedQuantity} aria-label="Quantity"
                      aria-invalid={errors[`items.${index}.orderedQuantity`] ? 'true' : undefined} onChange={(e) => setItem(index, 'orderedQuantity', e.target.value)} /></td>
                    <td data-label="Unit cost"><input className="input" style={{ width: 100 }} inputMode="decimal" value={item.unitPurchasePrice} aria-label="Unit cost"
                      aria-invalid={errors[`items.${index}.unitPurchasePrice`] ? 'true' : undefined} onChange={(e) => setItem(index, 'unitPurchasePrice', e.target.value)} /></td>
                    <td data-label="Discount"><input className="input" style={{ width: 90 }} inputMode="decimal" value={item.discount} placeholder="0.00" aria-label="Discount"
                      aria-invalid={errors[`items.${index}.discount`] ? 'true' : undefined} onChange={(e) => setItem(index, 'discount', e.target.value)} /></td>
                    <td data-label="Tax"><input className="input" style={{ width: 90 }} inputMode="decimal" value={item.tax} placeholder="0.00" aria-label="Tax"
                      onChange={(e) => setItem(index, 'tax', e.target.value)} /></td>
                    <td data-label="Line total" className="num">{formatMoney(fromCents(lineTotal(item)))}</td>
                    <td data-label=""><IconButton icon={Trash2} label="Remove" onClick={() => setItems((list) => list.filter((_, i) => i !== index))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {Object.keys(errors).some((k) => k.startsWith('items')) && <InlineAlert tone="danger">Check the highlighted item quantities and prices.</InlineAlert>}
      <div className="form-actions">
        <Button variant="secondary" onClick={() => navigate(-1)} disabled={action.running}>Cancel</Button>
        {!editingPending && <Button variant="secondary" onClick={() => save('DRAFT')} loading={action.running} disabled={items.length === 0}>Save draft</Button>}
        <Button onClick={() => save('PENDING')} loading={action.running} disabled={items.length === 0}>{editingPending ? 'Save changes' : 'Submit order'}</Button>
      </div>
    </div>
  );
}
