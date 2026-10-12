import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Pencil, Archive, ArchiveRestore, Plus } from 'lucide-react';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useAction } from '../../hooks/useAction.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Can } from '../../permissions/Can.jsx';
import { PageHeader, Panel, Button, StatusBadge, Details, Kpi, DataTable, ErrorState, SkeletonRows, EmptyState } from '../../components/ui/index.js';
import { SupplierModal } from './SupplierModal.jsx';
import { formatDate, formatMoney, formatNumber } from '../../utils/format.js';

export default function SupplierDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can, branchParam } = useAuth();
  const [editing, setEditing] = useState(false);
  const action = useAction();
  const supplier = useApi(() => api.get(`/suppliers/${id}`).then((r) => r.data), [id]);
  const balance = useApi(() => api.get(`/suppliers/${id}/balance`).then((r) => r.data), [id], { enabled: can('SUPPLIER_PAYMENT_VIEW') });
  const purchases = useApi(() => api.get(`/suppliers/${id}/purchases`, { branchId: branchParam, limit: 50 }), [id, branchParam], { enabled: can('PURCHASE_VIEW') });

  if (supplier.error) return <Panel><ErrorState error={supplier.error} onRetry={supplier.reload} /></Panel>;
  if (!supplier.data) return <Panel><SkeletonRows /></Panel>;
  const s = supplier.data;

  const toggle = async () => {
    const archive = s.status === 'ACTIVE';
    const result = await action.run(() => api.post(`/suppliers/${id}/${archive ? 'archive' : 'restore'}`), { success: archive ? 'Supplier archived.' : 'Supplier restored.' });
    if (result) supplier.reload({ silent: true });
  };

  const b = balance.data;
  return (
    <div className="stack">
      <PageHeader
        breadcrumbs={[{ label: 'Suppliers', to: '/suppliers' }, { label: s.companyName }]}
        title={<span className="row-wrap">{s.companyName} <StatusBadge status={s.status} /></span>}
        actions={(
          <>
            {s.status === 'ACTIVE' && <Can permission="PURCHASE_CREATE"><Button icon={Plus} onClick={() => navigate(`/purchases/new?supplierId=${id}`)}>New purchase</Button></Can>}
            <Can permission="SUPPLIER_EDIT"><Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>Edit</Button></Can>
            {s.status === 'ACTIVE'
              ? <Can permission="SUPPLIER_ARCHIVE"><Button variant="ghost" icon={Archive} onClick={toggle} loading={action.running}>Archive</Button></Can>
              : <Can permission="SUPPLIER_RESTORE"><Button variant="secondary" icon={ArchiveRestore} onClick={toggle} loading={action.running}>Restore</Button></Can>}
          </>
        )}
      />
      <Panel title="Contact">
        <Details items={[
          { label: 'Phone', value: s.phone },
          { label: 'Contact person', value: s.contactPerson },
          { label: 'Email', value: s.email },
          { label: 'Address', value: s.address },
          { label: 'Notes', value: s.notes },
        ]} />
      </Panel>
      {can('SUPPLIER_PAYMENT_VIEW') && (
        <div className="grid-4">
          <Kpi label="Total purchased" value={b && formatMoney(b.totalPurchased)} loading={!b} note="Ordered, excluding drafts and cancelled" />
          <Kpi label="Paid" value={b && formatMoney(b.totalPaid)} loading={!b} />
          <Kpi label="Balance due" value={b && formatMoney(b.balance)} loading={!b} tone={b && Number(b.balance) > 0 ? 'warning' : undefined} />
          <Kpi label="Unpaid / partly paid" value={b && `${formatNumber(b.unpaidCount)} / ${formatNumber(b.partiallyPaidCount)}`} loading={!b} />
        </div>
      )}
      {can('PURCHASE_VIEW') && (
        <Panel title="Purchases" flush>
          <DataTable rows={purchases.data && purchases.data.data} loading={purchases.loading} error={purchases.error} onRetry={purchases.reload}
            onRowClick={(p) => navigate(`/purchases/${p.id}`)}
            columns={[
              { key: 'purchaseNumber', label: 'Purchase', render: (p) => <span className="mono">{p.purchaseNumber}</span> },
              { key: 'purchaseDate', label: 'Date', render: (p) => formatDate(p.purchaseDate) },
              { key: 'branchName', label: 'Branch' },
              { key: 'status', label: 'Status', render: (p) => <StatusBadge status={p.status} /> },
              { key: 'paymentStatus', label: 'Payment', render: (p) => <StatusBadge status={p.paymentStatus} /> },
              can('FINANCIAL_VIEW_PURCHASE_COST') && { key: 'total', label: 'Total', align: 'right', render: (p) => formatMoney(p.total) },
              can('FINANCIAL_VIEW_PURCHASE_COST') && { key: 'balance', label: 'Balance', align: 'right', render: (p) => formatMoney(p.balance) },
            ].filter(Boolean)}
            empty={<EmptyState title="No purchases from this supplier" />} />
        </Panel>
      )}
      {editing && <SupplierModal supplier={s} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); supplier.reload({ silent: true }); }} />}
    </div>
  );
}
