import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Building2 } from 'lucide-react';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useListState } from '../../hooks/useListState.js';
import { Can } from '../../permissions/Can.jsx';
import { PageHeader, Panel, DataTable, Pagination, Button, StatusBadge, EmptyState, SelectInput, FilterToolbar } from '../../components/ui/index.js';
import { SupplierModal } from './SupplierModal.jsx';

export default function SuppliersPage() {
  const navigate = useNavigate();
  const { state, update, clear, hasFilters } = useListState();
  const list = useApi(() => api.get('/suppliers', state), [JSON.stringify(state)]);
  const [creating, setCreating] = useState(false);

  return (
    <div className="stack">
      <PageHeader title="Suppliers" description="Shared across branches. Purchases and payments stay branch-specific."
        actions={<Can permission="SUPPLIER_CREATE"><Button icon={Plus} onClick={() => setCreating(true)}>New supplier</Button></Can>} />
      <Panel flush>
        <FilterToolbar>
          <div className="field search-field">
            <span className="field-label">Search</span>
            <input className="input" type="search" placeholder="Company, contact or phone" defaultValue={state.search || ''} onChange={(e) => update({ search: e.target.value })} aria-label="Search suppliers" />
          </div>
          <SelectInput label="Status" value={state.status || ''} placeholder="All" options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'ARCHIVED', label: 'Archived' }]} onChange={(e) => update({ status: e.target.value })} />
        </FilterToolbar>
        <DataTable rows={list.data && list.data.data} loading={list.loading} error={list.error} onRetry={list.reload}
          sort={state} onSort={update} filtered={hasFilters} isSearch={Boolean(state.search)} onClearFilters={clear}
          onRowClick={(s) => navigate(`/suppliers/${s.id}`)}
          columns={[
            { key: 'companyName', label: 'Company', sortable: true, render: (s) => <span className="cell-strong">{s.companyName}</span> },
            { key: 'contactPerson', label: 'Contact', render: (s) => s.contactPerson || '—' },
            { key: 'phone', label: 'Phone' },
            { key: 'email', label: 'Email', render: (s) => s.email || '—' },
            { key: 'status', label: 'Status', sortable: true, render: (s) => <StatusBadge status={s.status} /> },
          ]}
          empty={<EmptyState icon={Building2} title="No suppliers yet" message="Add the companies you purchase from." action={<Can permission="SUPPLIER_CREATE"><Button icon={Plus} onClick={() => setCreating(true)}>New supplier</Button></Can>} />} />
        <Pagination pagination={list.data && list.data.pagination} onChange={(page) => update({ page }, { resetPage: false })} />
      </Panel>
      {creating && <SupplierModal onClose={() => setCreating(false)} onSaved={(s) => navigate(`/suppliers/${s.id}`)} />}
    </div>
  );
}
