import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { SkeletonRows, ErrorState, FilteredEmpty } from './States.jsx';
import { Button } from './Button.jsx';

/**
 * Data table with the standard UI states:
 * loading skeleton (never an empty state while loading), error with retry,
 * genuine empty vs filtered/search empty, and stacked cards on phones.
 *
 * columns: [{ key, label, render?, sortable?, align?, width? }]
 * footer: optional { label, values: { [columnKey]: text } } shown as a totals row;
 * the label goes in the first column without a value.
 */
export function DataTable({
  columns,
  rows,
  loading,
  error,
  onRetry,
  rowKey = 'id',
  onRowClick,
  sort,
  onSort,
  empty,
  filtered,
  onClearFilters,
  isSearch,
  footer,
}) {
  if (error && !rows) return <ErrorState error={error} onRetry={onRetry} />;
  if (loading && !rows) return <SkeletonRows columns={Math.min(columns.length, 5)} />;
  if (rows && rows.length === 0) {
    return filtered ? <FilteredEmpty onClear={onClearFilters} isSearch={isSearch} /> : empty;
  }
  if (!rows) return null;

  const toggleSort = (key) => {
    if (!onSort) return;
    const nextOrder = sort && sort.sortBy === key && sort.sortOrder === 'asc' ? 'desc' : 'asc';
    onSort({ sortBy: key, sortOrder: nextOrder });
  };

  return (
    <div className="table-wrap" aria-busy={loading || undefined} style={{ opacity: loading ? 0.6 : 1 }}>
      <table className="table responsive">
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort && sort.sortBy === c.key;
              const SortIcon = !active ? ArrowUpDown : sort.sortOrder === 'asc' ? ArrowUp : ArrowDown;
              return (
                <th
                  key={c.key}
                  className={`${c.sortable ? 'sortable' : ''} ${c.align === 'right' ? 'num' : ''}`}
                  style={c.width ? { width: c.width } : undefined}
                  onClick={c.sortable ? () => toggleSort(c.key) : undefined}
                  aria-sort={active ? (sort.sortOrder === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {c.label}
                  {c.sortable && <SortIcon className="sort-icon" aria-hidden="true" />}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row[rowKey] || index}
              className={onRowClick ? 'clickable' : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} data-label={c.label} className={c.align === 'right' ? 'num' : undefined}>
                  {c.render ? c.render(row) : row[c.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && (
          <tfoot>
            <tr className="total-row">
              {columns.map((c, i) => {
                const labelAt = columns.findIndex((col) => !(col.key in footer.values));
                const has = c.key in footer.values;
                return (
                  <td key={c.key} data-label={has ? c.label : ''} className={c.align === 'right' ? 'num' : undefined}>
                    {has ? footer.values[c.key] : i === labelAt ? footer.label : null}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export function Pagination({ pagination, onChange }) {
  if (!pagination || pagination.total === 0) return null;
  const { page, limit, total, totalPages } = pagination;
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  return (
    <div className="pagination">
      <span>{from}–{to} of {total.toLocaleString()}</span>
      <div className="row">
        <Button variant="secondary" size="sm" icon={ChevronLeft} disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</Button>
        <span>Page {page} of {totalPages}</span>
        <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
          Next
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
