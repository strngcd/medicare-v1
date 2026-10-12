import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2, Search } from 'lucide-react';
import { api } from '../../api/client.js';
import { useApi, useDebouncedValue } from '../../hooks/useApi.js';
import { useAction } from '../../hooks/useAction.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Panel, Button, SelectInput, TextArea, DataTable, EmptyState, IconButton, InlineAlert, LearnHow } from '../../components/ui/index.js';
import { formatDate, formatNumber } from '../../utils/format.js';

export default function TransferCreatePage() {
  const navigate = useNavigate();
  const { activeBranches, branchParam } = useAuth();
  const context = useApi(() => api.get('/branches/context').then((r) => r.data), []);
  const destinations = (context.data && context.data.transferDestinations) || [];
  const [sourceBranchId, setSource] = useState(branchParam || '');
  const [destinationBranchId, setDestination] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([]);
  const [term, setTerm] = useState('');
  const debounced = useDebouncedValue(term.trim(), 250);
  const action = useAction();

  const stock = useApi(
    () => api.get('/inventory', { branchId: sourceBranchId, search: debounced || undefined, status: undefined, limit: 20 }).then((r) => r.data),
    [sourceBranchId, debounced],
    { enabled: Boolean(sourceBranchId) },
  );
  const sellable = (stock.data || []).filter((r) => r.quantity > 0 && r.status !== 'EXPIRED' && !items.some((i) => i.batchId === r.batchId));

  const submit = async (request) => {
    const result = await action.run(() => api.post('/transfers', {
      sourceBranchId, destinationBranchId, notes: notes || undefined,
      items: items.map((i) => ({ batchId: i.batchId, requestedQuantity: Number(i.requestedQuantity) })),
    }));
    if (!result) return;
    if (request) await action.run(() => api.post(`/transfers/${result.data.id}/request`), { success: 'Transfer requested.' });
    navigate(`/transfers/${result.data.id}`, { replace: true });
  };

  // Push model: the source is one of your branches (you need to see its stock); the destination can be any active branch.
  const sourceOptions = activeBranches.map((b) => ({ value: b.id, label: b.name }));
  const destinationOptions = destinations.filter((b) => b.id !== sourceBranchId).map((b) => ({ value: b.id, label: b.name }));
  return (
    <div className="stack">
      <PageHeader title="New transfer" breadcrumbs={[{ label: 'Transfers', to: '/transfers' }, { label: 'New' }]} actions={<LearnHow slug="branch-transfers" />} />
      <Panel title="Route">
        <div className="form-grid">
          <SelectInput label="From (source)" required value={sourceBranchId} placeholder="Select branch" options={sourceOptions}
            onChange={(e) => { setSource(e.target.value); setItems([]); }} />
          <SelectInput label="To (destination)" required value={destinationBranchId} placeholder="Select branch"
            options={destinationOptions} onChange={(e) => setDestination(e.target.value)} />
          <TextArea label="Notes" rows={2} fieldClassName="span-2" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </Panel>

      {sourceBranchId && (
        <Panel title="Available batches at source" flush>
          <div className="toolbar">
            <div className="field search-field">
              <span className="field-label">Search</span>
              <div className="input-with-icon"><Search aria-hidden="true" />
                <input className="input" type="search" placeholder="Medicine or batch" value={term} onChange={(e) => setTerm(e.target.value)} />
              </div>
            </div>
          </div>
          <DataTable rows={stock.data ? sellable : null} loading={stock.loading} error={stock.error} onRetry={stock.reload}
            rowKey="id"
            onRowClick={(r) => setItems((list) => [...list, { batchId: r.batchId, medicineName: r.medicineName, batchNumber: r.batchNumber, expiryDate: r.expiryDate, available: r.quantity, requestedQuantity: '' }])}
            columns={[
              { key: 'medicineName', label: 'Medicine', render: (r) => <span className="cell-strong">{r.medicineName}</span> },
              { key: 'batchNumber', label: 'Batch', render: (r) => <span className="mono">{r.batchNumber || '—'}</span> },
              { key: 'expiryDate', label: 'Expiry', render: (r) => formatDate(r.expiryDate) },
              { key: 'quantity', label: 'Available', align: 'right', render: (r) => formatNumber(r.quantity) },
            ]}
            filtered={Boolean(debounced)} isSearch
            empty={<EmptyState title="No transferable stock" message="Only non-expired batches with stock can be transferred." />} />
        </Panel>
      )}

      <Panel title="Batches to transfer" flush>
        {items.length === 0 ? (
          <EmptyState title="Nothing selected" message="Click a batch above to add it." />
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>Medicine</th><th>Batch</th><th>Expiry</th><th className="num">Available</th><th className="num">Request</th><th /></tr></thead>
              <tbody>
                {items.map((i, index) => (
                  <tr key={i.batchId}>
                    <td data-label="Medicine" className="cell-strong">{i.medicineName}</td>
                    <td data-label="Batch" className="mono">{i.batchNumber}</td>
                    <td data-label="Expiry">{formatDate(i.expiryDate)}</td>
                    <td data-label="Available" className="num">{formatNumber(i.available)}</td>
                    <td data-label="Request" className="num">
                      <input className="input" style={{ width: 90 }} type="number" min="1" max={i.available} value={i.requestedQuantity} aria-label="Requested quantity"
                        onChange={(e) => setItems((list) => list.map((x, j) => (j === index ? { ...x, requestedQuantity: e.target.value } : x)))} />
                    </td>
                    <td data-label=""><IconButton icon={Trash2} label="Remove" onClick={() => setItems((list) => list.filter((_, j) => j !== index))} /></td>
                  </tr>
                ))}
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
