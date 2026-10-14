import { lazy } from 'react';

/**
 * Route table: path, lazily loaded page and the permissions that open it.
 * Each page keeps its loader so the shell can fetch page code ahead of time.
 */
const page = (loader) => Object.assign(lazy(loader), { preload: loader });

export const APP_ROUTES = [
  { path: '/', element: page(() => import('./pages/dashboard/DashboardPage.jsx')), any: ['DASHBOARD_VIEW'], home: true },
  { path: '/alerts', element: page(() => import('./pages/alerts/AlertsPage.jsx')), any: ['ALERT_VIEW'] },
  { path: '/notifications', element: page(() => import('./pages/notifications/NotificationsPage.jsx')), any: ['NOTIFICATION_VIEW'] },
  { path: '/medicines', element: page(() => import('./pages/medicines/MedicinesPage.jsx')), any: ['MEDICINE_VIEW'] },
  { path: '/medicines/new', element: page(() => import('./pages/medicines/MedicineCreatePage.jsx')), any: ['MEDICINE_CREATE'] },
  { path: '/medicines/:id', element: page(() => import('./pages/medicines/MedicineDetailPage.jsx')), any: ['MEDICINE_VIEW'] },
  { path: '/cosmetics', element: page(() => import('./pages/cosmetics/CosmeticsPage.jsx')), any: ['MEDICINE_VIEW'] },
  { path: '/cosmetics/new', element: page(() => import('./pages/cosmetics/CosmeticCreatePage.jsx')), any: ['MEDICINE_CREATE'] },
  { path: '/cosmetics/:id', element: page(() => import('./pages/medicines/MedicineDetailPage.jsx')), any: ['MEDICINE_VIEW'] },
  { path: '/categories', element: page(() => import('./pages/categories/CategoriesPage.jsx')), any: ['CATEGORY_VIEW'] },
  { path: '/inventory', element: page(() => import('./pages/inventory/InventoryPage.jsx')), any: ['INVENTORY_VIEW'] },
  { path: '/suppliers', element: page(() => import('./pages/suppliers/SuppliersPage.jsx')), any: ['SUPPLIER_VIEW'] },
  { path: '/suppliers/:id', element: page(() => import('./pages/suppliers/SupplierDetailPage.jsx')), any: ['SUPPLIER_VIEW'] },
  { path: '/purchases', element: page(() => import('./pages/purchases/PurchasesPage.jsx')), any: ['PURCHASE_VIEW'] },
  { path: '/purchases/new', element: page(() => import('./pages/purchases/PurchaseFormPage.jsx')), any: ['PURCHASE_CREATE'] },
  { path: '/purchases/:id', element: page(() => import('./pages/purchases/PurchaseDetailPage.jsx')), any: ['PURCHASE_VIEW'] },
  { path: '/purchases/:id/edit', element: page(() => import('./pages/purchases/PurchaseFormPage.jsx')), any: ['PURCHASE_EDIT'] },
  { path: '/pos', element: page(() => import('./pages/pos/PosPage.jsx')), any: ['SALES_CREATE'] },
  { path: '/sales', element: page(() => import('./pages/sales/SalesPage.jsx')), any: ['SALES_VIEW', 'SALES_VIEW_HISTORY'] },
  { path: '/sales/:id', element: page(() => import('./pages/sales/SaleDetailPage.jsx')), any: ['SALES_VIEW', 'SALES_VIEW_HISTORY'] },
  { path: '/refunds', element: page(() => import('./pages/refunds/RefundsPage.jsx')), any: ['SALES_VIEW_HISTORY', 'SALES_PROCESS_REFUND'] },
  { path: '/transfers', element: page(() => import('./pages/transfers/TransfersPage.jsx')), any: ['INVENTORY_TRANSFER_VIEW'] },
  { path: '/transfers/new', element: page(() => import('./pages/transfers/TransferCreatePage.jsx')), any: ['INVENTORY_TRANSFER_CREATE'] },
  { path: '/transfers/:id', element: page(() => import('./pages/transfers/TransferDetailPage.jsx')), any: ['INVENTORY_TRANSFER_VIEW'] },
  { path: '/staff', element: page(() => import('./pages/staff/StaffPage.jsx')), any: ['STAFF_VIEW'] },
  { path: '/staff/:id', element: page(() => import('./pages/staff/StaffDetailPage.jsx')), any: ['STAFF_VIEW'] },
  { path: '/branches', element: page(() => import('./pages/branches/BranchesPage.jsx')), any: ['BRANCH_VIEW'] },
  { path: '/branches/:id', element: page(() => import('./pages/branches/BranchDetailPage.jsx')), any: ['BRANCH_VIEW'] },
  { path: '/settings', element: page(() => import('./pages/settings/SettingsPage.jsx')), any: ['SETTINGS_VIEW', 'BRANCH_EDIT'] },
  { path: '/reports', element: page(() => import('./pages/reports/ReportsPage.jsx')), any: ['REPORT_SALES_VIEW', 'REPORT_INVENTORY_VIEW', 'REPORT_PURCHASE_VIEW', 'REPORT_SUPPLIER_VIEW', 'REPORT_PROFIT_VIEW'] },
  { path: '/audit-logs', element: page(() => import('./pages/audit/AuditLogPage.jsx')), any: ['AUDIT_LOG_VIEW'] },
  { path: '/login-history', element: page(() => import('./pages/audit/LoginHistoryPage.jsx')), any: ['LOGIN_HISTORY_VIEW'] },
  { path: '/profile', element: page(() => import('./pages/profile/ProfilePage.jsx')) },
  { path: '/help', element: page(() => import('./pages/help/HelpCenterPage.jsx')) },
  { path: '/help/:slug', element: page(() => import('./pages/help/HelpArticlePage.jsx')) },
];

/**
 * Downloads the code of every page the user may open, one at a time and
 * only when the browser is idle, so switching pages does not wait on the network.
 */
export function preloadRoutes(canAny) {
  const loaders = [...new Set(APP_ROUTES.filter((r) => !r.any || canAny(...r.any)).map((r) => r.element.preload))];
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
  let cancelled = false;
  const next = () => {
    if (cancelled || loaders.length === 0) return;
    loaders.shift()().catch(() => {}).finally(() => idle(next));
  };
  idle(next);
  return () => {
    cancelled = true;
  };
}
