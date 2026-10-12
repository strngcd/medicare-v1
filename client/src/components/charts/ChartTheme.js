/** Chart colors read from CSS tokens so charts follow light/dark themes. */
export function chartColors() {
  const style = getComputedStyle(document.documentElement);
  const v = (name) => style.getPropertyValue(name).trim();
  return {
    primary: v('--primary') || '#0e8c96',
    secondary: v('--navy-600') || '#284a7a',
    danger: v('--danger') || '#b42318',
    warning: v('--warning') || '#9a6200',
    grid: v('--border') || '#dde3ea',
    text: v('--text-muted') || '#5a6b80',
    series: [v('--primary'), '#284a7a', '#5b8fd1', '#8aa0b8', '#1a7f4b', '#9a6200', '#7a5aa6', '#b42318'],
  };
}

export function shortPeriodLabel(period, granularity) {
  if (granularity === 'hour') return `${period.slice(11, 13)}:00`;
  if (granularity === 'day') return period.slice(5);
  return period;
}
