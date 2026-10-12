import { lazy } from 'react';

/** Route table: path, lazily loaded page and the permissions that open it. */
const page = (loader) => lazy(loader);

export const APP_ROUTES = [
  { path: '/', element: page(() => import('./pages/dashboard/DashboardPage.jsx')), any: ['DASHBOARD_VIEW'], home: true },
  { path: '/alerts', element: page(() => import('./pages/alerts/AlertsPage.jsx')), any: ['ALERT_VIEW'] },
  { path: '/notifications', element: page(() => import('./pages/notifications/NotificationsPage.jsx')), any: ['NOTIFICATION_VIEW'] },
  { path: '/profile', element: page(() => import('./pages/profile/ProfilePage.jsx')) },
  { path: '/help', element: page(() => import('./pages/help/HelpCenterPage.jsx')) },
  { path: '/help/:slug', element: page(() => import('./pages/help/HelpArticlePage.jsx')) },
];
