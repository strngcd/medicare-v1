import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, ArchiveRestore, Boxes, MoreHorizontal, SlidersHorizontal, Search, Trash2 } from 'lucide-react';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useAction } from '../../hooks/useAction.js';
import { useListState } from '../../hooks/useListState.js';
import { useCategories, toOptions } from '../../hooks/useLookups.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Panel, DataTable, Pagination, StatusBadge, EmptyState, SelectInput, Tabs, Dropdown, IconButton, LearnHow, FilterToolbar, Checkbox } from '../../components/ui/index.js';
import { AdjustStockModal } from '../../components/inventory/AdjustStockModal.jsx';
import { InventorySettingModal } from '../../components/inventory/InventorySettingModal.jsx';
import { DisposeStockModal } from '../../components/inventory/DisposeStockModal.jsx';
import { formatDate, formatDateTime, formatMoney, formatNumber, humanize, PRODUCT_TYPE_OPTIONS } from '../../utils/format.js';

const STATUSES = ['AVAILABLE', 'LOW_STOCK', 'OUT_OF_STOCK', 'EXPIRING_SOON', 'EXPIRED'].map((s) => ({ value: s, label: humanize(s) }));
const MOVEMENT_TYPES = ['PURCHASE_RECEIVED', 'SALE', 'REFUND', 'ADJUSTMENT', 'TRANSFER_OUT', 'TRANSFER_IN', 'EXPIRED', 'DAMAGED', 'LOST', 'CORRECTION', 'DISPOSED']
  .map((s) => ({ value: s, label: humanize(s) }));

