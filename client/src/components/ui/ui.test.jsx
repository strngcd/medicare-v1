import { render, screen, fireEvent } from '@testing-library/react';
import { DataTable } from './DataTable.jsx';
import { StatusBadge } from './Badge.jsx';
import { EmptyState } from './States.jsx';
import { MemoryRouter } from 'react-router-dom';

const columns = [{ key: 'name', label: 'Name' }, { key: 'qty', label: 'Qty', align: 'right' }];

function renderTable(props) {
  return render(<MemoryRouter><DataTable columns={columns} {...props} /></MemoryRouter>);
}

test('shows a skeleton, never an empty state, while loading', () => {
  renderTable({ rows: null, loading: true, empty: <EmptyState title="Nothing here" /> });
  expect(screen.getByLabelText('Loading')).toBeInTheDocument();
  expect(screen.queryByText('Nothing here')).not.toBeInTheDocument();
});

test('distinguishes genuine empty from filtered empty', () => {
  const { rerender } = renderTable({ rows: [], empty: <EmptyState title="No medicines yet" /> });
  expect(screen.getByText('No medicines yet')).toBeInTheDocument();
  const onClear = jest.fn();
  rerender(<MemoryRouter><DataTable columns={columns} rows={[]} filtered onClearFilters={onClear} empty={<EmptyState title="No medicines yet" />} /></MemoryRouter>);
  expect(screen.getByText('No results for these filters')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Clear filters'));
  expect(onClear).toHaveBeenCalled();
});

test('shows a friendly error with retry, and the unauthorized state for 403', () => {
  const onRetry = jest.fn();
  const { rerender } = renderTable({ rows: null, error: { status: 500, message: 'Something went wrong on our side.' }, onRetry });
  fireEvent.click(screen.getByText('Try again'));
  expect(onRetry).toHaveBeenCalled();
  rerender(<MemoryRouter><DataTable columns={columns} rows={null} error={{ status: 403, message: 'x' }} /></MemoryRouter>);
  expect(screen.getByText('You do not have access')).toBeInTheDocument();
});

test('renders rows with labels for the mobile card layout', () => {
  renderTable({ rows: [{ id: 1, name: 'Amoxicillin', qty: 4 }] });
  expect(screen.getByText('Amoxicillin').closest('td')).toHaveAttribute('data-label', 'Name');
});

test('status badges use readable labels', () => {
  render(<StatusBadge status="PARTIALLY_RECEIVED" />);
  expect(screen.getByText('Partially received')).toBeInTheDocument();
});
