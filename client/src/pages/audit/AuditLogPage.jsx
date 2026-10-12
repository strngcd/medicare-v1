import { useState } from 'react';
import { ScrollText } from 'lucide-react';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useListState } from '../../hooks/useListState.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Panel, DataTable, Pagination, EmptyState, SelectInput, Modal, Details, FilterToolbar } from '../../components/ui/index.js';
import { formatDateTime, humanize } from '../../utils/format.js';

function ValuesTable({ values }) {
  if (!values || Object.keys(values).length === 0) return <span className="subtle">—</span>;
  return (
    <pre className="mono" style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'var(--surface-sunken)', padding: 10, borderRadius: 6 }}>
      {JSON.stringify(values, null, 2)}
    </pre>
  );
}

export default function AuditLogPage() {
  const { activeBranches } = useAuth();
  const { state, update, clear, hasFilters } = useListState();
  const list = useApi(() => api.get('/audit-logs', state), [JSON.stringify(state)]);
  const actions = useApi(() => api.get('/audit-logs/actions').then((r) => r.data), []);
  const [open, setOpen] = useState(null);
  return (
    <div className="stack">
      <PageHeader title="Audit log" description="Append-only record of important actions. Entries cannot be edited or deleted." />
      <Panel flush>
        <FilterToolbar>
          <div className="field search-field">
            <span className="field-label">Search</span>
            <input className="input" type="search" placeholder="Description" defaultValue={state.search || ''} onChange={(e) => update({ search: e.target.value })} aria-label="Search audit log" />
          </div>
          <SelectInput label="Action" value={state.action || ''} placeholder="All actions" options={(actions.data || []).map((a) => ({ value: a, label: humanize(a) }))} onChange={(e) => update({ action: e.target.value })} />
          <SelectInput label="Branch" value={state.branchId || ''} placeholder="All" options={activeBranches.map((b) => ({ value: b.id, label: b.name }))} onChange={(e) => update({ branchId: e.target.value })} />
          <div className="field"><span className="field-label">From</span><input className="input" type="date" value={state.dateFrom || ''} onChange={(e) => update({ dateFrom: e.target.value })} /></div>
          <div className="field"><span className="field-label">To</span><input className="input" type="date" value={state.dateTo || ''} onChange={(e) => update({ dateTo: e.target.value })} /></div>
        </FilterToolbar>
        <DataTable rows={list.data && list.data.data} loading={list.loading} error={list.error} onRetry={list.reload}
          filtered={hasFilters} isSearch={Boolean(state.search)} onClearFilters={clear} onRowClick={setOpen}
          columns={[
            { key: 'timestamp', label: 'When', render: (a) => <span className="nowrap small">{formatDateTime(a.timestamp)}</span> },
            { key: 'userName', label: 'User', render: (a) => a.userName || 'System' },
            { key: 'roleAtTime', label: 'Role', render: (a) => (a.roleAtTime ? humanize(a.roleAtTime) : '—') },
            { key: 'action', label: 'Action', render: (a) => humanize(a.action) },
            { key: 'description', label: 'Description' },
            { key: 'branchName', label: 'Branch', render: (a) => a.branchName || '—' },
          ]}
          empty={<EmptyState icon={ScrollText} title="No audit entries" />} />
        <Pagination pagination={list.data && list.data.pagination} onChange={(page) => update({ page }, { resetPage: false })} />
      </Panel>
      {open && (
        <Modal open size="lg" title={humanize(open.action)} onClose={() => setOpen(null)}>
          <Details items={[
            { label: 'When', value: formatDateTime(open.timestamp) },
            { label: 'User', value: open.userName },
            { label: 'Role at the time', value: open.roleAtTime && humanize(open.roleAtTime) },
            { label: 'Branch', value: open.branchName },
            { label: 'Entity', value: `${humanize(open.entityType)}${open.entityId ? ` · ${open.entityId}` : ''}` },
            { label: 'IP address', value: open.ipAddress },
          ]} />
          <p>{open.description}</p>
          <div className="grid-2">
            <div className="stack-sm"><span className="field-label">Before</span><ValuesTable values={open.previousValues} /></div>
            <div className="stack-sm"><span className="field-label">After</span><ValuesTable values={open.newValues} /></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
