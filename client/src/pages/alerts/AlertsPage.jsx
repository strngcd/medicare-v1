import { useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useListState } from '../../hooks/useListState.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Panel, DataTable, Pagination, StatusBadge, EmptyState, SelectInput, Kpi, InlineAlert, FilterToolbar } from '../../components/ui/index.js';
import { formatDate, formatNumber } from '../../utils/format.js';

const TYPES = [
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'OUT_OF_STOCK', label: 'Out of stock' },
  { value: 'EXPIRING_SOON', label: 'Expiring soon' },
  { value: 'LOW_STOCK', label: 'Low stock' },
];

export default function AlertsPage() {
  const navigate = useNavigate();
  const { branchParam } = useAuth();
  const { state, update, clear, hasFilters } = useListState();
  const params = { ...state, branchId: branchParam };
  const list = useApi(() => api.get('/alerts', params), [JSON.stringify(params)]);
  const counts = useApi(() => api.get('/alerts/count', { branchId: branchParam }).then((r) => r.data), [branchParam]);

  const columns = [
    { key: 'severity', label: 'Severity', render: (a) => <StatusBadge status={a.severity} /> },
    { key: 'type', label: 'Alert', render: (a) => <StatusBadge status={a.type} /> },
    { key: 'medicineName', label: 'Medicine', render: (a) => <span className="cell-strong">{a.medicineName}</span> },
    { key: 'branchName', label: 'Branch' },
    { key: 'detail', label: 'Detail', render: (a) => <span className="small">{a.message}</span> },
    { key: 'expiryDate', label: 'Expiry', render: (a) => (a.expiryDate ? formatDate(a.expiryDate) : '—') },
  ];

  const c = counts.data;
  return (
    <div className="stack">
      <PageHeader title="Inventory alerts" description="Calculated from current stock. Alerts clear automatically once the condition is resolved." />
      <div className="grid-4">
        {TYPES.map((t) => (
          <Kpi key={t.value} label={t.label} value={c && formatNumber(c.byType[t.value])} loading={!c}
            tone={c && c.byType[t.value] ? (t.value === 'EXPIRED' || t.value === 'OUT_OF_STOCK' ? 'danger' : 'warning') : undefined}
            onClick={() => update({ type: t.value })} />
        ))}
      </div>
      <Panel flush>
        <FilterToolbar>
          <SelectInput label="Type" value={state.type || ''} placeholder="All types" options={TYPES} onChange={(e) => update({ type: e.target.value })} />
          <SelectInput label="Severity" value={state.severity || ''} placeholder="All severities"
            options={[{ value: 'CRITICAL', label: 'Critical' }, { value: 'HIGH', label: 'High' }, { value: 'WARNING', label: 'Warning' }]}
            onChange={(e) => update({ severity: e.target.value })} />
        </FilterToolbar>
        <DataTable
          columns={columns}
          rows={list.data && list.data.data}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          filtered={hasFilters}
          onClearFilters={clear}
          onRowClick={(a) => navigate(`/medicines/${a.medicineId}`)}
          empty={<EmptyState icon={ShieldCheck} title="No active alerts" message="Stock levels and expiry dates are within limits." learnHow="batches-and-expiry" />}
        />
        <Pagination pagination={list.data && list.data.pagination} onChange={(page) => update({ page }, { resetPage: false })} />
      </Panel>
      <InlineAlert tone="info">Expired stock cannot be sold. Use an inventory adjustment with the “Expired” reason to remove it from stock.</InlineAlert>
    </div>
  );
}
