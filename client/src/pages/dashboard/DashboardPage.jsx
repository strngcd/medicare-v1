import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar,
} from 'recharts';
import {
  Banknote, Receipt, Package, Calculator, Pill, TrendingDown, PackageX, CalendarClock, CalendarX2,
  Wallet, Percent, Landmark, Coins, Scale, Trash2,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { useApi, usePolling } from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Panel, Kpi, ErrorState, EmptyState, SelectInput, Skeleton, StatusBadge } from '../../components/ui/index.js';
import { formatMoney, formatNumber, humanize } from '../../utils/format.js';
import { chartColors, shortPeriodLabel } from '../../components/charts/ChartTheme.js';
import { DateRangePicker, useDateRange } from '../../components/DateRangePicker.jsx';

const DASHBOARD_REFRESH_MS = 30000;

function SalesTrendChart({ data }) {
  const colors = chartColors();
  if (!data) return <Skeleton height={260} />;
  if (data.series.every((p) => Number(p.sales) === 0)) {
    return <EmptyState title="No sales in this period" message="Completed sales will appear here." learnHow="using-the-pos" />;
  }
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data.series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={colors.grid} vertical={false} />
        <XAxis dataKey="period" tickFormatter={(p) => shortPeriodLabel(p, data.granularity)} stroke={colors.text} fontSize={11} tickLine={false} />
        <YAxis stroke={colors.text} fontSize={11} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => formatNumber(v)} />
        <Tooltip formatter={(v, name) => [formatMoney(v), humanize(name)]} labelFormatter={(p) => p} />
        <Area type="monotone" dataKey="sales" stroke={colors.primary} fill={colors.primary} fillOpacity={0.12} strokeWidth={2} name="sales" />
        <Area type="monotone" dataKey="refunds" stroke={colors.danger} fill="transparent" strokeWidth={1.5} name="refunds" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function TopMedicines({ data }) {
  if (!data) return <Skeleton height={200} />;
  if (data.items.length === 0) return <EmptyState title="No medicines sold yet" message="Top sellers for the period appear here." />;
  return (
    <table className="table">
      <thead>
        <tr><th>Medicine</th><th className="num">Net qty</th>{data.items[0].revenue !== undefined && <th className="num">Revenue</th>}</tr>
      </thead>
      <tbody>
        {data.items.map((m) => (
          <tr key={m.medicineId}>
            <td className="cell-strong">{m.medicineName}</td>
            <td className="num">{formatNumber(m.netQuantity)}</td>
            {m.revenue !== undefined && <td className="num">{formatMoney(m.revenue)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CategoryChart({ data }) {
  const colors = chartColors();
  if (!data) return <Skeleton height={200} />;
  if (data.categories.length === 0) return <EmptyState title="No category sales yet" />;
  const valueKey = data.categories[0].revenue !== undefined ? 'revenue' : 'netQuantity';
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.categories.length * 34)}>
      <BarChart data={data.categories} layout="vertical" margin={{ left: 8, right: 16 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="categoryName" width={130} fontSize={11.5} stroke={colors.text} tickLine={false} axisLine={false} />
        <Tooltip formatter={(v) => (valueKey === 'revenue' ? formatMoney(v) : formatNumber(v))} />
        <Bar dataKey={valueKey} fill={colors.primary} radius={[0, 3, 3, 0]} barSize={16} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { branchParam, can, isAllBranches, selectedBranch } = useAuth();
  const range = useDateRange('TODAY');
  const params = { ...range.params, branchId: branchParam };
  const key = JSON.stringify(params);

  const dashboard = useApi(() => api.get('/analytics/dashboard', params).then((r) => r.data), [key]);
  const trend = useApi(() => api.get('/analytics/sales-trend', params).then((r) => r.data), [key]);
  const top = useApi(() => api.get('/analytics/top-medicines', { ...params, limit: 8 }).then((r) => r.data), [key]);
  const categories = useApi(() => api.get('/analytics/sales-by-category', params).then((r) => r.data), [key]);
  const branches = useApi(
    () => (isAllBranches ? api.get('/analytics/branch-comparison', range.params).then((r) => r.data) : Promise.resolve(null)),
    [key, isAllBranches],
  );

  // Keep today's figures current while the dashboard stays open: refresh in
  // the background and again whenever the tab comes back into view.
  const refresh = () => [dashboard, trend, top, categories, branches].forEach((r) => r.reload({ silent: true }));
  usePolling(refresh, DASHBOARD_REFRESH_MS);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, isAllBranches]);

  const d = dashboard.data;
  const f = d && d.financials;
  const loading = dashboard.loading && !d;

  return (
    <div className="stack">
      <PageHeader
        title="Dashboard"
        description={isAllBranches ? 'All branches' : selectedBranch ? selectedBranch.name : 'Your branches'}
        actions={<DateRangePicker range={range} />}
      />

      {dashboard.error && !d ? (
        <Panel><ErrorState error={dashboard.error} onRetry={dashboard.reload} /></Panel>
      ) : (
        <>
          <div className="grid-4">
            <Kpi icon={Banknote} label={range.label === 'Today' ? "Today's sales" : 'Sales'} value={d && formatMoney(d.sales.totalSales)} loading={loading} />
            <Kpi icon={Receipt} label="Transactions" value={d && formatNumber(d.sales.transactionCount)} loading={loading} />
            <Kpi icon={Package} label="Items sold" value={d && formatNumber(d.sales.itemsSold)} loading={loading} />
            <Kpi icon={Calculator} label="Average transaction" value={d && formatMoney(d.sales.averageTransactionValue)} loading={loading} />
          </div>

          <div className="grid-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
            <Kpi icon={Pill} label="Active medicines" value={d && formatNumber(d.inventory.totalMedicines)} loading={loading} onClick={() => navigate('/medicines?status=ACTIVE')} />
            <Kpi icon={TrendingDown} label="Low stock" value={d && formatNumber(d.inventory.lowStock)} tone={d && d.inventory.lowStock ? 'warning' : undefined} loading={loading} onClick={() => navigate('/alerts?type=LOW_STOCK')} />
            <Kpi icon={PackageX} label="Out of stock" value={d && formatNumber(d.inventory.outOfStock)} tone={d && d.inventory.outOfStock ? 'danger' : undefined} loading={loading} onClick={() => navigate('/alerts?type=OUT_OF_STOCK')} />
            <Kpi icon={CalendarClock} label="Expiring soon" value={d && formatNumber(d.inventory.expiringSoon)} tone={d && d.inventory.expiringSoon ? 'warning' : undefined} loading={loading} onClick={() => navigate('/alerts?type=EXPIRING_SOON')} />
            <Kpi icon={CalendarX2} label="Expired batches" value={d && formatNumber(d.inventory.expired)} tone={d && d.inventory.expired ? 'danger' : undefined} loading={loading} onClick={() => navigate('/alerts?type=EXPIRED')} />
          </div>

          {f && Object.keys(f).length > 0 && (
            <div className="grid-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
              {f.revenue !== undefined && <Kpi icon={Wallet} label="Revenue (excl. tax)" value={formatMoney(f.revenue)} note="Net of refunds" />}
              {f.netSales !== undefined && <Kpi icon={Coins} label="Net sales" value={formatMoney(f.netSales)} note={`Refunds ${formatMoney(f.refunds)}`} />}
              {f.discounts !== undefined && <Kpi icon={Percent} label="Discounts" value={formatMoney(f.discounts)} />}
              {f.tax !== undefined && <Kpi icon={Landmark} label="Tax collected" value={formatMoney(f.tax)} />}
              {f.cogs !== undefined && <Kpi icon={Scale} label="Cost of goods sold" value={formatMoney(f.cogs)} />}
              {f.grossProfit !== undefined && <Kpi icon={Banknote} label="Gross profit" value={formatMoney(f.grossProfit)} note={`Margin ${f.grossMargin}%`} />}
              {f.inventoryValue !== undefined && <Kpi icon={Package} label="Inventory value (cost)" value={formatMoney(f.inventoryValue)} />}
              {f.stockLosses !== undefined && (
                <Kpi icon={Trash2} label="Stock losses (cost)" value={formatMoney(f.stockLosses)}
                  tone={Number(f.stockLosses) > 0 ? 'danger' : undefined}
                  note={`${formatNumber(f.stockLossUnits)} unit${f.stockLossUnits === 1 ? '' : 's'} expired, damaged, lost or disposed`}
                  onClick={can('REPORT_INVENTORY_VIEW') ? () => navigate('/reports?report=losses') : undefined} />
              )}
            </div>
          )}
        </>
      )}

      <Panel title="Sales over time">
        {trend.error ? <ErrorState error={trend.error} onRetry={trend.reload} /> : <SalesTrendChart data={trend.data} />}
      </Panel>

      <div className="grid-2">
        <Panel title="Top-selling medicines" flush>
          {top.error ? <ErrorState error={top.error} onRetry={top.reload} /> : <TopMedicines data={top.data} />}
        </Panel>
        <Panel title="Sales by category">
          {categories.error ? <ErrorState error={categories.error} onRetry={categories.reload} /> : <CategoryChart data={categories.data} />}
        </Panel>
      </div>

      {isAllBranches && (
        <Panel title="Branch comparison" flush>
          {branches.error && <ErrorState error={branches.error} onRetry={branches.reload} />}
          {!branches.data && !branches.error && <Skeleton height={120} />}
          {branches.data && (
            <div className="table-wrap">
              <table className="table responsive">
                <thead>
                  <tr>
                    <th>Branch</th><th className="num">Transactions</th><th className="num">Sales</th><th className="num">Refunds</th>
                    <th className="num">Net sales</th><th className="num">Avg. transaction</th>
                    {can('DASHBOARD_VIEW_PROFIT') && can('FINANCIAL_VIEW_PROFIT') && <th className="num">Gross profit</th>}
                  </tr>
                </thead>
                <tbody>
                  {branches.data.branches.map((b) => (
                    <tr key={b.branchId}>
                      <td data-label="Branch" className="cell-strong">{b.branchName} {b.status !== 'ACTIVE' && <StatusBadge status={b.status} />}</td>
                      <td data-label="Transactions" className="num">{formatNumber(b.transactionCount)}</td>
                      <td data-label="Sales" className="num">{formatMoney(b.totalSales)}</td>
                      <td data-label="Refunds" className="num">{formatMoney(b.refunds)}</td>
                      <td data-label="Net sales" className="num">{formatMoney(b.netSales)}</td>
                      <td data-label="Avg. transaction" className="num">{formatMoney(b.averageTransactionValue)}</td>
                      {b.grossProfit !== undefined && <td data-label="Gross profit" className="num">{formatMoney(b.grossProfit)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
