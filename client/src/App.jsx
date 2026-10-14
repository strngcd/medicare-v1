import { Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout.jsx';
import { RequireAuth, GuestOnly, RequirePermission, useHomePath } from './permissions/guards.jsx';
import { useAuth } from './context/AuthContext.jsx';
import { PageLoader } from './components/ui/index.js';
import LoginPage from './pages/auth/LoginPage.jsx';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage.jsx';
import ResetPasswordPage from './pages/auth/ResetPasswordPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import { APP_ROUTES } from './routes.jsx';

function Home({ route }) {
  const { can } = useAuth();
  const fallback = useHomePath();
  if (!can('DASHBOARD_VIEW')) return <Navigate to={fallback === '/' ? '/help' : fallback} replace />;
  return <route.element />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
      <Route path="/forgot-password" element={<GuestOnly><ForgotPasswordPage /></GuestOnly>} />
      <Route path="/reset-password" element={<ResetPasswordPage mode="reset" />} />
      <Route path="/setup-password" element={<ResetPasswordPage mode="setup" />} />
      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        {APP_ROUTES.map((route) => (
          <Route
            key={route.path}
            path={route.path}
            element={(
              // Keyed per route: a new boundary shows its loader at once instead of
              // React holding the previous page while this page's code downloads.
              <Suspense key={route.path} fallback={<PageLoader />}>
                {route.home ? (
                  <Home route={route} />
                ) : route.any ? (
                  <RequirePermission any={route.any}><route.element /></RequirePermission>
                ) : (
                  <route.element />
                )}
              </Suspense>
            )}
          />
        ))}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
