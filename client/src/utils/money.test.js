import { estimateTotals, toCents, fromCents, percentOfCents, suggestedSellingPrice } from './money.js';

test('cent conversion is exact', () => {
  expect(toCents('12.5')).toBe(1250);
  expect(toCents('0.07')).toBe(7);
  expect(fromCents(4249)).toBe('42.49');
});

test('estimate matches the server rules for tax added on top', () => {
  const r = estimateTotals([{ unitPrice: '50.00', quantity: 2 }], { type: 'FIXED', value: '10' }, { enabled: true, rate: '15', mode: 'ADDED_ON_TOP' });
  expect(r).toEqual({ subtotal: '100.00', discount: '10.00', tax: '13.50', total: '103.50' });
});

test('estimate with tax included', () => {
  const r = estimateTotals([{ unitPrice: '115.00', quantity: 1 }], null, { enabled: true, rate: '15', mode: 'INCLUDED' });
  expect(r).toEqual({ subtotal: '115.00', discount: '0.00', tax: '15.00', total: '115.00' });
});

test('suggested selling price adds the markup to the unit cost', () => {
  expect(suggestedSellingPrice('100.00', '15.00')).toBe('115.00');
  expect(suggestedSellingPrice('2.50', '15')).toBe('2.88');
  expect(suggestedSellingPrice('10', undefined)).toBe('11.50');
  expect(suggestedSellingPrice('', '15')).toBe('');
});

test('percent of an amount rounds half-up to the cent', () => {
  expect(percentOfCents(10000, '15')).toBe(1500);
  expect(percentOfCents(333, '2.5')).toBe(8);
  expect(percentOfCents(1000, '')).toBe(0);
  expect(percentOfCents(1000, 'abc')).toBe(0);
});
