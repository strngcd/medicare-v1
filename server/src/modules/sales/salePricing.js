/**
 * Authoritative sale arithmetic. Pure functions, decimal math, 2 dp.
 *
 * - One sale-level discount (PERCENTAGE or FIXED) is prorated across lines
 *   by gross amount using the largest-remainder method on cents, so line
 *   discounts always add up exactly to the sale discount.
 * - Tax is calculated per line from the tax configuration snapshot:
 *     ADDED_ON_TOP: tax = (gross - discount) x rate / 100; total adds tax
 *     INCLUDED:     total = gross - discount; tax = total x rate / (100 + rate)
 */
const AppError = require('../../errors/AppError');
const { Decimal, money, round2, sum, toMoneyString } = require('../../utils/money');

function toCents(value) {
  return money(value).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

function fromCents(cents) {
  return new Decimal(cents).dividedBy(100);
}

/** Total discount in money for the sale subtotal. */
function resolveDiscountAmount(subtotal, discount) {
  if (!discount || money(discount.value).isZero()) return money(0);
  if (discount.type === 'PERCENTAGE') {
    if (money(discount.value).gt(100)) {
      throw AppError.validation('A percentage discount cannot exceed 100%.', { fields: { 'discount.value': 'Maximum is 100.' } });
    }
    return round2(money(subtotal).times(discount.value).dividedBy(100));
  }
  const amount = round2(discount.value);
  if (amount.gt(subtotal)) {
    throw AppError.conflict('DISCOUNT_EXCEEDS_SUBTOTAL', 'The discount cannot exceed the sale subtotal.', {
      subtotal: toMoneyString(subtotal),
      discount: toMoneyString(amount),
    });
  }
  return amount;
}

/** Splits `totalCents` across weights proportionally; result sums exactly to totalCents. */
function prorateCents(totalCents, weightsCents) {
  const totalWeight = weightsCents.reduce((a, b) => a + b, 0);
  if (totalCents === 0 || totalWeight === 0) return weightsCents.map(() => 0);

  const raw = weightsCents.map((w) => (totalCents * w) / totalWeight);
  const shares = raw.map((r) => Math.floor(r));
  let remaining = totalCents - shares.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, fraction: r - Math.floor(r) }))
    .sort((a, b) => b.fraction - a.fraction || a.i - b.i);
  for (const { i } of order) {
    if (remaining === 0) break;
    if (shares[i] < weightsCents[i]) {
      shares[i] += 1;
      remaining -= 1;
    }
  }
  return shares;
}

/**
 * @param {{quantity: number, unitPrice: string}[]} lines
 * @param {{type: 'PERCENTAGE'|'FIXED', value: string}|null} discount
 * @param {{enabled: boolean, rate: string, mode: 'INCLUDED'|'ADDED_ON_TOP'}} tax
 */
function priceSale(lines, discount, tax) {
  const grosses = lines.map((l) => round2(money(l.unitPrice).times(l.quantity)));
  const subtotal = sum(grosses);
  const discountAmount = resolveDiscountAmount(subtotal, discount);
  const discountShares = prorateCents(toCents(discountAmount), grosses.map(toCents)).map(fromCents);
  const rate = tax.enabled ? money(tax.rate) : money(0);

  const priced = lines.map((line, i) => {
    const net = grosses[i].minus(discountShares[i]);
    let lineTax;
    let lineTotal;
    if (tax.mode === 'INCLUDED') {
      lineTotal = net;
      lineTax = rate.isZero() ? money(0) : round2(net.times(rate).dividedBy(rate.plus(100)));
    } else {
      lineTax = round2(net.times(rate).dividedBy(100));
      lineTotal = net.plus(lineTax);
    }
    return {
      ...line,
      unitPrice: toMoneyString(line.unitPrice),
      gross: toMoneyString(grosses[i]),
      discount: toMoneyString(discountShares[i]),
      tax: toMoneyString(lineTax),
      lineTotal: toMoneyString(lineTotal),
    };
  });

  return {
    lines: priced,
    subtotal: toMoneyString(subtotal),
    discount: toMoneyString(discountAmount),
    tax: toMoneyString(sum(priced.map((l) => l.tax))),
    total: toMoneyString(sum(priced.map((l) => l.lineTotal))),
    taxRate: rate.toFixed(3),
    taxMode: tax.mode,
  };
}

/**
 * Refund amount for `quantity` more units of a sale line, given how many
 * were refunded before. Cumulative refunds always sum exactly to the line
 * total when the whole line is refunded.
 */
function refundAmount({ lineTotal, soldQuantity, previouslyRefunded, quantity }) {
  const before = round2(money(lineTotal).times(previouslyRefunded).dividedBy(soldQuantity));
  const after = round2(money(lineTotal).times(previouslyRefunded + quantity).dividedBy(soldQuantity));
  return after.minus(before);
}

module.exports = { priceSale, refundAmount, prorateCents, resolveDiscountAmount };