function StockTab({ state, update, clear, hasFilters }) {
  const navigate = useNavigate();
  const { branchParam, can } = useAuth();
  const categories = useCategories(state.productType || undefined);
  const [modal, setModal] = useState(null);
  const params = { ...state, tab: undefined, branchId: branchParam };
  const list = useApi(() => api.get('/inventory', params), [JSON.stringify(params)]);
  const archiveAction = useAction();
  const showingArchived = state.archived === 'true';
  const setArchived = async (row, archived) => {
    const result = await archiveAction.run(() => api.post(`/inventory/${row.id}/${archived ? 'archive' : 'restore'}`), { success: archived ? 'Batch archived.' : 'Batch restored.' });
    if (result) list.reload({ silent: true });
  };
  const rowActions = (r) => {
    if (r.archivedAt) {
      return can('INVENTORY_BATCH_RESTORE') ? [{ label: 'Restore batch', icon: ArchiveRestore, run: () => setArchived(r, false) }] : [];
    }
    return [
      can('INVENTORY_ADJUST') && { label: 'Adjust quantity', icon: SlidersHorizontal, run: () => setModal({ type: 'adjust', row: r }) },
      can('INVENTORY_ADJUST') && { label: 'Change minimum stock', run: () => setModal({ type: 'minimumStock', row: r }) },
      can('INVENTORY_ADJUST') && { label: 'Change selling price', run: () => setModal({ type: 'sellingPrice', row: r }) },
      can('INVENTORY_DISPOSE') && r.quantity > 0 && ['EXPIRED', 'EXPIRING_SOON'].includes(r.status)
        && { label: 'Dispose of stock', icon: Trash2, run: () => setModal({ type: 'dispose', row: r }) },
      can('INVENTORY_BATCH_ARCHIVE') && r.quantity === 0 && { label: 'Archive batch', icon: Archive, run: () => setArchived(r, true) },
    ].filter(Boolean);
  };
  const hasActions = ['INVENTORY_ADJUST', 'INVENTORY_DISPOSE', 'INVENTORY_BATCH_ARCHIVE', 'INVENTORY_BATCH_RESTORE'].some((p) => can(p));

  const columns = [
    { key: 'medicineName', label: 'Product', sortable: true, render: (r) => <span className="cell-strong">{r.medicineName}{r.productType === 'COSMETIC' && <span className="small muted"> · Cosmetic</span>}</span> },
    { key: 'branchName', label: 'Branch', sortable: true },
    can('INVENTORY_VIEW_BATCHES') && { key: 'batchNumber', label: 'Batch', render: (r) => <span className="mono">{r.batchNumber}</span> },
    { key: 'expiryDate', label: 'Expiry', sortable: true, render: (r) => formatDate(r.expiryDate) },
    { key: 'quantity', label: 'Qty', align: 'right', sortable: true, render: (r) => formatNumber(r.quantity) },
    { key: 'sellingPrice', label: 'Price', align: 'right', sortable: true, render: (r) => formatMoney(r.sellingPrice) },
    can('FINANCIAL_VIEW_PURCHASE_COST') && { key: 'inventoryValue', label: 'Value (cost)', align: 'right', render: (r) => formatMoney(r.inventoryValue) },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    hasActions && {
      key: 'actions',
      label: '',
      render: (r) => {
        const actions = rowActions(r);
        if (actions.length === 0) return null;
        return (
          <span onClick={(e) => e.stopPropagation()}>
            <Dropdown trigger={({ toggle }) => <IconButton icon={MoreHorizontal} label="Stock actions" onClick={toggle} />}>
              {actions.map((a) => (
                <button key={a.label} type="button" className="dropdown-item" onClick={a.run} disabled={archiveAction.running}>
                  {a.icon && <a.icon aria-hidden="true" />} {a.label}
                </button>
              ))}
            </Dropdown>
          </span>
        );
      },
    },
  ].filter(Boolean);

  return (
    <>
      <FilterToolbar>
        <div className="field search-field">
          <span className="field-label">Search</span>
          <div className="input-with-icon">
            <Search aria-hidden="true" />
            <input className="input" type="search" placeholder="Medicine, batch or barcode" defaultValue={state.search || ''} onChange={(e) => update({ search: e.target.value })} aria-label="Search stock" />
          </div>
        </div>
        <SelectInput label="Type" value={state.productType || ''} placeholder="All products" options={PRODUCT_TYPE_OPTIONS} onChange={(e) => update({ productType: e.target.value, categoryId: '' })} />
        <SelectInput label="Category" value={state.categoryId || ''} placeholder="All categories" options={toOptions(categories.data)} onChange={(e) => update({ categoryId: e.target.value })} />
        <SelectInput label="Status" value={state.status || ''} placeholder="All statuses" options={STATUSES} onChange={(e) => update({ status: e.target.value })} />
        <div className="field toolbar-check"><Checkbox label="Archived batches" checked={showingArchived} onChange={(e) => update({ archived: e.target.checked ? 'true' : '' })} /></div>
      </FilterToolbar>
      <DataTable columns={columns} rows={list.data && list.data.data} loading={list.loading} error={list.error} onRetry={list.reload}
        sort={state} onSort={update} filtered={hasFilters} isSearch={Boolean(state.search)} onClearFilters={clear}
        onRowClick={(r) => navigate(`${r.productType === 'COSMETIC' ? '/cosmetics' : '/medicines'}/${r.medicineId}`)}
        empty={showingArchived
          ? <EmptyState icon={Archive} title="No archived batches" message="Empty batches you archive are listed here and can be restored." />
          : <EmptyState icon={Boxes} title="No stock recorded" message="Stock appears after receiving a purchase or adding stock to a medicine." learnHow="purchasing-and-receiving" />} />
      <Pagination pagination={list.data && list.data.pagination} onChange={(page) => update({ page }, { resetPage: false })} />
      {modal && modal.type === 'adjust' && <AdjustStockModal open inventory={modal.row} onClose={() => setModal(null)} onSaved={() => list.reload({ silent: true })} />}
      {modal && modal.type === 'dispose' && <DisposeStockModal item={modal.row} onClose={() => setModal(null)} onDone={() => { setModal(null); list.reload({ silent: true }); }} />}
      {modal && ['minimumStock', 'sellingPrice'].includes(modal.type) && <InventorySettingModal open inventory={modal.row} field={modal.type} onClose={() => setModal(null)} onSaved={() => list.reload({ silent: true })} />}
    </>
  );
}

