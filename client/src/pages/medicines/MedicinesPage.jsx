import { useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useListState } from '../../hooks/useListState.js';
import { useCategories, toOptions } from '../../hooks/useLookups.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Can } from '../../permissions/Can.jsx';
import { PageHeader, Panel, DataTable, Pagination, Button, StatusBadge, Badge, EmptyState, SelectInput, FilterToolbar } from '../../components/ui/index.js';
import { formatNumber } from '../../utils/format.js';
import { productConfig } from './productTypes.js';

/** Catalog list for one product type (medicines by default, or cosmetics). */
export default function MedicinesPage({ productType = 'MEDICINE' }) {
  const navigate = useNavigate();
  const { branchParam } = useAuth();
  const config = productConfig(productType);
  const cosmetic = productType === 'COSMETIC';
  const categories = useCategories(productType);
  const { state, update, clear, hasFilters } = useListState();
  const params = { ...state, productType, branchId: branchParam };
  const list = useApi(() => api.get('/medicines', params), [JSON.stringify(params)]);

  const columns = [
    {
      key: 'name',
      label: config.title,
      sortable: true,
      render: (m) => (
        <span className="stack-sm" style={{ gap: 1 }}>
          <span className="cell-strong">{m.name} {m.prescriptionRequired && <Badge tone="info">Rx</Badge>}</span>
          <span className="small muted">{[cosmetic && m.brandName, m.strength, m.dosageForm, m.packageSize].filter(Boolean).join(' · ')}</span>
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
        title={config.plural}
        description={cosmetic
          ? 'Cosmetics sold alongside medicines. They are purchased, stocked and sold like medicines. Stock is shown for the selected branch.'
          : 'The medicine catalog. Stock is shown for the selected branch.'}
        actions={<Can permission="MEDICINE_CREATE"><Button icon={Plus} onClick={() => navigate(`${config.basePath}/new`)}>Add {config.singular}</Button></Can>}
      />
      <Panel flush>
        <FilterToolbar>
          <div className="field search-field">
            <span className="field-label">Search</span>
            <div className="input-with-icon">
              <Search aria-hidden="true" />
              <input className="input" type="search" placeholder={cosmetic ? 'Name, brand or barcode' : 'Name, generic, brand or barcode'} defaultValue={state.search || ''}
                onChange={(e) => update({ search: e.target.value })} aria-label={`Search ${config.plural.toLowerCase()}`} />
            </div>
          </div>
          <SelectInput label="Category" value={state.categoryId || ''} placeholder="All categories" options={toOptions(categories.data)} onChange={(e) => update({ categoryId: e.target.value })} />
          <SelectInput label="Status" value={state.status || ''} placeholder="All statuses"
            options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'DRAFT', label: 'Draft' }, { value: 'ARCHIVED', label: 'Archived' }]}
            onChange={(e) => update({ status: e.target.value })} />
          {!cosmetic && (
            <SelectInput label="Prescription" value={state.prescriptionRequired || ''} placeholder="Any"
              options={[{ value: 'true', label: 'Prescription only' }, { value: 'false', label: 'Over the counter' }]}
              onChange={(e) => update({ prescriptionRequired: e.target.value })} />
          )}
        </FilterToolbar>
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
          onRowClick={(m) => navigate(`${config.basePath}/${m.id}`)}
          empty={(
            <EmptyState icon={config.icon} title={`No ${config.plural.toLowerCase()} yet`}
              message={`Add your first ${config.singular}, then add its batches or receive it through a purchase.`}
              action={<Can permission="MEDICINE_CREATE"><Button icon={Plus} onClick={() => navigate(`${config.basePath}/new`)}>Add {config.singular}</Button></Can>}
              learnHow="adding-a-medicine" />
          )}
        />
        <Pagination pagination={list.data && list.data.pagination} onChange={(page) => update({ page }, { resetPage: false })} />
      </Panel>
    </div>
  );
}
