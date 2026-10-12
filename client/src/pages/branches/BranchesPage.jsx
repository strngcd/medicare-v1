import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Store } from 'lucide-react';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useListState } from '../../hooks/useListState.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Can } from '../../permissions/Can.jsx';
import { PageHeader, Panel, DataTable, Pagination, Button, StatusBadge, EmptyState, SelectInput } from '../../components/ui/index.js';
import { BranchModal } from './BranchModal.jsx';

export default function BranchesPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const { state, update, clear, hasFilters } = useListState();
  const list = useApi(() => api.get('/branches', state), [JSON.stringify(state)]);
  const [creating, setCreating] = useState(false);
  return (
    <div className="stack">
      <PageHeader title="Branches" actions={<Can permission="BRANCH_CREATE"><Button icon={Plus} onClick={() => setCreating(true)}>New branch</Button></Can>} />
      <Panel flush>
        <div className="toolbar">
          <div className="field search-field">
            <span className="field-label">Search</span>
            <input className="input" type="search" placeholder="Name, code or city" defaultValue={state.search || ''} onChange={(e) => update({ search: e.target.value })} aria-label="Search branches" />
          </div>
          <SelectInput label="Status" value={state.status || ''} placeholder="All" options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }]} onChange={(e) => update({ status: e.target.value })} />
        </div>
        <DataTable rows={list.data && list.data.data} loading={list.loading} error={list.error} onRetry={list.reload}
          sort={state} onSort={update} filtered={hasFilters} isSearch={Boolean(state.search)} onClearFilters={clear}
          onRowClick={(b) => navigate(`/branches/${b.id}`)}
          columns={[
            { key: 'name', label: 'Name', sortable: true, render: (b) => <span className="cell-strong">{b.name}</span> },
            { key: 'code', label: 'Code', sortable: true, render: (b) => <span className="mono">{b.code}</span> },
            { key: 'city', label: 'City', sortable: true, render: (b) => b.city || '—' },
            { key: 'phone', label: 'Phone', render: (b) => b.phone || '—' },
            { key: 'managerName', label: 'Manager', render: (b) => b.managerName || '—' },
            { key: 'activeStaffCount', label: 'Active staff', align: 'right' },
            { key: 'status', label: 'Status', sortable: true, render: (b) => <StatusBadge status={b.status} /> },
          ]}
          empty={<EmptyState icon={Store} title="No branches" message="Create your first branch to start working." />} />
        <Pagination pagination={list.data && list.data.pagination} onChange={(page) => update({ page }, { resetPage: false })} />
      </Panel>
      {creating && <BranchModal onClose={() => setCreating(false)} onSaved={async (b) => { await refresh(); navigate(`/branches/${b.id}`); }} />}
    </div>
  );
}
