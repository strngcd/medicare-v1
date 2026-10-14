import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { PackagePlus, Pencil, Barcode, Archive, ArchiveRestore, CheckCircle2, SlidersHorizontal, MoreHorizontal, Trash2 } from 'lucide-react';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useAction } from '../../hooks/useAction.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Can } from '../../permissions/Can.jsx';
import {
  PageHeader, Panel, Button, StatusBadge, Badge, Details, Tabs, DataTable, Kpi, ErrorState, SkeletonRows,
  Modal, ConfirmDialog, TextInput, InlineAlert, EmptyState, Dropdown, IconButton,
} from '../../components/ui/index.js';
import { AddStockModal } from '../../components/inventory/AddStockModal.jsx';
import { AdjustStockModal } from '../../components/inventory/AdjustStockModal.jsx';
import { InventorySettingModal } from '../../components/inventory/InventorySettingModal.jsx';
import { DisposeStockModal } from '../../components/inventory/DisposeStockModal.jsx';
import { MedicineFields, medicinePayload } from './MedicineFields.jsx';
import { formatDate, formatDateTime, formatMoney, formatNumber, humanize } from '../../utils/format.js';
import { productConfig } from './productTypes.js';

function EditMedicineModal({ medicine, onClose, onSaved }) {
  const [form, setForm] = useState(() => {
    const f = {};
    for (const key of ['name', 'genericName', 'brandName', 'categoryId', 'manufacturer', 'countryOfOrigin', 'strength', 'dosageForm', 'packageSize', 'prescriptionRequired', 'description', 'storageInstructions']) {
      f[key] = medicine[key] ?? (key === 'prescriptionRequired' ? false : '');
    }
    return f;
  });
  const action = useAction();
  const config = productConfig(medicine.productType);
  const save = async () => {
    const result = await action.run(
      () => api.patch(`/medicines/${medicine.id}`, medicinePayload(form, { includeBarcode: false, productType: medicine.productType })),
      { success: `${config.title} updated.` },
    );
    if (result) onSaved(result.data);
  };
  return (
    <Modal open title={`Edit ${config.singular}`} size="lg" onClose={onClose} closeDisabled={action.running}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={action.running}>Save changes</Button></>}>
      <MedicineFields form={form} setForm={setForm} errors={action.fieldErrors} showBarcode={false} productType={medicine.productType} />
    </Modal>
  );
}

function BarcodeModal({ medicine, onClose, onSaved }) {
  const [barcode, setBarcode] = useState(medicine.barcode || '');
  const action = useAction();
  const save = async () => {
    const result = await action.run(() => api.patch(`/medicines/${medicine.id}/barcode`, { barcode }), { success: 'Barcode updated.' });
    if (result) onSaved();
  };
  return (
    <Modal open title="Barcode" onClose={onClose} closeDisabled={action.running}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={action.running}>Save</Button></>}>
      <TextInput label="Barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} error={action.fieldErrors.barcode} hint="Scan or type. Leave empty to remove." autoFocus />
      {action.error && action.error.code === 'DUPLICATE_BARCODE' && <InlineAlert tone="danger">{action.error.message}</InlineAlert>}
    </Modal>
  );
}

