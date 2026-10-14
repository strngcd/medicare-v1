import {
  LayoutDashboard, ShoppingCart, Pill, Boxes, Truck, Building2, ArrowLeftRight, Receipt, Undo2,
  BellRing, BarChart3, Users, Store, ScrollText, KeyRound, Settings, FolderTree, Sparkles,
} from 'lucide-react';

/** Sidebar entries; each is shown only if the user holds one of `any`. */
export const NAVIGATION = [
  {
    section: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, any: ['DASHBOARD_VIEW'], end: true },
      { to: '/pos', label: 'Point of sale', icon: ShoppingCart, any: ['SALES_CREATE'] },
      { to: '/alerts', label: 'Alerts', icon: BellRing, any: ['ALERT_VIEW'], badge: 'alerts' },
    ],
  },
  {
    section: 'Catalog & stock',
    items: [
      { to: '/medicines', label: 'Medicines', icon: Pill, any: ['MEDICINE_VIEW'] },
      { to: '/cosmetics', label: 'Cosmetics', icon: Sparkles, any: ['MEDICINE_VIEW'] },
      { to: '/categories', label: 'Categories', icon: FolderTree, any: ['CATEGORY_VIEW'] },
      { to: '/inventory', label: 'Inventory', icon: Boxes, any: ['INVENTORY_VIEW'] },
      { to: '/transfers', label: 'Transfers', icon: ArrowLeftRight, any: ['INVENTORY_TRANSFER_VIEW'] },
    ],
  },
  {
    section: 'Purchasing',
    items: [
      { to: '/purchases', label: 'Purchases', icon: Truck, any: ['PURCHASE_VIEW'] },
      { to: '/suppliers', label: 'Suppliers', icon: Building2, any: ['SUPPLIER_VIEW'] },
    ],
  },
  {
    section: 'Sales',
    items: [
      { to: '/sales', label: 'Sales', icon: Receipt, any: ['SALES_VIEW', 'SALES_VIEW_HISTORY'] },
      { to: '/refunds', label: 'Refunds', icon: Undo2, any: ['SALES_VIEW_HISTORY', 'SALES_PROCESS_REFUND'] },
    ],
  },
  {
    section: 'Insights',
    items: [
      {
        to: '/reports',
        label: 'Reports',
        icon: BarChart3,
        any: ['REPORT_SALES_VIEW', 'REPORT_INVENTORY_VIEW', 'REPORT_PURCHASE_VIEW', 'REPORT_SUPPLIER_VIEW', 'REPORT_PROFIT_VIEW'],
      },
    ],
  },
  {
    section: 'Administration',
    items: [
      { to: '/staff', label: 'Staff', icon: Users, any: ['STAFF_VIEW'] },
      { to: '/branches', label: 'Branches', icon: Store, any: ['BRANCH_VIEW'] },
      { to: '/audit-logs', label: 'Audit log', icon: ScrollText, any: ['AUDIT_LOG_VIEW'] },
      { to: '/login-history', label: 'Login history', icon: KeyRound, any: ['LOGIN_HISTORY_VIEW'] },
      { to: '/settings', label: 'Settings', icon: Settings, any: ['SETTINGS_VIEW', 'BRANCH_EDIT'] },
    ],
  },
];
