import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, FileText, Printer } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader, Panel, Tabs, Button, Kpi, DataTable, Pagination, EmptyState, ErrorState, SkeletonRows, SelectInput, Unauthorized, LearnHow } from '../../components/ui/index.js';
import { DateRangePicker, useDateRange } from '../../components/DateRangePicker.jsx';
import { chartColors, shortPeriodLabel } from '../../components/charts/ChartTheme.js';
import { formatDate, formatDateTime, formatMoney, formatNumber, humanize } from '../../utils/format.js';

const REPORTS = [
  { value: 'sales', label: 'Sales', permission: 'REPORT_SALES_VIEW', path: '/reports/sales', exportPath: '/reports/sales/export', dated: true },
  { value: 'profit', label: 'Profit', permission: 'REPORT_PROFIT_VIEW', also: 'FINANCIAL_VIEW_PROFIT', path: '/reports/profit', exportPath: '/reports/profit/export', dated: true },
  { value: 'inventory', label: 'Inventory', permission: 'REPORT_INVENTORY_VIEW', path: '/reports/inventory', exportPath: '/reports/inventory/export' },
  { value: 'movements', label: 'Inventory movements', permission: 'REPORT_INVENTORY_VIEW', path: '/reports/inventory/movements', dated: true },
  { value: 'losses', label: 'Stock losses', permission: 'REPORT_INVENTORY_VIEW', also: 'FINANCIAL_VIEW_PURCHASE_COST', path: '/reports/losses', exportPath: '/reports/losses/export', dated: true },
  { value: 'purchases', label: 'Purchases', permission: 'REPORT_PURCHASE_VIEW', path: '/reports/purchases', exportPath: '/reports/purchases/export', dated: true },
  { value: 'suppliers', label: 'Suppliers', permission: 'REPORT_SUPPLIER_VIEW', path: '/reports/suppliers', exportPath: '/reports/suppliers/export', dated: true },
];

const MONEY_KEYS = /(sales|amount|total|revenue|cogs|profit|discount|tax|refunds|value|paid|outstanding|balance|purchased|price|subtotal|cost|losses)$/i;
const NON_MONEY = new Set(['transactionCount', 'refundCount', 'voidedCount', 'purchaseCount', 'cancelledCount', 'openCount', 'totalUnits', 'expiredUnits', 'itemsSold', 'itemsRefunded', 'unitsLost', 'entryCount']);

function formatCell(key, value) {
  if (value === null || value === undefined) return '—';
  if (/At$/.test(key)) return formatDateTime(value);
  if (/Date$|Expiry$/.test(key)) return formatDate(value);
  if (key === 'grossMargin') return `${value}%`;
  if (!NON_MONEY.has(key) && MONEY_KEYS.test(key) && /^-?\d+(\.\d+)?$/.test(String(value))) return formatMoney(value);
  if (typeof value === 'number') return formatNumber(value);
  if (/^[A-Z_]+$/.test(String(value))) return humanize(value);
  return String(value);
}

function SummaryTiles({ summary }) {
  if (!summary) return null;
  if (Array.isArray(summary)) {
    return (
      <div className="grid-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        {summary.map((row) => (
          <Kpi key={row.movementType} label={humanize(row.movementType)} value={`+${formatNumber(row.unitsIn)} / -${formatNumber(row.unitsOut)}`} note={`${row.movementCount} movements`} />
        ))}
      </div>
    );
  }
  const entries = Object.entries(summary).filter(([, v]) => v === null || typeof v !== 'object');
  return (
    <div className="grid-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
      {entries.map(([key, value]) => <Kpi key={key} label={humanize(key.replace(/([A-Z])/g, '_$1'))} value={formatCell(key, value)} />)}
    </div>
  );
}

function SeriesChart({ series, granularity }) {
  const colors = chartColors();
  if (!series || series.every((p) => Number(p.sales) === 0 && Number(p.refunds) === 0)) return null;
  return (
    <Panel title="Sales and refunds over time">
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={series}>
          <CartesianGrid stroke={colors.grid} vertical={false} />
          <XAxis dataKey="period" tickFormatter={(p) => shortPeriodLabel(p, granularity)} fontSize={11} stroke={colors.text} tickLine={false} />
          <YAxis fontSize={11} stroke={colors.text} axisLine={false} tickLine={false} width={56} />
          <Tooltip formatter={(v, n) => [formatMoney(v), humanize(n)]} />
          <Bar dataKey="sales" fill={colors.primary} />
          <Bar dataKey="refunds" fill={colors.danger} />
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  );
}

