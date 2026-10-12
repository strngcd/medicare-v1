const Decimal = require('decimal.js');

/**
 * All authoritative money arithmetic uses decimal.js and is rounded to
 * 2 places (half-up), matching NUMERIC(14,2) in PostgreSQL.
 */
Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

const ZERO = new Decimal(0);

function money(value) {
  return new Decimal(value ?? 0);
}

function round2(value) {
  return money(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Serialize for SQL parameters / JSON: always a fixed 2-decimal string. */
function toMoneyString(value) {
  return round2(value).toFixed(2);
}

function sum(values) {
  return values.reduce((acc, v) => acc.plus(money(v)), ZERO);
}

module.exports = { Decimal, ZERO, money, round2, toMoneyString, sum };
