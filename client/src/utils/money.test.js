import { estimateTotals, toCents, fromCents } from './money.js';

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
