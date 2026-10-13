/**
 * The single source of truth for permission codes and role defaults.
 * The seed script writes these into the database; services reference the
 * exported constants instead of raw strings.
 */

const PERMISSION_DEFINITIONS = [
  // Dashboard
  ['DASHBOARD_VIEW', 'DASHBOARD', 'View the operational dashboard'],
  ['DASHBOARD_VIEW_FINANCIALS', 'DASHBOARD', 'View revenue, discount, tax and inventory value KPIs'],
  ['DASHBOARD_VIEW_PROFIT', 'DASHBOARD', 'View COGS and gross profit KPIs'],
  // Medicines
  ['MEDICINE_VIEW', 'MEDICINES', 'View medicines'],
  ['MEDICINE_CREATE', 'MEDICINES', 'Create medicines'],
  ['MEDICINE_EDIT', 'MEDICINES', 'Edit medicines and barcodes'],
  ['MEDICINE_ARCHIVE', 'MEDICINES', 'Archive medicines'],
  ['MEDICINE_RESTORE', 'MEDICINES', 'Restore archived medicines'],
  // Categories
  ['CATEGORY_VIEW', 'CATEGORIES', 'View medicine categories'],
  ['CATEGORY_CREATE', 'CATEGORIES', 'Create medicine categories'],
  ['CATEGORY_EDIT', 'CATEGORIES', 'Edit medicine categories'],
  ['CATEGORY_ARCHIVE', 'CATEGORIES', 'Archive medicine categories'],
  ['CATEGORY_RESTORE', 'CATEGORIES', 'Restore archived categories'],
  // Inventory
  ['INVENTORY_VIEW', 'INVENTORY', 'View stock levels'],
  ['INVENTORY_VIEW_BATCHES', 'INVENTORY', 'View batch details'],
  ['INVENTORY_ADD_STOCK', 'INVENTORY', 'Add stock outside of purchasing'],
  ['INVENTORY_ADJUST', 'INVENTORY', 'Adjust inventory quantities, minimum stock and selling prices'],
  ['INVENTORY_VIEW_MOVEMENTS', 'INVENTORY', 'View the stock movement ledger'],
  ['INVENTORY_DISPOSE', 'INVENTORY', 'Dispose of expired and expiring stock (recorded as a loss)'],
  ['INVENTORY_BATCH_ARCHIVE', 'INVENTORY', 'Archive empty batches'],
  ['INVENTORY_BATCH_RESTORE', 'INVENTORY', 'Restore archived batches'],
  ['SALES_OVERRIDE_FEFO', 'INVENTORY', 'Override FEFO batch allocation during a sale'],
  // Sales
  ['SALES_VIEW', 'SALES', 'View own sales'],
  ['SALES_CREATE', 'SALES', 'Create POS sales'],
  ['SALES_APPLY_DISCOUNT', 'SALES', 'Apply discounts to sales'],
  ['SALES_VIEW_HISTORY', 'SALES', 'View branch sales history'],
  ['SALES_PRINT_RECEIPT', 'SALES', 'Print receipts'],
  ['SALES_PROCESS_REFUND', 'SALES', 'Process refunds'],
  ['SALES_VOID', 'SALES', 'Void completed sales'],
  ['SALES_VOID_OWN', 'SALES', 'Void own completed sales'],
  // Purchasing
  ['PURCHASE_VIEW', 'PURCHASING', 'View purchases'],
  ['PURCHASE_CREATE', 'PURCHASING', 'Create purchases'],
  ['PURCHASE_EDIT', 'PURCHASING', 'Edit purchases before receiving'],
  ['PURCHASE_RECEIVE', 'PURCHASING', 'Receive purchased stock'],
  ['PURCHASE_CANCEL', 'PURCHASING', 'Cancel purchases'],
  // Suppliers
  ['SUPPLIER_VIEW', 'SUPPLIERS', 'View suppliers'],
  ['SUPPLIER_CREATE', 'SUPPLIERS', 'Create suppliers'],
  ['SUPPLIER_EDIT', 'SUPPLIERS', 'Edit suppliers'],
  ['SUPPLIER_ARCHIVE', 'SUPPLIERS', 'Archive suppliers'],
  ['SUPPLIER_RESTORE', 'SUPPLIERS', 'Restore archived suppliers'],
  // Supplier payments
  ['SUPPLIER_PAYMENT_VIEW', 'SUPPLIER_PAYMENTS', 'View supplier payments and balances'],
  ['SUPPLIER_PAYMENT_CREATE', 'SUPPLIER_PAYMENTS', 'Record supplier payments'],
  // Transfers
  ['INVENTORY_TRANSFER_VIEW', 'TRANSFERS', 'View branch transfers'],
  ['INVENTORY_TRANSFER_CREATE', 'TRANSFERS', 'Create and request branch transfers'],
  ['INVENTORY_TRANSFER_APPROVE', 'TRANSFERS', 'Approve branch transfers'],
  ['INVENTORY_TRANSFER_SHIP', 'TRANSFERS', 'Ship branch transfers'],
  ['INVENTORY_TRANSFER_RECEIVE', 'TRANSFERS', 'Receive branch transfers'],
  // Staff
  ['STAFF_VIEW', 'STAFF', 'View staff'],
  ['STAFF_CREATE', 'STAFF', 'Create staff accounts'],
  ['STAFF_EDIT', 'STAFF', 'Edit staff profiles'],
  ['STAFF_DEACTIVATE', 'STAFF', 'Deactivate staff accounts'],
  ['STAFF_REACTIVATE', 'STAFF', 'Reactivate staff accounts'],
  ['STAFF_MANAGE_PERMISSIONS', 'STAFF', 'Grant or deny individual permissions'],
  ['STAFF_MANAGE_BRANCHES', 'STAFF', 'Assign staff to branches'],
  ['STAFF_CHANGE_ROLE', 'STAFF', 'Change staff roles'],
  // Branches
  ['BRANCH_VIEW', 'BRANCHES', 'View branches'],
  ['BRANCH_CREATE', 'BRANCHES', 'Create branches'],
  ['BRANCH_EDIT', 'BRANCHES', 'Edit branches and branch settings'],
  ['BRANCH_DEACTIVATE', 'BRANCHES', 'Deactivate branches'],
  ['BRANCH_REACTIVATE', 'BRANCHES', 'Reactivate branches'],
  // Reports
  ['REPORT_SALES_VIEW', 'REPORTS', 'View sales reports'],
  ['REPORT_INVENTORY_VIEW', 'REPORTS', 'View inventory and movement reports'],
  ['REPORT_PURCHASE_VIEW', 'REPORTS', 'View purchase reports'],
  ['REPORT_SUPPLIER_VIEW', 'REPORTS', 'View supplier reports'],
  ['REPORT_PROFIT_VIEW', 'REPORTS', 'View profit reports'],
  ['REPORT_EXPORT', 'REPORTS', 'Export reports'],
  // Notifications
  ['NOTIFICATION_VIEW', 'NOTIFICATIONS', 'View own notifications'],
  ['NOTIFICATION_MANAGE', 'NOTIFICATIONS', 'Manage notification and alert settings'],
  ['ALERT_VIEW', 'NOTIFICATIONS', 'View operational inventory alerts'],
  // Audit / security
  ['AUDIT_LOG_VIEW', 'AUDIT', 'View audit logs'],
  ['LOGIN_HISTORY_VIEW', 'AUDIT', 'View login history'],
  // Settings
  ['SETTINGS_VIEW', 'SETTINGS', 'View pharmacy settings'],
  ['SETTINGS_EDIT', 'SETTINGS', 'Edit pharmacy settings'],
  // Financial visibility
  ['FINANCIAL_VIEW_PURCHASE_COST', 'FINANCIAL', 'See purchase prices, cost and inventory value'],
  ['FINANCIAL_VIEW_PROFIT', 'FINANCIAL', 'See COGS, gross profit and margins'],
];

