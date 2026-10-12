const { computeEffectivePermissions, describePermissions } = require('../../src/permissions/effectivePermissions');
const { ALL_PERMISSION_CODES, ROLE_DEFAULT_PERMISSIONS } = require('../../src/permissions/catalog');

describe('computeEffectivePermissions', () => {
  test('owner always has every permission, even with deny overrides', () => {
    const result = computeEffectivePermissions('OWNER', [], [{ code: 'SALES_CREATE', granted: false }]);
    expect(result.size).toBe(ALL_PERMISSION_CODES.length);
    expect(result.has('SALES_CREATE')).toBe(true);
  });

  test('role defaults apply when there are no overrides', () => {
    const result = computeEffectivePermissions('CASHIER', ROLE_DEFAULT_PERMISSIONS.CASHIER);
    expect(result.has('SALES_CREATE')).toBe(true);
    expect(result.has('PURCHASE_VIEW')).toBe(false);
    expect(result.has('FINANCIAL_VIEW_PURCHASE_COST')).toBe(false);
  });

  test('explicit grant adds and explicit deny removes', () => {
    const result = computeEffectivePermissions('CASHIER', ROLE_DEFAULT_PERMISSIONS.CASHIER, [
      { code: 'SALES_APPLY_DISCOUNT', granted: true },
      { code: 'SALES_PROCESS_REFUND', granted: false },
    ]);
    expect(result.has('SALES_APPLY_DISCOUNT')).toBe(true);
    expect(result.has('SALES_PROCESS_REFUND')).toBe(false);
  });
});

describe('describePermissions', () => {
  test('distinguishes inherited, explicit grant and explicit deny', () => {
    const rows = describePermissions('CASHIER', ROLE_DEFAULT_PERMISSIONS.CASHIER, [
      { code: 'SALES_VOID', granted: true },
      { code: 'SALES_CREATE', granted: false },
    ]);
    const byCode = Object.fromEntries(rows.map((r) => [r.code, r]));
    expect(byCode.SALES_VIEW).toMatchObject({ inherited: true, override: null, effective: true });
    expect(byCode.SALES_VOID).toMatchObject({ inherited: false, override: 'GRANT', effective: true });
    expect(byCode.SALES_CREATE).toMatchObject({ inherited: true, override: 'DENY', effective: false });
    expect(byCode.PURCHASE_VIEW).toMatchObject({ inherited: false, override: null, effective: false });
  });
});

describe('role defaults', () => {
  test('cashier has no purchase, transfer or financial permissions by default', () => {
    const cashier = ROLE_DEFAULT_PERMISSIONS.CASHIER;
    expect(cashier.filter((c) => /^PURCHASE_|TRANSFER|FINANCIAL_|PROFIT/.test(c))).toEqual([]);
  });

  test('every default refers to a catalog permission', () => {
    for (const codes of Object.values(ROLE_DEFAULT_PERMISSIONS)) {
      for (const code of codes) expect(ALL_PERMISSION_CODES).toContain(code);
    }
  });

  test('no duplicate FEFO override permission exists', () => {
    expect(ALL_PERMISSION_CODES).toContain('SALES_OVERRIDE_FEFO');
    expect(ALL_PERMISSION_CODES).not.toContain('INVENTORY_OVERRIDE_FEFO');
  });
});
