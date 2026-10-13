/**
 * Integer-cent arithmetic for UI previews (e.g. POS totals before checkout).
 * The server recalculates everything authoritatively; these values are only
 * shown as an estimate and never sent as prices or totals.
 */
export function toCents(value) {
  const [whole, fraction = ''] = String(value ?? '0').trim().split('.');
  const sign = whole.startsWith('-') ? -1 : 1;
  const cents = Math.abs(parseInt(whole || '0', 10)) * 100 + parseInt((fraction + '00').slice(0, 2), 10);
  return sign * cents;
}

export function fromCents(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Rounds a fractional cent amount half-up. */
function roundCents(value) {
  return Math.sign(value) * Math.round(Math.abs(value) + 1e-9);
}

/**
 * Mirrors the server's pricing rules for a live estimate:
 * sale discount prorated by line, tax per line (included or added on top).
 */
export function estimateTotals(lines, discount, tax) {
  const grosses = lines.map((l) => toCents(l.unitPrice) * l.quantity);
  const subtotal = grosses.reduce((a, b) => a + b, 0);
  let discountCents = 0;
  if (discount && Number(discount.value) > 0) {
    discountCents = discount.type === 'PERCENTAGE'
      ? roundCents((subtotal * Math.min(Number(discount.value), 100)) / 100)
      : Math.min(toCents(discount.value), subtotal);
  }
  const rate = tax && tax.enabled ? Number(tax.rate) : 0;
  let taxCents = 0;
  let totalCents = 0;
  grosses.forEach((gross) => {
    const share = subtotal ? roundCents((discountCents * gross) / subtotal) : 0;
    const net = gross - share;
    if (tax && tax.mode === 'INCLUDED') {
      taxCents += rate ? roundCents((net * rate) / (100 + rate)) : 0;
      totalCents += net;
    } else {
      const t = roundCents((net * rate) / 100);
      taxCents += t;
      totalCents += net + t;
    }
  });
  return {
    subtotal: fromCents(subtotal),
    discount: fromCents(discountCents),
    tax: fromCents(taxCents),
    total: fromCents(totalCents),
  };
}

/** Default selling price on receiving: unit cost plus the configured markup, rounded to the cent. */
export function suggestedSellingPrice(unitCost, markupPercent) {
  if (unitCost === undefined || unitCost === null || unitCost === '') return '';
  const markup = Number(markupPercent ?? 15);
  return fromCents(roundCents((toCents(unitCost) * (100 + (Number.isFinite(markup) ? markup : 15))) / 100));
}
