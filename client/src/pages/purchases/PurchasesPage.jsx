import { useNavigate } from 'react-router-dom';
import { Plus, Truck } from 'lucide-react';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useListState } from '../../hooks/useListState.js';
import { useSuppliers, toOptions } from '../../hooks/useLookups.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Can } from '../../permissions/Can.jsx';
import { PageHeader, Panel, DataTable, Pagination, Button, StatusBadge, EmptyState, SelectInput } from '../../components/ui/index.js';
import { formatDate, formatMoney, formatNumber, humanize } from '../../utils/format.js';

const STATUSES = ['DRAFT', 'PENDING', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'].map((s) => ({ value: s, label: humanize(s) }));
const PAYMENT = ['UNPAID', 'PARTIALLY_PAID', 'PAID'].map((s) => ({ value: s, label: humanize(s) }));

export default function PurchasesPage() {
  const navigate = useNavigate();
  const { branchParam, can } = useAuth();
  const suppliers = useSuppliers();
  const { state, update, clear, hasFilters } = useListState();
  const params = { ...state, branchId: branchParam };
  const list = useApi(() => api.get('/purchases', params), [JSON.stringify(params)]);
  const showCost = can('FINANCIAL_VIEW_PURCHASE_COST');

  return (
    <div className="stack">
      <PageHeader title="Purchases" description="Orders to suppliers. Stock only changes when items are received."
        actions={<Can permission="PURCHASE_CREATE"><Button icon={Plus} onClick={() => navigate('/purchases/new')}>New purchase</Button></Can>} />
      <Panel flush>
        <div className="toolbar">
          <div className="field search-field">
            <span className="field-label">Search</span>
            <input className="input" type="search" placeholder="Purchase number or supplier" defaultValue={state.search || ''} onChange={(e) => update({ search: e.target.value })} aria-label="Search purchases" />
          </div>
          <SelectInput label="Supplier" value={state.supplierId || ''} placeholder="All suppliers" options={toOptions(suppliers.data, 'companyName')} onChange={(e) => update({ supplierId: e.target.value })} />
          <SelectInput label="Status" value={state.status || ''} placeholder="All" options={STATUSES} onChange={(e) => update({ status: e.target.value })} />
          <SelectInput label="Payment" value={state.paymentStatus || ''} placeholder="All" options={PAYMENT} onChange={(e) => update({ paymentStatus: e.target.value })} />
          <div className="field"><span className="field-label">From</span><input className="input" type="date" value={state.dateFrom || ''} onChange={(e) => update({ dateFrom: e.target.value })} /></div>
          <div className="field"><span className="field-label">To</span><input className="input" type="date" value={state.dateTo || ''} onChange={(e) => update({ dateTo: e.target.value })} /></div>
        </div>
        <DataTable rows={list.data && list.data.data} loading={list.loading} error={list.error} onRetry={list.reload}
          sort={state} onSort={update} filtered={hasFilters} isSearch={Boolean(state.search)} onClearFilters={clear}
          onRowClick={(p) => navigate(`/purchases/${p.id}`)}
          columns={[
            { key: 'purchaseNumber', label: 'Purchase', sortable: true, render: (p) => <span className="mono">{p.purchaseNumber}</span> },
            { key: 'purchaseDate', label: 'Date', sortable: true, render: (p) => formatDate(p.purchaseDate) },
            { key: 'supplierName', label: 'Supplier', sortable: true },
            { key: 'branchName', label: 'Branch' },
            { key: 'itemCount', label: 'Items', align: 'right', render: (p) => formatNumber(p.itemCount) },
            { key: 'status', label: 'Status', sortable: true, render: (p) => <StatusBadge status={p.status} /> },
            { key: 'paymentStatus', label: 'Payment', render: (p) => (p.paymentStatus ? <StatusBadge status={p.paymentStatus} /> : '—') },
            showCost && { key: 'total', label: 'Total', align: 'right', sortable: true, render: (p) => formatMoney(p.total) },
          ].filter(Boolean)}
          empty={<EmptyState icon={Truck} title="No purchases yet" message="Create a purchase order, then receive stock when it arrives."
            action={<Can permission="PURCHASE_CREATE"><Button icon={Plus} onClick={() => navigate('/purchases/new')}>New purchase</Button></Can>} learnHow="purchasing-and-receiving" />} />
        <Pagination pagination={list.data && list.data.pagination} onChange={(page) => update({ page }, { resetPage: false })} />
      </Panel>
    </div>
  );
}