export default function MedicineDetailPage() {
  const { id } = useParams();
  const { branchParam, can } = useAuth();
  const [tab, setTab] = useState('stock');
  const [modal, setModal] = useState(null);
  const statusAction = useAction();

  const medicine = useApi(() => api.get(`/medicines/${id}`, { branchId: branchParam }).then((r) => r.data), [id, branchParam]);
  const inventory = useApi(() => api.get(`/medicines/${id}/inventory`, { branchId: branchParam }).then((r) => r.data), [id, branchParam], { enabled: can('INVENTORY_VIEW') });
  const batches = useApi(() => api.get(`/medicines/${id}/batches`, { branchId: branchParam }).then((r) => r.data), [id, branchParam], { enabled: can('INVENTORY_VIEW_BATCHES') && tab === 'batches' });
  const movements = useApi(() => api.get('/inventory/movements', { medicineId: id, branchId: branchParam, limit: 50 }), [id, branchParam], { enabled: can('INVENTORY_VIEW_MOVEMENTS') && tab === 'history' });

  if (medicine.error) return <Panel><ErrorState error={medicine.error} onRetry={medicine.reload} /></Panel>;
  if (!medicine.data) return <Panel><SkeletonRows rows={6} /></Panel>;
  const m = medicine.data;
  const config = productConfig(m.productType);
  const cosmetic = m.productType === 'COSMETIC';

  const refreshAll = () => {
    medicine.reload({ silent: true });
    if (can('INVENTORY_VIEW')) inventory.reload({ silent: true });
    if (tab === 'batches') batches.reload({ silent: true });
    if (tab === 'history') movements.reload({ silent: true });
  };

  const changeStatus = async (kind) => {
    const calls = {
      archive: () => api.post(`/medicines/${id}/archive`),
      restore: () => api.post(`/medicines/${id}/restore`),
      activate: () => api.patch(`/medicines/${id}`, { status: 'ACTIVE' }),
    };
    const label = productConfig(medicine.data && medicine.data.productType).title;
    const messages = { archive: `${label} archived.`, restore: `${label} restored.`, activate: `${label} activated.` };
    const result = await statusAction.run(calls[kind], { success: messages[kind] });
    setModal(null);
    if (result) refreshAll();
  };

  const stockColumns = [
    { key: 'branchName', label: 'Branch' },
    { key: 'batchNumber', label: 'Batch', render: (r) => (r.batchNumber ? <span className="mono">{r.batchNumber}</span> : '—') },
    { key: 'expiryDate', label: 'Expiry', render: (r) => formatDate(r.expiryDate) },
    { key: 'quantity', label: 'Quantity', align: 'right', render: (r) => formatNumber(r.quantity) },
    { key: 'minimumStock', label: 'Minimum', align: 'right', render: (r) => formatNumber(r.minimumStock) },
    { key: 'sellingPrice', label: 'Selling price', align: 'right', render: (r) => formatMoney(r.sellingPrice) },
    can('FINANCIAL_VIEW_PURCHASE_COST') && { key: 'purchasePrice', label: 'Cost', align: 'right', render: (r) => formatMoney(r.purchasePrice) },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    (can('INVENTORY_ADJUST') || can('INVENTORY_DISPOSE')) && {
      key: 'actions',
      label: '',
      render: (r) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Dropdown trigger={({ toggle }) => <IconButton icon={MoreHorizontal} label="Stock actions" onClick={toggle} />}>
            {can('INVENTORY_ADJUST') && (
              <>
                <button type="button" className="dropdown-item" onClick={() => setModal({ type: 'adjust', row: r })}><SlidersHorizontal aria-hidden="true" /> Adjust quantity</button>
                <button type="button" className="dropdown-item" onClick={() => setModal({ type: 'minimumStock', row: r })}>Change minimum stock</button>
                <button type="button" className="dropdown-item" onClick={() => setModal({ type: 'sellingPrice', row: r })}>Change selling price</button>
              </>
            )}
            {can('INVENTORY_DISPOSE') && r.quantity > 0 && (
              <button type="button" className="dropdown-item" onClick={() => setModal({ type: 'dispose', row: r })}><Trash2 aria-hidden="true" /> Dispose of stock</button>
            )}
          </Dropdown>
        </span>
      ),
    },
  ].filter(Boolean);

  const tabs = [
    can('INVENTORY_VIEW') && { value: 'stock', label: 'Stock by branch' },
    can('INVENTORY_VIEW_BATCHES') && { value: 'batches', label: 'Batches' },
    can('INVENTORY_VIEW_MOVEMENTS') && { value: 'history', label: 'Stock history' },
    { value: 'details', label: 'Details' },
  ].filter(Boolean);
  const activeTab = tabs.some((t) => t.value === tab) ? tab : tabs[0].value;

  return (
    <div className="stack">
      <PageHeader
        breadcrumbs={[{ label: config.plural, to: config.basePath }, { label: m.name }]}
        title={<span className="row-wrap">{m.name} <StatusBadge status={m.status} /> {m.prescriptionRequired && <Badge tone="info">Prescription required</Badge>}</span>}
        description={[cosmetic ? m.brandName : m.strength, m.dosageForm, m.packageSize, m.categoryName].filter(Boolean).join(' · ')}
        actions={(
          <>
            {m.status !== 'ARCHIVED' && <Can permission="INVENTORY_ADD_STOCK"><Button icon={PackagePlus} onClick={() => setModal({ type: 'addStock' })}>Add stock</Button></Can>}
            {m.status === 'DRAFT' && <Can permission="MEDICINE_EDIT"><Button variant="secondary" icon={CheckCircle2} onClick={() => changeStatus('activate')} loading={statusAction.running}>Activate</Button></Can>}
            {m.status !== 'ARCHIVED' && <Can permission="MEDICINE_EDIT"><Button variant="secondary" icon={Pencil} onClick={() => setModal({ type: 'edit' })}>Edit</Button></Can>}
            <Can permission="MEDICINE_EDIT"><Button variant="secondary" icon={Barcode} onClick={() => setModal({ type: 'barcode' })}>Barcode</Button></Can>
            {m.status !== 'ARCHIVED'
              ? <Can permission="MEDICINE_ARCHIVE"><Button variant="ghost" icon={Archive} onClick={() => setModal({ type: 'archive' })}>Archive</Button></Can>
              : <Can permission="MEDICINE_RESTORE"><Button variant="secondary" icon={ArchiveRestore} onClick={() => changeStatus('restore')} loading={statusAction.running}>Restore</Button></Can>}
          </>
        )}
      />

      {m.status === 'DRAFT' && <InlineAlert tone="info">This {config.singular} is a draft. Activate it to sell it or include it in purchases.</InlineAlert>}
      {m.status === 'ARCHIVED' && <InlineAlert tone="warning">Archived {config.plural.toLowerCase()} cannot be sold or purchased. History is kept.</InlineAlert>}

      <div className="grid-4">
        <Kpi label="Sellable stock" value={formatNumber(m.sellableQuantity)} tone={m.sellableQuantity === 0 && m.status === 'ACTIVE' ? 'danger' : undefined} note="Excludes expired batches" />
        <Kpi label="Total on hand" value={formatNumber(m.totalQuantity)} />
        <Kpi label="Minimum stock" value={formatNumber(m.minimumStock)} note="Sum across visible stock records" />
        <Kpi label="Barcode" value={m.barcode ? <span className="mono" style={{ fontSize: 16 }}>{m.barcode}</span> : '—'} />
      </div>

      <Panel flush>
        <Tabs tabs={tabs} active={activeTab} onChange={setTab} />
        {activeTab === 'stock' && (
          <DataTable columns={stockColumns} rows={inventory.data} loading={inventory.loading} error={inventory.error} onRetry={inventory.reload}
            empty={<EmptyState title="No stock yet" message="Add stock or receive it through a purchase." learnHow="purchasing-and-receiving" />} />
        )}
        {activeTab === 'batches' && (
          <DataTable rows={batches.data} loading={batches.loading} error={batches.error} onRetry={batches.reload}
            columns={[
              { key: 'batchNumber', label: 'Batch', render: (b) => <span className="mono">{b.batchNumber}</span> },
              { key: 'manufacturingDate', label: 'Manufactured', render: (b) => formatDate(b.manufacturingDate) },
              { key: 'expiryDate', label: 'Expiry', render: (b) => <span className={b.isExpired ? 'danger-text' : undefined}>{formatDate(b.expiryDate)}</span> },
              { key: 'supplierName', label: 'Supplier', render: (b) => b.supplierName || '—' },
              can('FINANCIAL_VIEW_PURCHASE_COST') && { key: 'purchasePrice', label: 'Cost', align: 'right', render: (b) => formatMoney(b.purchasePrice) },
              { key: 'quantity', label: 'On hand', align: 'right', render: (b) => formatNumber(b.quantity) },
              { key: 'state', label: 'State', render: (b) => <StatusBadge status={b.isExpired ? 'EXPIRED' : 'ACTIVE'} label={b.isExpired ? 'Expired' : 'Valid'} /> },
            ].filter(Boolean)}
            empty={<EmptyState title="No batches" />} />
        )}
        {activeTab === 'history' && (
          <DataTable rows={movements.data && movements.data.data} loading={movements.loading} error={movements.error} onRetry={movements.reload}
            columns={[
              { key: 'createdAt', label: 'When', render: (r) => <span className="nowrap small">{formatDateTime(r.createdAt)}</span> },
              { key: 'branchName', label: 'Branch' },
              { key: 'batchNumber', label: 'Batch', render: (r) => <span className="mono">{r.batchNumber}</span> },
              { key: 'movementType', label: 'Type', render: (r) => humanize(r.movementType) },
              { key: 'quantityChange', label: 'Change', align: 'right', render: (r) => <span className={r.quantityChange < 0 ? 'danger-text' : 'success-text'}>{r.quantityChange > 0 ? '+' : ''}{r.quantityChange}</span> },
              { key: 'quantityAfter', label: 'After', align: 'right' },
              { key: 'createdByName', label: 'By' },
              { key: 'reason', label: 'Reason', render: (r) => <span className="small">{r.reason || '—'}</span> },
            ]}
            empty={<EmptyState title="No stock movements yet" />} />
        )}
        {activeTab === 'details' && (
          <div className="panel-body">
            <Details items={cosmetic ? [
              { label: 'Brand', value: m.brandName },
              { label: 'Category', value: m.categoryName },
              { label: 'Form', value: m.dosageForm },
              { label: 'Size', value: m.packageSize },
              { label: 'Manufacturer', value: m.manufacturer },
              { label: 'Country of origin', value: m.countryOfOrigin },
              { label: 'Usage and storage', value: m.storageInstructions },
              { label: 'Description', value: m.description },
              { label: 'Created', value: formatDateTime(m.createdAt) },
              { label: 'Last updated', value: formatDateTime(m.updatedAt) },
            ] : [
              { label: 'Generic name', value: m.genericName },
              { label: 'Brand name', value: m.brandName },
              { label: 'Category', value: m.categoryName },
              { label: 'Manufacturer', value: m.manufacturer },
              { label: 'Country of origin', value: m.countryOfOrigin },
              { label: 'Strength', value: m.strength },
              { label: 'Dosage form', value: m.dosageForm },
              { label: 'Package size', value: m.packageSize },
              { label: 'Storage', value: m.storageInstructions },
              { label: 'Description', value: m.description },
              { label: 'Created', value: formatDateTime(m.createdAt) },
              { label: 'Last updated', value: formatDateTime(m.updatedAt) },
            ]} />
          </div>
        )}
      </Panel>

      {modal && modal.type === 'edit' && <EditMedicineModal medicine={m} onClose={() => setModal(null)} onSaved={() => { setModal(null); refreshAll(); }} />}
      {modal && modal.type === 'barcode' && <BarcodeModal medicine={m} onClose={() => setModal(null)} onSaved={() => { setModal(null); refreshAll(); }} />}
      {modal && modal.type === 'addStock' && <AddStockModal open medicine={m} onClose={() => setModal(null)} onSaved={refreshAll} />}
      {modal && modal.type === 'dispose' && <DisposeStockModal item={modal.row} onClose={() => setModal(null)} onDone={() => { setModal(null); refreshAll(); }} />}
      {modal && modal.type === 'adjust' && <AdjustStockModal open inventory={modal.row} onClose={() => setModal(null)} onSaved={refreshAll} />}
      {modal && (modal.type === 'minimumStock' || modal.type === 'sellingPrice') && (
        <InventorySettingModal open inventory={modal.row} field={modal.type} onClose={() => setModal(null)} onSaved={refreshAll} />
      )}
      <ConfirmDialog open={Boolean(modal && modal.type === 'archive')} title={`Archive ${config.singular}`}
        message={`${m.name} will no longer be available for sales or purchases. Its history is kept and it can be restored later.`}
        confirmLabel="Archive" tone="danger" loading={statusAction.running}
        onConfirm={() => changeStatus('archive')} onClose={() => setModal(null)} />
    </div>
  );
}
