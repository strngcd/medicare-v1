import { KeyRound } from 'lucide-react';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useListState } from '../../hooks/useListState.js';
import { PageHeader, Panel, DataTable, Pagination, EmptyState, SelectInput, StatusBadge, FilterToolbar } from '../../components/ui/index.js';
import { formatDateTime, humanize } from '../../utils/format.js';

const FAILURES = ['INVALID_CREDENTIALS', 'ACCOUNT_INACTIVE', 'RATE_LIMITED', 'INVALID_RESET_FLOW', 'OTHER'].map((v) => ({ value: v, label: humanize(v) }));

export default function LoginHistoryPage() {
  const { state, update, clear, hasFilters } = useListState();
  const list = useApi(() => api.get('/login-history', state), [JSON.stringify(state)]);
  return (
    <div className="stack">
      <PageHeader title="Login history" description="Sign-ins, sign-outs and failed attempts." />
      <Panel flush>
        <FilterToolbar>
          <SelectInput label="Event" value={state.eventType || ''} placeholder="All" options={[{ value: 'LOGIN', label: 'Sign-in' }, { value: 'LOGOUT', label: 'Sign-out' }]} onChange={(e) => update({ eventType: e.target.value })} />
          <SelectInput label="Result" value={state.success || ''} placeholder="All" options={[{ value: 'true', label: 'Successful' }, { value: 'false', label: 'Failed' }]} onChange={(e) => update({ success: e.target.value })} />
          <SelectInput label="Failure" value={state.failureCategory || ''} placeholder="All" options={FAILURES} onChange={(e) => update({ failureCategory: e.target.value })} />
          <div className="field"><span className="field-label">From</span><input className="input" type="date" value={state.dateFrom || ''} onChange={(e) => update({ dateFrom: e.target.value })} /></div>
          <div className="field"><span className="field-label">To</span><input className="input" type="date" value={state.dateTo || ''} onChange={(e) => update({ dateTo: e.target.value })} /></div>
        </FilterToolbar>
        <DataTable rows={list.data && list.data.data} loading={list.loading} error={list.error} onRetry={list.reload}
          filtered={hasFilters} onClearFilters={clear}
          columns={[
            { key: 'createdAt', label: 'When', render: (h) => <span className="nowrap small">{formatDateTime(h.createdAt)}</span> },
            { key: 'userName', label: 'User', render: (h) => h.userName || <span className="subtle">Unknown account</span> },
            { key: 'eventType', label: 'Event', render: (h) => (h.eventType === 'LOGIN' ? 'Sign-in' : 'Sign-out') },
            { key: 'success', label: 'Result', render: (h) => (h.success ? <StatusBadge status="COMPLETED" label="Success" /> : <StatusBadge status="VOIDED" label={humanize(h.failureCategory)} />) },
            { key: 'branchName', label: 'Branch', render: (h) => h.branchName || '—' },
            { key: 'ipAddress', label: 'IP', render: (h) => <span className="mono">{h.ipAddress || '—'}</span> },
          ]}
          empty={<EmptyState icon={KeyRound} title="No login events" />} />
        <Pagination pagination={list.data && list.data.pagination} onChange={(page) => update({ page }, { resetPage: false })} />
      </Panel>
    </div>
  );
}