const PERMISSIONS = Object.freeze(
  Object.fromEntries(PERMISSION_DEFINITIONS.map(([code]) => [code, code])),
);

const ALL_PERMISSION_CODES = Object.freeze(PERMISSION_DEFINITIONS.map(([code]) => code));

const ROLES = Object.freeze({
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  PHARMACIST: 'PHARMACIST',
  CASHIER: 'CASHIER',
});

const ROLE_DEFINITIONS = [
  { code: ROLES.OWNER, name: 'Owner', rank: 1, description: 'Unrestricted access across the organization.' },
  { code: ROLES.ADMIN, name: 'Admin', rank: 2, description: 'Administers staff, catalog and operations. Permissions are customizable.' },
  { code: ROLES.PHARMACIST, name: 'Pharmacist', rank: 3, description: 'Manages medicines, stock and purchasing; sells and refunds.' },
  { code: ROLES.CASHIER, name: 'Cashier', rank: 4, description: 'Sells medicines, prints receipts and processes refunds.' },
];

const P = PERMISSIONS;

// Branch lifecycle is reserved for the Owner by default; it can be granted to an Admin explicitly.
const OWNER_ONLY_BY_DEFAULT = new Set([P.BRANCH_CREATE, P.BRANCH_DEACTIVATE, P.BRANCH_REACTIVATE]);

