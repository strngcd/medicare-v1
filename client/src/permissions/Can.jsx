import { useAuth } from '../context/AuthContext.jsx';

/**
 * Renders children only if the user has the permission(s). This hides
 * unavailable actions; it is not a security boundary (the API enforces that).
 */
export function Can({ permission, any, children, fallback = null }) {
  const { can, canAny } = useAuth();
  const allowed = permission ? can(permission) : any ? canAny(...any) : true;
  return allowed ? children : fallback;
}
