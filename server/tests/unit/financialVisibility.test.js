const { filterFinancialFields } = require('../../src/permissions/financialVisibility');

const auth = (...permissions) => ({ permissions: new Set(permissions) });

const data = {
  revenue: '100.00',
  cogs: '60.00',
  grossProfit: '40.00',
  items: [{ name: 'A', purchasePrice: '5.00', sellingPrice: '8.00', nested: { unitCost: '5.00', ok: true } }],
  inventoryValue: '500.00',
};

describe('filterFinancialFields', () => {
  test('removes cost and profit fields for users without financial permissions', () => {
    expect(filterFinancialFields(data, auth())).toEqual({
      revenue: '100.00',
      items: [{ name: 'A', sellingPrice: '8.00', nested: { ok: true } }],
    });
  });

  test('cost permission reveals cost but not profit', () => {
    const result = filterFinancialFields(data, auth('FINANCIAL_VIEW_PURCHASE_COST'));
    expect(result.inventoryValue).toBe('500.00');
    expect(result.items[0].purchasePrice).toBe('5.00');
    expect(result.cogs).toBeUndefined();
    expect(result.grossProfit).toBeUndefined();
  });

  test('returns data unchanged with both permissions', () => {
    expect(filterFinancialFields(data, auth('FINANCIAL_VIEW_PURCHASE_COST', 'FINANCIAL_VIEW_PROFIT'))).toBe(data);
  });
});
