import { useState } from 'react';
import { Download, FileText, Undo2 } from 'lucide-react';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useListState } from '../../hooks/useListState.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader, Panel, DataTable, Pagination, EmptyState, SelectInput, Modal, Details, SkeletonRows, ErrorState, FilterToolbar, Button } from '../../components/ui/index.js';
import { formatDateTime, formatMoney, humanize } from '../../utils/format.js';
import { Link } from 'react-router-dom';

const REASONS = ['CUSTOMER_RETURN', 'DAMAGED_PRODUCT', 'WRONG_ITEM', 'WRONG_QUANTITY', 'DUPLICATE_SALE', 'OTHER'].map((r) => ({ value: r, label: humanize(r) }));

function RefundDetail({ id, onClose }) {
  const refund = useApi(() => api.get(`/refunds/${id}`).then((r) => r.data), [id]);
  const r = refund.data;
  return (
    <Modal open size="lg" title={r ? r.refundNumber : 'Refund'} onClose={onClose}>
      {refund.error && <ErrorState error={refund.error} onRetry={refund.reload} />}
      {!r && !refund.error && <SkeletonRows />}
      {r && (
        <>
          <Details items={[
            { label: 'Sale', value: <Link to={`/sales/${r.saleId}`}>{r.receiptNumber}</Link> },
            { label: 'Branch', value: r.branchName },
            { label: 'Amount', value: formatMoney(r.refundTotal) },
            { label: 'Paid by', value: humanize(r.paymentMethod) },
            { label: 'Reason', value: humanize(r.reason) },
            { label: 'Notes', value: r.notes },
            { label: 'Processed by', value: r.processedByName },
            { label: 'Date', value: formatDateTime(r.createdAt) },
          ]} />
          <DataTable rows={r.items} columns={[
            { key: 'medicineName', label: 'Medicine' },
            { key: 'quantity', label: 'Qty', align: 'right' },
            { key: 'refundAmount', label: 'Amount', align: 'right', render: (i) => formatMoney(i.refundAmount) },
            { key: 'allocations', label: 'Returned to batches', render: (i) => i.allocations.map((a) => `${a.batchNumber} ×${a.quantity}`).join(', ') },
          ]} />
        </>
      )}
    </Modal>
  );
}

export default function RefundsPage() {
  const { branchParam, can } = useAuth();
  const toast = useToast();
  const { state, update, clear, hasFilters } = useListState();
  const params = { ...state, branchId: branchParam };
  const list = useApi(() => api.get('/refunds', params), [JSON.stringify(params)]);
  const [open, setOpen] = useState(null);
  const [exporting, setExporting] = useState(null);
  const canExport = can('REPORT_EXPORT') && can('REPORT_SALES_VIEW');

  // Exports exactly the filtered list (all pages), like the Reports page.
  const doExport = async (format) => {
    setExporting(format);
    try {
      const { page: _page, limit: _limit, sortBy: _sortBy, sortOrder: _sortOrder, ...filters } = params;
      const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined && v !== ''));
      await api.download('/reports/refunds/export', { ...clean, format }, `refunds-report.${format}`);
      toast.success('Export downloaded.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="stack">
      <PageHeader title="Refunds" description="Refunds are created from a sale. Each one returns stock to the original batches."
        actions={canExport && (
          <>
            <Button variant="secondary" icon={Download} onClick={() => doExport('csv')} loading={exporting === 'csv'}>CSV</Button>
            <Button variant="secondary" icon={FileText} onClick={() => doExport('pdf')} loading={exporting === 'pdf'}>PDF</Button>
          </>
        )} />
      <Panel flush>
        <FilterToolbar>
          <div className="field search-field">
            <span className="field-label">Search</span>
            <input className="input" type="search" placeholder="Refund or receipt number" defaultValue={state.search || ''} onChange={(e) => update({ search: e.target.value })} aria-label="Search refunds" />
          </div>
          <SelectInput label="Reason" value={state.reason || ''} placeholder="All" options={REASONS} onChange={(e) => update({ reason: e.target.value })} />
          <div className="field"><span className="field-label">From</span><input className="input" type="date" value={state.dateFrom || ''} onChange={(e) => update({ dateFrom: e.target.value })} /></div>
          <div className="field"><span className="field-label">To</span><input className="input" type="date" value={state.dateTo || ''} onChange={(e) => update({ dateTo: e.target.value })} /></div>
          <div className="field" style={{ minWidth: 100, maxWidth: 130 }}><span className="field-label">Min amount</span><input className="input" inputMode="decimal" placeholder="0.00" defaultValue={state.minAmount || ''} onChange={(e) => update({ minAmount: e.target.value })} aria-label="Minimum amount" /></div>
          <div className="field" style={{ minWidth: 100, maxWidth: 130 }}><span className="field-label">Max amount</span><input className="input" inputMode="decimal" placeholder="Any" defaultValue={state.maxAmount || ''} onChange={(e) => update({ maxAmount: e.target.value })} aria-label="Maximum amount" /></div>
        </FilterToolbar>
        <DataTable rows={list.data && list.data.data} loading={list.loading} error={list.error} onRetry={list.reload}
          sort={state} onSort={update} filtered={hasFilters} isSearch={Boolean(state.search)} onClearFilters={clear}
          onRowClick={(r) => setOpen(r.id)}
          columns={[
            { key: 'refundNumber', label: 'Refund', sortable: true, render: (r) => <span className="mono">{r.refundNumber}</span> },
            { key: 'receiptNumber', label: 'Sale', render: (r) => <span className="mono">{r.receiptNumber}</span> },
            { key: 'createdAt', label: 'Date', sortable: true, render: (r) => formatDateTime(r.createdAt) },
            { key: 'branchName', label: 'Branch' },
            { key: 'reason', label: 'Reason', render: (r) => humanize(r.reason) },
            { key: 'processedByName', label: 'By' },
            { key: 'paymentMethod', label: 'Method', render: (r) => humanize(r.paymentMethod) },
            { key: 'refundTotal', label: 'Amount', align: 'right', sortable: true, render: (r) => formatMoney(r.refundTotal) },
          ]}
          empty={<EmptyState icon={Undo2} title="No refunds" message="Open a sale to process a refund." learnHow="refunds-and-voids" />} />
        <Pagination pagination={list.data && list.data.pagination} onChange={(page) => update({ page }, { resetPage: false })} />
      </Panel>
      {open && <RefundDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