const ROLE_DEFAULT_PERMISSIONS = Object.freeze({
  [ROLES.OWNER]: ALL_PERMISSION_CODES,
  [ROLES.ADMIN]: ALL_PERMISSION_CODES.filter((code) => !OWNER_ONLY_BY_DEFAULT.has(code)),
  [ROLES.PHARMACIST]: [
    P.DASHBOARD_VIEW,
    P.MEDICINE_VIEW, P.MEDICINE_CREATE, P.MEDICINE_EDIT, P.MEDICINE_ARCHIVE, P.MEDICINE_RESTORE,
    P.CATEGORY_VIEW,
    P.INVENTORY_VIEW, P.INVENTORY_VIEW_BATCHES, P.INVENTORY_ADD_STOCK, P.INVENTORY_VIEW_MOVEMENTS,
    P.INVENTORY_DISPOSE, P.INVENTORY_BATCH_ARCHIVE, P.INVENTORY_BATCH_RESTORE,
    P.SALES_VIEW, P.SALES_CREATE, P.SALES_VIEW_HISTORY, P.SALES_PRINT_RECEIPT, P.SALES_PROCESS_REFUND, P.SALES_VOID_OWN,
    P.SUPPLIER_VIEW,
    P.PURCHASE_VIEW, P.PURCHASE_CREATE, P.PURCHASE_EDIT, P.PURCHASE_RECEIVE,
    P.NOTIFICATION_VIEW, P.ALERT_VIEW,
    // Purchasing requires entering and checking purchase prices.
    P.FINANCIAL_VIEW_PURCHASE_COST,
  ],
  [ROLES.CASHIER]: [
    P.DASHBOARD_VIEW,
    P.MEDICINE_VIEW,
    P.CATEGORY_VIEW,
    P.INVENTORY_VIEW,
    P.SALES_VIEW, P.SALES_CREATE, P.SALES_VIEW_HISTORY, P.SALES_PRINT_RECEIPT, P.SALES_PROCESS_REFUND, P.SALES_VOID_OWN,
    P.NOTIFICATION_VIEW, P.ALERT_VIEW,
  ],
});

module.exports = {
  PERMISSIONS,
  PERMISSION_DEFINITIONS,
  ALL_PERMISSION_CODES,
  ROLES,
  ROLE_DEFINITIONS,
  ROLE_DEFAULT_PERMISSIONS,
};
