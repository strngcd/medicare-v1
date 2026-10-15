import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2, Search } from 'lucide-react';
import { api } from '../../api/client.js';
import { useApi, useDebouncedValue } from '../../hooks/useApi.js';
import { useAction } from '../../hooks/useAction.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useCategories, toOptions } from '../../hooks/useLookups.js';
import { PageHeader, Panel, Button, SelectInput, TextArea, DataTable, Pagination, EmptyState, IconButton, InlineAlert, LearnHow, FilterToolbar } from '../../components/ui/index.js';
import { ProductName } from '../../components/ProductName.jsx';
import { formatDate, formatNumber, PRODUCT_TYPE_OPTIONS } from '../../utils/format.js';

/** Client-side check of one requested quantity; the server re-validates. */
function quantityError(item) {
  const raw = String(item.requestedQuantity ?? '').trim();
  if (!raw) return 'Enter a quantity.';
  const q = Number(raw);
  if (!Number.isInteger(q) || q < 1) return 'Enter a whole number of at least 1.';
  if (q > item.available) return `Only ${formatNumber(item.available)} available.`;
  return null;
}

export default function TransferCreatePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { activeBranches, branchParam } = useAuth();
  const context = useApi(() => api.get('/branches/context').then((r) => r.data), []);
  const destinations = (context.data && context.data.transferDestinations) || [];
  const [sourceBranchId, setSource] = useState(branchParam || '');
  const [destinationBranchId, setDestination] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([]);
  const [term, setTerm] = useState('');
  const [productType, setProductType] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);
  const [itemErrors, setItemErrors] = useState({});
  const categories = useCategories(productType || undefined);
  const debounced = useDebouncedValue(term.trim(), 250);
  const action = useAction();

  const filters = { search: debounced || undefined, productType: productType || undefined, categoryId: categoryId || undefined };
  const stock = useApi(
    () => api.get('/inventory', { branchId: sourceBranchId, inStock: true, ...filters, page, limit: 20, sortBy: 'medicineName', sortOrder: 'asc' }),
    [sourceBranchId, JSON.stringify(filters), page],
    { enabled: Boolean(sourceBranchId) },
  );
  const sellable = stock.data ? stock.data.data.filter((r) => !items.some((i) => i.batchId === r.batchId)) : null;
  const changeFilter = (setter) => (e) => { setter(e.target.value); setPage(1); };

  // Errors for each batch line, from the local check or the server's field errors.
  const errorFor = (item, index) => itemErrors[item.batchId] || action.fieldErrors[`items.${index}.requestedQuantity`];

  const submit = async (request) => {
    const problems = Object.fromEntries(items.map((i) => [i.batchId, quantityError(i)]).filter(([, e]) => e));
    setItemErrors(problems);
    if (Object.keys(problems).length) {
      toast.error('Enter a valid quantity for each highlighted batch.');
      return;
    }
    const result = await action.run(() => api.post('/transfers', {
      sourceBranchId, destinationBranchId, notes: notes || undefined,
      items: items.map((i) => ({ batchId: i.batchId, requestedQuantity: Number(i.requestedQuantity) })),
    }));
    if (!result) return;
    if (request) await action.run(() => api.post(`/transfers/${result.data.id}/request`), { success: 'Transfer requested.' });
    navigate(`/transfers/${result.data.id}`, { replace: true });
  };

  const setQuantity = (batchId, value) => {
    setItems((list) => list.map((x) => (x.batchId === batchId ? { ...x, requestedQuantity: value } : x)));
    setItemErrors(({ [batchId]: _cleared, ...rest }) => rest);
  };

  // Push model: the source is one of your branches (you need to see its stock); the destination can be any active branch.
  const sourceOptions = activeBranches.map((b) => ({ value: b.id, label: b.name }));
  const destinationOptions = destinations.filter((b) => b.id !== sourceBranchId).map((b) => ({ value: b.id, label: b.name }));
  const hasFilters = Boolean(debounced || productType || categoryId);
  return (
    <div className="stack">
      <PageHeader title="New transfer" breadcrumbs={[{ label: 'Transfers', to: '/transfers' }, { label: 'New' }]} actions={<LearnHow slug="branch-transfers" />} />
      <Panel title="Route">
        <div className="form-grid">
          <SelectInput label="From (source)" required value={sourceBranchId} placeholder="Select branch" options={sourceOptions}
            onChange={(e) => { setSource(e.target.value); setItems([]); setItemErrors({}); setPage(1); }} />
          <SelectInput label="To (destination)" required value={destinationBranchId} placeholder="Select branch"
            options={destinationOptions} onChange={(e) => setDestination(e.target.value)} error={action.fieldErrors.destinationBranchId} />
          <TextArea label="Notes" rows={2} fieldClassName="span-2" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </Panel>

      {sourceBranchId && (
        <Panel title="Available batches at source" flush>
          <FilterToolbar>
            <div className="field search-field">
              <span className="field-label">Search</span>
              <div className="input-with-icon"><Search aria-hidden="true" />
                <input className="input" type="search" placeholder="Medicine, batch or barcode" value={term} onChange={changeFilter(setTerm)} />
              </div>
            </div>
            <SelectInput label="Type" value={productType} placeholder="All products" options={PRODUCT_TYPE_OPTIONS}
              onChange={(e) => { setProductType(e.target.value); setCategoryId(''); setPage(1); }} />
            <SelectInput label="Category" value={categoryId} placeholder="All categories" options={toOptions(categories.data)} onChange={changeFilter(setCategoryId)} />
          </FilterToolbar>
          <DataTable rows={sellable} loading={stock.loading} error={stock.error} onRetry={stock.reload}
            rowKey="id"
            onRowClick={(r) => setItems((list) => [...list, {
              batchId: r.batchId, medicineName: r.medicineName, strength: r.strength, dosageForm: r.dosageForm, packageSize: r.packageSize,
              productType: r.productType, batchNumber: r.batchNumber, expiryDate: r.expiryDate, available: r.quantity, requestedQuantity: '',
            }])}
            columns={[
              { key: 'medicineName', label: 'Product', render: (r) => <ProductName row={r} /> },
              { key: 'categoryName', label: 'Category', render: (r) => r.categoryName || '—' },
              { key: 'batchNumber', label: 'Batch', render: (r) => <span className="mono">{r.batchNumber || '—'}</span> },
              { key: 'expiryDate', label: 'Expiry', render: (r) => formatDate(r.expiryDate) },
              { key: 'quantity', label: 'Available', align: 'right', render: (r) => formatNumber(r.quantity) },
            ]}
            filtered={hasFilters} isSearch={Boolean(debounced)}
            onClearFilters={() => { setTerm(''); setProductType(''); setCategoryId(''); setPage(1); }}
            empty={<EmptyState title="No transferable stock" message="Only non-expired batches with stock can be transferred." />} />
          <Pagination pagination={stock.data && stock.data.pagination} onChange={setPage} />
        </Panel>
      )}

      <Panel title="Batches to transfer" flush>
        {items.length === 0 ? (
          <EmptyState title="Nothing selected" message="Click a batch above to add it." />
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>Product</th><th>Batch</th><th>Expiry</th><th className="num">Available</th><th className="num">Request</th><th /></tr></thead>
              <tbody>
                {items.map((i, index) => {
                  const error = errorFor(i, index);
                  return (
                    <tr key={i.batchId}>
                      <td data-label="Product"><ProductName row={i} /></td>
                      <td data-label="Batch" className="mono">{i.batchNumber}</td>
                      <td data-label="Expiry">{formatDate(i.expiryDate)}</td>
                      <td data-label="Available" className="num">{formatNumber(i.available)}</td>
                      <td data-label="Request" className="num">
                        <span className="stack-sm" style={{ gap: 2, alignItems: 'flex-end' }}>
                          <input className="input" style={{ width: 90 }} type="number" min="1" max={i.available} value={i.requestedQuantity}
                            aria-label="Requested quantity" aria-invalid={error ? 'true' : undefined}
                            onChange={(e) => setQuantity(i.batchId, e.target.value)} />
                          {error && <span className="field-error">{error}</span>}
                        </span>
                      </td>
                      <td data-label=""><IconButton icon={Trash2} label="Remove" onClick={() => {
                        setItems((list) => list.filter((x) => x.batchId !== i.batchId));
                        setItemErrors(({ [i.batchId]: _removed, ...rest }) => rest);
                      }} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {action.error && action.error.code === 'TRANSFER_INSUFFICIENT_STOCK' && <InlineAlert tone="danger">{action.error.message}</InlineAlert>}
      <div className="form-actions">
        <Button variant="secondary" onClick={() => navigate('/transfers')}>Cancel</Button>
        <Button variant="secondary" onClick={() => submit(false)} loading={action.running} disabled={!items.length || !destinationBranchId}>Save draft</Button>
        <Button onClick={() => submit(true)} loading={action.running} disabled={!items.length || !destinationBranchId}>Create and request</Button>
      </div>
    </div>
  );
}
