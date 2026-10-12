const { PERMISSIONS: P } = require('./catalog');

// Fields that reveal acquisition cost (purchase prices, stock value).
const COST_FIELDS = new Set([
  'purchasePrice',
  'unitPurchasePrice',
  'purchasePriceAtSale',
  'unitCost',
  'inventoryValue',
  'totalCost',
  'costValue',
]);

// Fields that reveal cost of goods sold, profit or margins.
const PROFIT_FIELDS = new Set(['cogs', 'grossProfit', 'profit', 'grossMargin', 'marginPercent', 'refundedCogs', 'netCogs']);

/**
 * Returns a deep copy of `data` with protected financial fields removed
 * according to the user's permissions. Used on every response that may
 * contain cost or profit, so restricted users never receive the values.
 */
function filterFinancialFields(data, auth) {
  const hideCost = !auth.permissions.has(P.FINANCIAL_VIEW_PURCHASE_COST);
  const hideProfit = !auth.permissions.has(P.FINANCIAL_VIEW_PROFIT);
  if (!hideCost && !hideProfit) return data;

  const walk = (value) => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      const out = {};
      for (const [key, inner] of Object.entries(value)) {
        if (hideCost && COST_FIELDS.has(key)) continue;
        if (hideProfit && PROFIT_FIELDS.has(key)) continue;
        out[key] = walk(inner);
      }
      return out;
    }
    return value;
  };
  return walk(data);
}

function canViewCost(auth) {
  return auth.permissions.has(P.FINANCIAL_VIEW_PURCHASE_COST);
}

function canViewProfit(auth) {
  return auth.permissions.has(P.FINANCIAL_VIEW_PROFIT);
}

module.exports = { filterFinancialFields, canViewCost, canViewProfit, COST_FIELDS, PROFIT_FIELDS };