function LevelTab({ level, state, update }) {
  const navigate = useNavigate();
  const { branchParam } = useAuth();
  const params = { page: state.page, limit: state.limit, branchId: branchParam };
  const list = useApi(() => api.get(level === 'LOW_STOCK' ? '/inventory/low-stock' : '/inventory/out-of-stock', params), [level, JSON.stringify(params)]);
  return (
    <>
      <DataTable rowKey="medicineId" rows={list.data && list.data.data} loading={list.loading} error={list.error} onRetry={list.reload}
        onRowClick={(r) => navigate(`/medicines/${r.medicineId}`)}
        columns={[
          { key: 'medicineName', label: 'Medicine', render: (r) => <span className="cell-strong">{r.medicineName}</span> },
          { key: 'categoryName', label: 'Category', render: (r) => r.categoryName || '—' },
          { key: 'branchName', label: 'Branch' },
          { key: 'sellableQuantity', label: 'Sellable', align: 'right', render: (r) => formatNumber(r.sellableQuantity) },
          { key: 'minimumStock', label: 'Minimum', align: 'right', render: (r) => formatNumber(r.minimumStock) },
          { key: 'totalQuantity', label: 'On hand (incl. expired)', align: 'right', render: (r) => formatNumber(r.totalQuantity) },
        ]}
        empty={<EmptyState title={level === 'LOW_STOCK' ? 'Nothing is running low' : 'Nothing is out of stock'} learnHow="minimum-stock" />} />
      <Pagination pagination={list.data && list.data.pagination} onChange={(page) => update({ page }, { resetPage: false })} />
    </>
  );
}

function MovementsTab({ state, update, clear, hasFilters }) {
  const { branchParam } = useAuth();
  const params = { ...state, tab: undefined, branchId: branchParam };
  const list = useApi(() => api.get('/inventory/movements', params), [JSON.stringify(params)]);
  return (
    <>
      <FilterToolbar>
        <SelectInput label="Type" value={state.movementType || ''} placeholder="All types" options={MOVEMENT_TYPES} onChange={(e) => update({ movementType: e.target.value })} />
        <div className="field"><span className="field-label">From</span><input className="input" type="date" value={state.dateFrom || ''} onChange={(e) => update({ dateFrom: e.target.value })} /></div>
        <div className="field"><span className="field-label">To</span><input className="input" type="date" value={state.dateTo || ''} onChange={(e) => update({ dateTo: e.target.value })} /></div>
      </FilterToolbar>
      <DataTable rows={list.data && list.data.data} loading={list.loading} error={list.error} onRetry={list.reload}
        sort={state} onSort={update} filtered={hasFilters} onClearFilters={clear}
        columns={[
          { key: 'createdAt', label: 'When', sortable: true, render: (r) => <span className="nowrap small">{formatDateTime(r.createdAt)}</span> },
          { key: 'medicineName', label: 'Medicine', render: (r) => <span className="cell-strong">{r.medicineName}</span> },
          { key: 'batchNumber', label: 'Batch', render: (r) => <span className="mono">{r.batchNumber}</span> },
          { key: 'branchName', label: 'Branch' },
          { key: 'movementType', label: 'Type', sortable: true, render: (r) => humanize(r.movementType) },
          { key: 'quantityChange', label: 'Change', align: 'right', sortable: true, render: (r) => <span className={r.quantityChange < 0 ? 'danger-text' : 'success-text'}>{r.quantityChange > 0 ? '+' : ''}{r.quantityChange}</span> },
          { key: 'quantityAfter', label: 'After', align: 'right' },
          { key: 'createdByName', label: 'By' },
        ]}
        empty={<EmptyState title="No movements recorded" message="Every stock change appears here and can never be edited." />} />
      <Pagination pagination={list.data && list.data.pagination} onChange={(page) => update({ page }, { resetPage: false })} />
    </>
  );
}

export default function InventoryPage() {
  const { can } = useAuth();
  const listState = useListState({ tab: 'stock' });
  const tab = listState.state.tab || 'stock';
  const tabs = [
    { value: 'stock', label: 'Stock' },
    { value: 'low', label: 'Low stock' },
    { value: 'out', label: 'Out of stock' },
    can('INVENTORY_VIEW_MOVEMENTS') && { value: 'movements', label: 'Movement ledger' },
  ].filter(Boolean);

  return (
    <div className="stack">
      <PageHeader title="Inventory" description="Stock per batch and branch. Expired stock is kept but never sold." actions={<LearnHow slug="batches-and-expiry" />} />
      <Panel flush>
        <Tabs tabs={tabs} active={tab} onChange={(value) => listState.clear() || listState.update({ tab: value })} />
        {tab === 'stock' && <StockTab {...listState} />}
        {tab === 'low' && <LevelTab level="LOW_STOCK" {...listState} />}
        {tab === 'out' && <LevelTab level="OUT_OF_STOCK" {...listState} />}
        {tab === 'movements' && <MovementsTab {...listState} />}
      </Panel>
    </div>
  );
}
