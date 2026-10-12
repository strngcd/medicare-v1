const config = require('../config');

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: config.businessTimezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Calendar date ('YYYY-MM-DD') of an instant in the business time zone. */
function toBusinessDate(instant = new Date()) {
  return dateFormatter.format(instant);
}

/** Today's business date, e.g. '2026-10-12'. */
function businessToday() {
  return toBusinessDate(new Date());
}

/** Adds whole days to a 'YYYY-MM-DD' date string. */
function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function businessYear(instant = new Date()) {
  return Number.parseInt(toBusinessDate(instant).slice(0, 4), 10);
}

module.exports = { toBusinessDate, businessToday, addDays, businessYear };
