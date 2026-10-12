import { useNavigate } from 'react-router-dom';
import { Receipt } from 'lucide-react';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useListState } from '../../hooks/useListState.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useCategories, toOptions } from '../../hooks/useLookups.js';
import { PageHeader, Panel, DataTable, Pagination, StatusBadge, EmptyState, SelectInput, Tabs, Button, FilterToolbar } from '../../components/ui/index.js';
import { formatDateTime, formatMoney, formatNumber, humanize } from '../../utils/format.js';

export default function SalesPage() {
  const navigate = useNavigate();
  const { branchParam, can } = useAuth();
  const categories = useCategories();
  const canHistory = can('SALES_VIEW_HISTORY');
  const { state, update, clear, hasFilters } = useListState({ view: canHistory ? 'all' : 'mine' });
  const view = canHistory ? state.view || 'all' : 'mine';
  const params = { ...state, view: undefined, branchId: branchParam };
  const list = useApi(() => api.get(view === 'mine' ? '/sales/my' : '/sales', params), [view, JSON.stringify(params)]);

  const staff = useApi(() => (canHistory && can('STAFF_VIEW') ? api.get('/users', { limit: 100, branchId: branchParam }).then((r) => r.data) : Promise.resolve([])), [branchParam]);

  return (
    <div className="stack">
      <PageHeader title="Sales" description="Completed and voided sales. Open a sale to reprint, refund or void it."
        actions={can('SALES_CREATE') && <Button onClick={() => navigate('/pos')}>Open POS</Button>} />
      <Panel flush>
        {canHistory && <Tabs tabs={[{ value: 'all', label: 'All sales' }, { value: 'mine', label: 'My sales' }]} active={view} onChange={(v) => update({ view: v })} />}
        <FilterToolbar>
          <div className="field search-field">
            <span className="field-label">Receipt number</span>
            <input className="input" type="search" placeholder="SAL-…" defaultValue={state.receiptNumber || ''} onChange={(e) => update({ receiptNumber: e.target.value })} aria-label="Receipt number" />
          </div>
          <div className="field"><span className="field-label">From</span><input className="input" type="date" value={state.dateFrom || ''} onChange={(e) => update({ dateFrom: e.target.value })} /></div>
          <div className="field"><span className="field-label">To</span><input className="input" type="date" value={state.dateTo || ''} onChange={(e) => update({ dateTo: e.target.value })} /></div>
          <SelectInput label="Status" value={state.status || ''} placeholder="All" options={[{ value: 'COMPLETED', label: 'Completed' }, { value: 'VOIDED', label: 'Voided' }]} onChange={(e) => update({ status: e.target.value })} />
          <SelectInput label="Payment" value={state.paymentMethod || ''} placeholder="All" options={[{ value: 'CASH', label: 'Cash' }, { value: 'BANK_TRANSFER', label: 'Bank transfer' }]} onChange={(e) => update({ paymentMethod: e.target.value })} />
          <SelectInput label="Category" value={state.categoryId || ''} placeholder="All" options={toOptions(categories.data)} onChange={(e) => update({ categoryId: e.target.value })} />
          {view === 'all' && staff.data && staff.data.length > 0 && (
            <SelectInput label="Staff" value={state.staffId || ''} placeholder="All staff" options={toOptions(staff.data, 'fullName')} onChange={(e) => update({ staffId: e.target.value })} />
          )}
          <div className="field" style={{ minWidth: 100, maxWidth: 120 }}><span className="field-label">Min amount</span><input className="input" inputMode="decimal" defaultValue={state.minAmount || ''} onChange={(e) => update({ minAmount: e.target.value })} /></div>
          <div className="field" style={{ minWidth: 100, maxWidth: 120 }}><span className="field-label">Max amount</span><input className="input" inputMode="decimal" defaultValue={state.maxAmount || ''} onChange={(e) => update({ maxAmount: e.target.value })} /></div>
        </FilterToolbar>
        <DataTable rows={list.data && list.data.data} loading={list.loading} error={list.error} onRetry={list.reload}
          sort={state} onSort={update} filtered={hasFilters} onClearFilters={() => { clear(); }}
          onRowClick={(s) => navigate(`/sales/${s.id}`)}
          columns={[
            { key: 'receiptNumber', label: 'Receipt', sortable: true, render: (s) => <span className="mono">{s.receiptNumber}</span> },
            { key: 'completedAt', label: 'Date', sortable: true, render: (s) => <span className="nowrap">{formatDateTime(s.completedAt)}</span> },
            { key: 'branchName', label: 'Branch' },
            { key: 'soldByName', label: 'Staff' },
            { key: 'itemCount', label: 'Items', align: 'right', render: (s) => formatNumber(s.itemCount) },
            { key: 'paymentMethod', label: 'Payment', render: (s) => humanize(s.paymentMethod) },
            { key: 'status', label: 'Status', sortable: true, render: (s) => <StatusBadge status={s.status} /> },
            { key: 'refundedTotal', label: 'Refunded', align: 'right', render: (s) => (Number(s.refundedTotal) > 0 ? formatMoney(s.refundedTotal) : '—') },
            { key: 'total', label: 'Total', align: 'right', sortable: true, render: (s) => <strong>{formatMoney(s.total)}</strong> },
          ]}
          empty={<EmptyState icon={Receipt} title="No sales yet" message="Completed sales appear here." learnHow="receipts-and-sales-history" />} />
        <Pagination pagination={list.data && list.data.pagination} onChange={(page) => update({ page }, { resetPage: false })} />
      </Panel>
    </div>
  );
}
