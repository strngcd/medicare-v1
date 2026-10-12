const { priceSale, refundAmount, prorateCents } = require('../../src/modules/sales/salePricing');

const noTax = { enabled: false, rate: '0', mode: 'ADDED_ON_TOP' };

describe('priceSale', () => {
  test('no discount, no tax', () => {
    const r = priceSale([{ quantity: 3, unitPrice: '12.50' }, { quantity: 1, unitPrice: '4.99' }], null, noTax);
    expect(r).toMatchObject({ subtotal: '42.49', discount: '0.00', tax: '0.00', total: '42.49' });
  });

  test('percentage discount is prorated and sums exactly', () => {
    const r = priceSale(
      [{ quantity: 1, unitPrice: '10.00' }, { quantity: 1, unitPrice: '10.00' }, { quantity: 1, unitPrice: '10.00' }],
      { type: 'PERCENTAGE', value: '10' },
      noTax,
    );
    expect(r.discount).toBe('3.00');
    expect(r.lines.map((l) => l.discount)).toEqual(['1.00', '1.00', '1.00']);
    expect(r.total).toBe('27.00');
  });

  test('fixed discount with awkward cents is distributed without losing a cent', () => {
    const r = priceSale(
      [{ quantity: 1, unitPrice: '10.00' }, { quantity: 1, unitPrice: '10.00' }, { quantity: 1, unitPrice: '10.00' }],
      { type: 'FIXED', value: '1.00' },
      noTax,
    );
    expect(r.lines.map((l) => l.discount).sort()).toEqual(['0.33', '0.33', '0.34']);
    expect(r.total).toBe('29.00');
  });

  test('fixed discount larger than subtotal is rejected', () => {
    expect(() => priceSale([{ quantity: 1, unitPrice: '5.00' }], { type: 'FIXED', value: '5.01' }, noTax))
      .toThrow(expect.objectContaining({ code: 'DISCOUNT_EXCEEDS_SUBTOTAL' }));
  });

  test('100% discount is allowed', () => {
    expect(priceSale([{ quantity: 2, unitPrice: '5.00' }], { type: 'PERCENTAGE', value: '100' }, noTax).total).toBe('0.00');
  });

  test('tax added on top', () => {
    const r = priceSale([{ quantity: 2, unitPrice: '50.00' }], { type: 'FIXED', value: '10' }, { enabled: true, rate: '15', mode: 'ADDED_ON_TOP' });
    // (100 - 10) x 15% = 13.50
    expect(r).toMatchObject({ subtotal: '100.00', discount: '10.00', tax: '13.50', total: '103.50' });
  });

  test('tax included in price', () => {
    const r = priceSale([{ quantity: 1, unitPrice: '115.00' }], null, { enabled: true, rate: '15', mode: 'INCLUDED' });
    expect(r).toMatchObject({ subtotal: '115.00', tax: '15.00', total: '115.00' });
  });

  test('disabled tax ignores the configured rate', () => {
    expect(priceSale([{ quantity: 1, unitPrice: '10' }], null, { enabled: false, rate: '15', mode: 'ADDED_ON_TOP' }).tax).toBe('0.00');
  });
});

describe('prorateCents', () => {
  test('never assigns more than a line weight', () => {
    expect(prorateCents(101, [1, 100])).toEqual([1, 100]);
  });
});

describe('refundAmount', () => {
  test('partial refunds accumulate exactly to the line total', () => {
    const line = { lineTotal: '10.00', soldQuantity: 3 };
    const a = refundAmount({ ...line, previouslyRefunded: 0, quantity: 1 });
    const b = refundAmount({ ...line, previouslyRefunded: 1, quantity: 1 });
    const c = refundAmount({ ...line, previouslyRefunded: 2, quantity: 1 });
    expect([a, b, c].map((x) => x.toFixed(2))).toEqual(['3.33', '3.34', '3.33']);
    expect(a.plus(b).plus(c).toFixed(2)).toBe('10.00');
  });
});
