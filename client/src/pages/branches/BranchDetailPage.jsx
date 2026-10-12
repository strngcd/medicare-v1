import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Pencil, Power, PowerOff, Settings } from 'lucide-react';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useAction } from '../../hooks/useAction.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Can } from '../../permissions/Can.jsx';
import { PageHeader, Panel, Button, StatusBadge, Details, Kpi, DataTable, ErrorState, SkeletonRows, ConfirmDialog, InlineAlert, EmptyState } from '../../components/ui/index.js';
import { BranchModal } from './BranchModal.jsx';
import { formatDateTime, formatMoney, formatNumber } from '../../utils/format.js';

export default function BranchDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can, refresh } = useAuth();
  const [modal, setModal] = useState(null);
  const action = useAction();
  const branch = useApi(() => api.get(`/branches/${id}`).then((r) => r.data), [id]);
  const users = useApi(() => api.get(`/branches/${id}/users`).then((r) => r.data), [id], { enabled: can('STAFF_VIEW') });
  const summary = useApi(() => api.get(`/branches/${id}/inventory-summary`).then((r) => r.data), [id], { enabled: can('INVENTORY_VIEW') });

  if (branch.error) return <Panel><ErrorState error={branch.error} onRetry={branch.reload} /></Panel>;
  if (!branch.data) return <Panel><SkeletonRows /></Panel>;
  const b = branch.data;
  const toggle = async () => {
    const deactivate = b.status === 'ACTIVE';
    const result = await action.run(() => api.post(`/branches/${id}/${deactivate ? 'deactivate' : 'reactivate'}`), { success: deactivate ? 'Branch deactivated.' : 'Branch reactivated.' });
    setModal(null);
    if (result) { branch.reload({ silent: true }); refresh(); }
  };
  const s = summary.data;

  return (
    <div className="stack">
      <PageHeader
        breadcrumbs={[{ label: 'Branches', to: '/branches' }, { label: b.name }]}
        title={<span className="row-wrap">{b.name} <span className="mono subtle" style={{ fontSize: 15 }}>{b.code}</span> <StatusBadge status={b.status} /></span>}
        actions={(
          <>
            <Can permission="BRANCH_EDIT"><Button variant="secondary" icon={Pencil} onClick={() => setModal('edit')}>Edit</Button></Can>
            <Can any={['SETTINGS_VIEW', 'BRANCH_EDIT']}><Button variant="secondary" icon={Settings} onClick={() => navigate(`/settings?section=receipts&branchId=${id}`)}>Branch settings</Button></Can>
            {b.status === 'ACTIVE'
              ? <Can permission="BRANCH_DEACTIVATE"><Button variant="ghost" icon={PowerOff} onClick={() => setModal('deactivate')}>Deactivate</Button></Can>
              : <Can permission="BRANCH_REACTIVATE"><Button variant="secondary" icon={Power} onClick={toggle} loading={action.running}>Reactivate</Button></Can>}
          </>
        )}
      />
      {b.status === 'INACTIVE' && <InlineAlert tone="warning">Inactive since {formatDateTime(b.deactivatedAt)}. No new sales, purchases, stock or staff assignments; history remains available.</InlineAlert>}
      {action.error && action.error.code === 'BRANCH_HAS_DEPENDENT_STAFF' && (
        <InlineAlert tone="danger">{action.error.message} {action.error.details.staff.map((u) => <Link key={u.id} to={`/staff/${u.id}`} style={{ marginRight: 8 }}>{u.fullName}</Link>)}</InlineAlert>
      )}
      <Panel title="Branch details">
        <Details items={[
          { label: 'Phone', value: b.phone },
          { label: 'Email', value: b.email },
          { label: 'Address', value: [b.address, b.city, b.country].filter(Boolean).join(', ') },
          { label: 'Manager', value: b.managerName },
          { label: 'Created', value: formatDateTime(b.createdAt) },
        ]} />
      </Panel>
      {can('INVENTORY_VIEW') && (
        <div className="grid-4">
          <Kpi label="Stocked medicines" value={s && formatNumber(s.stockedMedicines)} loading={!s} />
          <Kpi label="Low / out of stock" value={s && `${formatNumber(s.lowStock)} / ${formatNumber(s.outOfStock)}`} loading={!s} />
          <Kpi label="Expired / expiring batches" value={s && `${formatNumber(s.expiredBatches)} / ${formatNumber(s.expiringSoonBatches)}`} loading={!s} />
          {s && s.inventoryValue !== undefined
            ? <Kpi label="Inventory value (cost)" value={formatMoney(s.inventoryValue)} />
            : <Kpi label="Sellable units" value={s && formatNumber(s.sellableUnits)} loading={!s} />}
        </div>
      )}
      {can('STAFF_VIEW') && (
        <Panel title="Assigned staff" flush>
          <DataTable rows={users.data} loading={users.loading} error={users.error} onRetry={users.reload}
            onRowClick={(u) => navigate(`/staff/${u.id}`)}
            columns={[
              { key: 'fullName', label: 'Name', render: (u) => <span className="cell-strong">{u.fullName}</span> },
              { key: 'roleName', label: 'Role' },
              { key: 'email', label: 'Email' },
              { key: 'status', label: 'Status', render: (u) => <StatusBadge status={u.status} /> },
            ]}
            empty={<EmptyState title="No staff assigned" />} />
        </Panel>
      )}
      {modal === 'edit' && <BranchModal branch={b} staff={users.data || []} onClose={() => setModal(null)} onSaved={() => { setModal(null); branch.reload({ silent: true }); refresh(); }} />}
      <ConfirmDialog open={modal === 'deactivate'} title="Deactivate branch" tone="danger" confirmLabel="Deactivate" loading={action.running}
        message="The branch will stop accepting sales, purchases, stock and staff assignments. Staff who only work here must be reassigned first." onConfirm={toggle} onClose={() => setModal(null)} />
    </div>
  );
}
