import { useNavigate } from 'react-router-dom';
import { Plus, ArrowLeftRight } from 'lucide-react';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useListState } from '../../hooks/useListState.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Can } from '../../permissions/Can.jsx';
import { PageHeader, Panel, DataTable, Pagination, Button, StatusBadge, EmptyState, SelectInput, FilterToolbar } from '../../components/ui/index.js';
import { formatDateTime, formatNumber, humanize } from '../../utils/format.js';

const STATUSES = ['DRAFT', 'REQUESTED', 'APPROVED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED'].map((s) => ({ value: s, label: humanize(s) }));

export default function TransfersPage() {
  const navigate = useNavigate();
  const { branchParam } = useAuth();
  const { state, update, clear, hasFilters } = useListState();
  const params = { ...state, branchId: branchParam };
  const list = useApi(() => api.get('/transfers', params), [JSON.stringify(params)]);
  return (
    <div className="stack">
      <PageHeader title="Transfers" description="Move stock between branches: request, approve, ship and receive."
        actions={<Can permission="INVENTORY_TRANSFER_CREATE"><Button icon={Plus} onClick={() => navigate('/transfers/new')}>New transfer</Button></Can>} />
      <Panel flush>
        <FilterToolbar>
          <div className="field search-field">
            <span className="field-label">Search</span>
            <input className="input" type="search" placeholder="TRF-…" defaultValue={state.search || ''} onChange={(e) => update({ search: e.target.value })} aria-label="Search transfers" />
          </div>
          <SelectInput label="Status" value={state.status || ''} placeholder="All" options={STATUSES} onChange={(e) => update({ status: e.target.value })} />
        </FilterToolbar>
        <DataTable rows={list.data && list.data.data} loading={list.loading} error={list.error} onRetry={list.reload}
          sort={state} onSort={update} filtered={hasFilters} isSearch={Boolean(state.search)} onClearFilters={clear}
          onRowClick={(t) => navigate(`/transfers/${t.id}`)}
          columns={[
            { key: 'transferNumber', label: 'Transfer', sortable: true, render: (t) => <span className="mono">{t.transferNumber}</span> },
            { key: 'route', label: 'From → To', render: (t) => `${t.sourceBranchName} → ${t.destinationBranchName}` },
            { key: 'itemCount', label: 'Batches', align: 'right' },
            { key: 'requestedUnits', label: 'Units requested', align: 'right', render: (t) => formatNumber(t.requestedUnits) },
            { key: 'status', label: 'Status', sortable: true, render: (t) => <StatusBadge status={t.status} /> },
            { key: 'discrepancyQuantity', label: 'Discrepancy', align: 'right', render: (t) => (t.discrepancyQuantity ? <span className="danger-text">{t.discrepancyQuantity}</span> : '—') },
            { key: 'createdAt', label: 'Created', sortable: true, render: (t) => formatDateTime(t.createdAt) },
          ]}
          empty={<EmptyState icon={ArrowLeftRight} title="No transfers" message="Create a transfer to move stock between branches." learnHow="branch-transfers" />} />
        <Pagination pagination={list.data && list.data.pagination} onChange={(page) => update({ page }, { resetPage: false })} />
      </Panel>
    </div>
  );
}
