const { money } = require('../../utils/money');

/**
 * Column totals for a report's rows. Only columns marked `total: 'money'` or
 * `total: 'count'` are summed; rows matching `report.totalsExclude` (e.g. voided sales) are left
 * out, as they are in the report summary.
 */
function computeTotals(report) {
  const columns = report.columns.filter((c) => c.total);
  if (columns.length === 0) return null;
  const exclude = report.totalsExclude;
  const rows = exclude ? report.rows.filter((r) => !exclude.values.includes(r[exclude.key])) : report.rows;

  const totals = {};
  for (const column of columns) {
    let sum = money(0);
    for (const row of rows) {
      const value = row[column.key];
      if (value !== null && value !== undefined && value !== '') sum = sum.plus(money(value));
    }
    totals[column.key] = column.total === 'money' ? sum.toFixed(2) : sum.toFixed(0);
  }
  return {
    label: exclude && rows.length !== report.rows.length ? `Total (${exclude.note})` : 'Total',
    values: totals,
  };
}

module.exports = { computeTotals };
