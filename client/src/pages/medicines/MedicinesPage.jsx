import { useNavigate } from 'react-router-dom';
import { Plus, Pill, Search } from 'lucide-react';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useListState } from '../../hooks/useListState.js';
import { useCategories, toOptions } from '../../hooks/useLookups.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Can } from '../../permissions/Can.jsx';
import { PageHeader, Panel, DataTable, Pagination, Button, StatusBadge, Badge, EmptyState, SelectInput } from '../../components/ui/index.js';
import { formatNumber } from '../../utils/format.js';

export default function MedicinesPage() {
  const navigate = useNavigate();
  const { branchParam } = useAuth();
  const categories = useCategories();
  const { state, update, clear, hasFilters } = useListState();
  const params = { ...state, branchId: branchParam };
  const list = useApi(() => api.get('/medicines', params), [JSON.stringify(params)]);

  const columns = [
    {
      key: 'name',
      label: 'Medicine',
      sortable: true,
      render: (m) => (
        <span className="stack-sm" style={{ gap: 1 }}>
          <span className="cell-strong">{m.name} {m.prescriptionRequired && <Badge tone="info">Rx</Badge>}</span>
          <span className="small muted">{[m.strength, m.dosageForm, m.packageSize].filter(Boolean).join(' · ')}</span>
        </span>
      ),
    },
    { key: 'category', label: 'Category', sortable: true, render: (m) => m.categoryName || <span className="subtle">Uncategorized</span> },
    { key: 'barcode', label: 'Barcode', render: (m) => (m.barcode ? <span className="mono">{m.barcode}</span> : '—') },
    {
      key: 'stock',
      label: 'Sellable stock',
      align: 'right',
      sortable: true,
      render: (m) => (
        <span className={m.sellableQuantity === 0 && m.status === 'ACTIVE' ? 'danger-text' : undefined}>{formatNumber(m.sellableQuantity)}</span>
      ),
    },
    { key: 'status', label: 'Status', sortable: true, render: (m) => <StatusBadge status={m.status} /> },
  ];

  return (
    <div className="stack">
      <PageHeader
        title="Medicines"
        description="The product catalog. Stock is shown for the selected branch."
        actions={<Can permission="MEDICINE_CREATE"><Button icon={Plus} onClick={() => navigate('/medicines/new')}>Add medicine</Button></Can>}
      />
      <Panel flush>
        <div className="toolbar">
          <div className="field search-field">
            <span className="field-label">Search</span>
            <div className="input-with-icon">
              <Search aria-hidden="true" />
              <input className="input" type="search" placeholder="Name, generic, brand or barcode" defaultValue={state.search || ''}
                onChange={(e) => update({ search: e.target.value })} aria-label="Search medicines" />
            </div>
          </div>
          <SelectInput label="Category" value={state.categoryId || ''} placeholder="All categories" options={toOptions(categories.data)} onChange={(e) => update({ categoryId: e.target.value })} />
          <SelectInput label="Status" value={state.status || ''} placeholder="All statuses"
            options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'DRAFT', label: 'Draft' }, { value: 'ARCHIVED', label: 'Archived' }]}
            onChange={(e) => update({ status: e.target.value })} />
          <SelectInput label="Prescription" value={state.prescriptionRequired || ''} placeholder="Any"
            options={[{ value: 'true', label: 'Prescription only' }, { value: 'false', label: 'Over the counter' }]}
            onChange={(e) => update({ prescriptionRequired: e.target.value })} />
        </div>
        <DataTable
          columns={columns}
          rows={list.data && list.data.data}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          sort={state}
          onSort={update}
          filtered={hasFilters}
          isSearch={Boolean(state.search)}
          onClearFilters={clear}
          onRowClick={(m) => navigate(`/medicines/${m.id}`)}
          empty={(
            <EmptyState icon={Pill} title="No medicines yet" message="Add your first medicine, then add its batches or receive it through a purchase."
              action={<Can permission="MEDICINE_CREATE"><Button icon={Plus} onClick={() => navigate('/medicines/new')}>Add medicine</Button></Can>}
              learnHow="adding-a-medicine" />
          )}
        />
        <Pagination pagination={list.data && list.data.pagination} onChange={(page) => update({ page }, { resetPage: false })} />
      </Panel>
    </div>
  );
}
