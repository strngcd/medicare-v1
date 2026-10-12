import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Unauthorized } from '../components/ui/index.js';
import { NAVIGATION } from '../constants/navigation.js';

function FullPageLoader() {
  return (
    <div className="state" style={{ minHeight: '60vh', justifyContent: 'center' }} aria-busy="true">
      <span className="spinner" style={{ width: 24, height: 24 }} />
    </div>
  );
}

export function RequireAuth({ children }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageLoader />;
  if (status !== 'authenticated') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children;
}

export function GuestOnly({ children }) {
  const { status } = useAuth();
  if (status === 'loading') return <FullPageLoader />;
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return children;
}

/** Shows the unauthorized state when the user lacks all of `any`. */
export function RequirePermission({ any, children }) {
  const { canAny } = useAuth();
  return canAny(...any) ? children : <Unauthorized />;
}

/** First page the user may open, for users without dashboard access. */
export function useHomePath() {
  const { canAny } = useAuth();
  for (const section of NAVIGATION) {
    for (const item of section.items) {
      if (canAny(...item.any)) return item.to;
    }
  }
  return '/help';
}
