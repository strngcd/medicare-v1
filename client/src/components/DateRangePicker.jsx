import { useState } from 'react';
import { todayIso } from '../utils/format.js';

const OPTIONS = [
  { value: 'TODAY', label: 'Today' },
  { value: 'WEEK', label: 'Last 7 days' },
  { value: 'MONTH', label: 'This month' },
  { value: 'YEAR', label: 'This year' },
  { value: 'CUSTOM', label: 'Custom' },
];

/** Range state shared by dashboards and reports. Future dates cannot be picked. */
export function useDateRange(initial = 'TODAY') {
  const [range, setRange] = useState(initial);
  const [dateFrom, setDateFrom] = useState(todayIso());
  const [dateTo, setDateTo] = useState(todayIso());
  const params = range === 'CUSTOM' ? { range, dateFrom, dateTo } : { range };
  const label = OPTIONS.find((o) => o.value === range).label;
  return { range, setRange, dateFrom, setDateFrom, dateTo, setDateTo, params, label };
}

export function DateRangePicker({ range }) {
  const max = todayIso();
  return (
    <div className="row-wrap">
      <select className="select" style={{ width: 150 }} aria-label="Date range" value={range.range} onChange={(e) => range.setRange(e.target.value)}>
        {OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {range.range === 'CUSTOM' && (
        <>
          <input className="input" style={{ width: 150 }} type="date" aria-label="From" max={range.dateTo || max} value={range.dateFrom} onChange={(e) => range.setDateFrom(e.target.value)} />
          <input className="input" style={{ width: 150 }} type="date" aria-label="To" min={range.dateFrom} max={max} value={range.dateTo} onChange={(e) => range.setDateTo(e.target.value)} />
        </>
      )}
    </div>
  );
}
