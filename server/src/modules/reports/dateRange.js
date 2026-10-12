const AppError = require('../../errors/AppError');
const { businessToday, addDays } = require('../../utils/time');

function daysBetween(from, to) {
  return Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000);
}

/**
 * Resolves a reporting period in the business calendar.
 *   TODAY, WEEK (last 7 days), MONTH (month to date), YEAR (year to date),
 *   CUSTOM (dateFrom/dateTo). Future dates are rejected.
 * Granularity: hour for a single day, day up to ~2 months, otherwise month.
 */
function resolveDateRange({ range, dateFrom, dateTo } = {}) {
  const today = businessToday();
  let from;
  let to = today;

  switch (range || (dateFrom || dateTo ? 'CUSTOM' : 'TODAY')) {
    case 'TODAY':
      from = today;
      break;
    case 'WEEK':
      from = addDays(today, -6);
      break;
    case 'MONTH':
      from = `${today.slice(0, 7)}-01`;
      break;
    case 'YEAR':
      from = `${today.slice(0, 4)}-01-01`;
      break;
    case 'CUSTOM':
      from = dateFrom || dateTo;
      to = dateTo || dateFrom;
      if (!from) throw AppError.validation('Choose a start and end date.', { fields: { dateFrom: 'Required.' } });
      break;
    default:
      throw AppError.validation('Unknown date range.', { fields: { range: 'Unknown range.' } });
  }

  if (from > today || to > today) {
    throw AppError.validation('Future dates are not allowed.', { fields: { dateTo: 'Cannot be in the future.' }, code: 'FUTURE_DATE' });
  }
  if (from > to) {
    throw AppError.validation('The start date must be on or before the end date.', { fields: { dateFrom: 'After the end date.' } });
  }

  const span = daysBetween(from, to);
  const granularity = span === 0 ? 'hour' : span <= 62 ? 'day' : 'month';
  return { dateFrom: from, dateTo: to, granularity, days: span + 1 };
}

module.exports = { resolveDateRange };
