import { lazy } from 'react';

/** Route table: path, lazily loaded page and the permissions that open it. */
const page = (loader) => lazy(loader);

export const APP_ROUTES = [
  { path: '/', element: page(() => import('./pages/dashboard/DashboardPage.jsx')), any: ['DASHBOARD_VIEW'], home: true },
  { path: '/alerts', element: page(() => import('./pages/alerts/AlertsPage.jsx')), any: ['ALERT_VIEW'] },
  { path: '/notifications', element: page(() => import('./pages/notifications/NotificationsPage.jsx')), any: ['NOTIFICATION_VIEW'] },
  { path: '/medicines', element: page(() => import('./pages/medicines/MedicinesPage.jsx')), any: ['MEDICINE_VIEW'] },
  { path: '/medicines/new', element: page(() => import('./pages/medicines/MedicineCreatePage.jsx')), any: ['MEDICINE_CREATE'] },
  { path: '/medicines/:id', element: page(() => import('./pages/medicines/MedicineDetailPage.jsx')), any: ['MEDICINE_VIEW'] },
  { path: '/categories', element: page(() => import('./pages/categories/CategoriesPage.jsx')), any: ['CATEGORY_VIEW'] },
  { path: '/inventory', element: page(() => import('./pages/inventory/InventoryPage.jsx')), any: ['INVENTORY_VIEW'] },
  { path: '/suppliers', element: page(() => import('./pages/suppliers/SuppliersPage.jsx')), any: ['SUPPLIER_VIEW'] },
  { path: '/suppliers/:id', element: page(() => import('./pages/suppliers/SupplierDetailPage.jsx')), any: ['SUPPLIER_VIEW'] },
  { path: '/purchases', element: page(() => import('./pages/purchases/PurchasesPage.jsx')), any: ['PURCHASE_VIEW'] },
  { path: '/purchases/new', element: page(() => import('./pages/purchases/PurchaseFormPage.jsx')), any: ['PURCHASE_CREATE'] },
  { path: '/purchases/:id', element: page(() => import('./pages/purchases/PurchaseDetailPage.jsx')), any: ['PURCHASE_VIEW'] },
  { path: '/purchases/:id/edit', element: page(() => import('./pages/purchases/PurchaseFormPage.jsx')), any: ['PURCHASE_EDIT'] },
  { path: '/profile', element: page(() => import('./pages/profile/ProfilePage.jsx')) },
  { path: '/help', element: page(() => import('./pages/help/HelpCenterPage.jsx')) },
  { path: '/help/:slug', element: page(() => import('./pages/help/HelpArticlePage.jsx')) },
];