function ReportView({ report }) {
  const { branchParam, can } = useAuth();
  const toast = useToast();
  const range = useDateRange(report.value === 'purchases' ? 'MONTH' : report.value === 'suppliers' ? 'YEAR' : 'MONTH');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const filterParam = report.value === 'losses' ? 'movementType' : 'status';
  const [exporting, setExporting] = useState(null);
  const params = { ...(report.dated ? range.params : {}), branchId: branchParam, page, ...(status ? { [filterParam]: status } : {}) };
  const data = useApi(() => api.get(report.path, params), [report.value, JSON.stringify(params)]);

  const doExport = async (format) => {
    setExporting(format);
    try {
      const { page: _p, ...filters } = params;
      await api.download(report.exportPath, { ...filters, format }, `${report.value}-report.${format}`);
      toast.success('Export downloaded.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setExporting(null);
    }
  };

  const statusOptions = {
    inventory: ['AVAILABLE', 'LOW_STOCK', 'OUT_OF_STOCK', 'EXPIRING_SOON'],
    purchases: ['DRAFT', 'PENDING', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
    sales: ['COMPLETED', 'VOIDED'],
    losses: ['DISPOSED', 'EXPIRED', 'DAMAGED', 'LOST'],
  }[report.value];

  const d = data.data && data.data.data;
  return (
    <div className="stack">
      <div className="spread" style={{ flexWrap: 'wrap' }}>
        <div className="row-wrap">
          {report.dated && <DateRangePicker range={{ ...range, setRange: (v) => { setPage(1); range.setRange(v); } }} />}
          {statusOptions && (
            <select className="select" style={{ width: 180 }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label={filterParam === 'status' ? 'Status filter' : 'Type filter'}>
              <option value="">{filterParam === 'status' ? 'All statuses' : 'All types'}</option>
              {statusOptions.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
            </select>
          )}
        </div>
        {report.exportPath && can('REPORT_EXPORT') && (
          <div className="row-wrap no-print">
            <Button variant="secondary" icon={Download} onClick={() => doExport('csv')} loading={exporting === 'csv'}>CSV</Button>
            <Button variant="secondary" icon={FileText} onClick={() => doExport('pdf')} loading={exporting === 'pdf'}>PDF</Button>
            <Button variant="ghost" icon={Printer} onClick={() => window.print()}>Print</Button>
          </div>
        )}
      </div>

      {data.error && <Panel><ErrorState error={data.error} onRetry={data.reload} /></Panel>}
      {!d && !data.error && <Panel><SkeletonRows rows={6} /></Panel>}
      {d && (
        <>
          {d.period && <p className="small muted">{formatDate(d.period.dateFrom)} – {formatDate(d.period.dateTo)}</p>}
          {d.asOf && <p className="small muted">Stock position as of {formatDate(d.asOf)}</p>}
          <SummaryTiles summary={d.summary} />
          {d.series && <SeriesChart series={d.series} granularity={d.period.granularity} />}
          {d.byCategory && d.byCategory.length > 0 && (
            <Panel title="By category" flush>
              <DataTable rowKey="categoryName" rows={d.byCategory} columns={Object.keys(d.byCategory[0]).map((key) => ({
                key, label: humanize(key.replace(/([A-Z])/g, '_$1')), align: typeof d.byCategory[0][key] === 'string' && key !== 'categoryName' ? 'right' : undefined,
                render: (row) => formatCell(key, row[key]),
              }))} />
            </Panel>
          )}
          <Panel title="Details" flush>
            <DataTable
              rowKey={d.rows[0] && d.rows[0].id ? 'id' : undefined}
              rows={d.rows}
              loading={data.loading}
              columns={d.columns.map((c) => ({ key: c.key, label: c.label, render: (row) => formatCell(c.key, row[c.key]) }))}
              empty={<EmptyState title="No records for this period" message="Try a wider date range or another branch." />}
            />
            {data.data.pagination && <Pagination pagination={data.data.pagination} onChange={setPage} />}
          </Panel>
        </>
      )}
    </div>
  );
}

export default function ReportsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const available = REPORTS.filter((r) => can(r.permission) && (!r.also || can(r.also)));
  if (available.length === 0) return <Unauthorized />;
  const current = available.find((r) => r.value === params.get('report')) || available[0];
  return (
    <div className="stack">
      <PageHeader title="Reports" description="Figures are calculated by the server from completed transactions. Exports use the same filters and permissions." actions={<LearnHow slug="reports-overview" />} />
      <Tabs tabs={available} active={current.value} onChange={(value) => setParams({ report: value })} />
      <ReportView key={current.value} report={current} />
    </div>
  );
}
