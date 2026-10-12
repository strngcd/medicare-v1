import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Boxes, MoreHorizontal, SlidersHorizontal, Search } from 'lucide-react';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useListState } from '../../hooks/useListState.js';
import { useCategories, toOptions } from '../../hooks/useLookups.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Panel, DataTable, Pagination, StatusBadge, EmptyState, SelectInput, Tabs, Dropdown, IconButton, LearnHow } from '../../components/ui/index.js';
import { AdjustStockModal } from '../../components/inventory/AdjustStockModal.jsx';
import { InventorySettingModal } from '../../components/inventory/InventorySettingModal.jsx';
import { formatDate, formatDateTime, formatMoney, formatNumber, humanize } from '../../utils/format.js';

const STATUSES = ['AVAILABLE', 'LOW_STOCK', 'OUT_OF_STOCK', 'EXPIRING_SOON', 'EXPIRED'].map((s) => ({ value: s, label: humanize(s) }));
const MOVEMENT_TYPES = ['PURCHASE_RECEIVED', 'SALE', 'REFUND', 'ADJUSTMENT', 'TRANSFER_OUT', 'TRANSFER_IN', 'EXPIRED', 'DAMAGED', 'LOST', 'CORRECTION']
  .map((s) => ({ value: s, label: humanize(s) }));

function StockTab({ state, update, clear, hasFilters }) {
  const navigate = useNavigate();
  const { branchParam, can } = useAuth();
  const categories = useCategories();
  const [modal, setModal] = useState(null);
  const params = { ...state, tab: undefined, branchId: branchParam };
  const list = useApi(() => api.get('/inventory', params), [JSON.stringify(params)]);

  const columns = [
    { key: 'medicineName', label: 'Medicine', sortable: true, render: (r) => <span className="cell-strong">{r.medicineName}</span> },
    { key: 'branchName', label: 'Branch', sortable: true },
    can('INVENTORY_VIEW_BATCHES') && { key: 'batchNumber', label: 'Batch', render: (r) => <span className="mono">{r.batchNumber}</span> },
    { key: 'expiryDate', label: 'Expiry', sortable: true, render: (r) => formatDate(r.expiryDate) },
    { key: 'quantity', label: 'Qty', align: 'right', sortable: true, render: (r) => formatNumber(r.quantity) },
    { key: 'sellingPrice', label: 'Price', align: 'right', sortable: true, render: (r) => formatMoney(r.sellingPrice) },
    can('FINANCIAL_VIEW_PURCHASE_COST') && { key: 'inventoryValue', label: 'Value (cost)', align: 'right', render: (r) => formatMoney(r.inventoryValue) },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    can('INVENTORY_ADJUST') && {
      key: 'actions',
      label: '',
      render: (r) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Dropdown trigger={({ toggle }) => <IconButton icon={MoreHorizontal} label="Stock actions" onClick={toggle} />}>
            <button type="button" className="dropdown-item" onClick={() => setModal({ type: 'adjust', row: r })}><SlidersHorizontal aria-hidden="true" /> Adjust quantity</button>
            <button type="button" className="dropdown-item" onClick={() => setModal({ type: 'minimumStock', row: r })}>Change minimum stock</button>
            <button type="button" className="dropdown-item" onClick={() => setModal({ type: 'sellingPrice', row: r })}>Change selling price</button>
          </Dropdown>
        </span>
      ),
    },
  ].filter(Boolean);

  return (
    <>
      <div className="toolbar">
        <div className="field search-field">
          <span className="field-label">Search</span>
          <div className="input-with-icon">
            <Search aria-hidden="true" />
            <input className="input" type="search" placeholder="Medicine, batch or barcode" defaultValue={state.search || ''} onChange={(e) => update({ search: e.target.value })} aria-label="Search stock" />
          </div>
        </div>
        <SelectInput label="Category" value={state.categoryId || ''} placeholder="All categories" options={toOptions(categories.data)} onChange={(e) => update({ categoryId: e.target.value })} />
        <SelectInput label="Status" value={state.status || ''} placeholder="All statuses" options={STATUSES} onChange={(e) => update({ status: e.target.value })} />
      </div>
      <DataTable columns={columns} rows={list.data && list.data.data} loading={list.loading} error={list.error} onRetry={list.reload}
        sort={state} onSort={update} filtered={hasFilters} isSearch={Boolean(state.search)} onClearFilters={clear}
        onRowClick={(r) => navigate(`/medicines/${r.medicineId}`)}
        empty={<EmptyState icon={Boxes} title="No stock recorded" message="Stock appears after receiving a purchase or adding stock to a medicine." learnHow="purchasing-and-receiving" />} />
      <Pagination pagination={list.data && list.data.pagination} onChange={(page) => update({ page }, { resetPage: false })} />
      {modal && modal.type === 'adjust' && <AdjustStockModal open inventory={modal.row} onClose={() => setModal(null)} onSaved={() => list.reload({ silent: true })} />}
      {modal && modal.type !== 'adjust' && <InventorySettingModal open inventory={modal.row} field={modal.type} onClose={() => setModal(null)} onSaved={() => list.reload({ silent: true })} />}
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
      <div className="toolbar">
        <SelectInput label="Type" value={state.movementType || ''} placeholder="All types" options={MOVEMENT_TYPES} onChange={(e) => update({ movementType: e.target.value })} />
        <div className="field"><span className="field-label">From</span><input className="input" type="date" value={state.dateFrom || ''} onChange={(e) => update({ dateFrom: e.target.value })} /></div>
        <div className="field"><span className="field-label">To</span><input className="input" type="date" value={state.dateTo || ''} onChange={(e) => update({ dateTo: e.target.value })} /></div>
      </div>
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
