import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, onUnauthorized } from '../api/client.js';
import { setCurrency } from '../utils/format.js';

const AuthContext = createContext(null);
const ALL_BRANCHES = 'ALL';

/**
 * Holds the signed-in session: user, effective permissions, accessible
 * branches, preferences and the currently selected branch.
 *
 * The UI uses permissions only to hide unavailable actions; the API checks
 * every request independently.
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | authenticated | anonymous
  const [selectedBranchId, setSelectedBranchId] = useState(null);

  const applySession = useCallback((data) => {
    setSession(data);
    setCurrency(data.pharmacy && data.pharmacy.currencyCode);
    setSelectedBranchId(data.selectedBranchId || (data.canAccessAllBranches ? ALL_BRANCHES : null));
    setStatus('authenticated');
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get('/auth/me');
      applySession(res.data);
      return res.data;
    } catch {
      setSession(null);
      setStatus('anonymous');
      return null;
    }
  }, [applySession]);

  useEffect(() => {
    refresh();
    onUnauthorized(() => {
      setSession(null);
      setStatus('anonymous');
    });
  }, [refresh]);

  const login = useCallback(async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    applySession(res.data);
    return res.data;
  }, [applySession]);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setSession(null);
      setStatus('anonymous');
    }
  }, []);

  const selectBranch = useCallback(async (branchId) => {
    setSelectedBranchId(branchId);
    // A UI preference only; the server re-checks access on every request.
    api.patch('/users/me/preferences', { lastSelectedBranchId: branchId === ALL_BRANCHES ? null : branchId }).catch(() => {});
  }, []);

  const value = useMemo(() => {
    const permissions = new Set(session ? session.permissions : []);
    const activeBranches = session ? session.branches.filter((b) => b.status === 'ACTIVE') : [];
    return {
      status,
      session,
      user: session && session.user,
      pharmacy: session && session.pharmacy,
      preferences: session && session.preferences,
      branches: session ? session.branches : [],
      activeBranches,
      canAccessAllBranches: Boolean(session && session.canAccessAllBranches),
      selectedBranchId,
      /** Branch id to send to the API (undefined means "all branches" for owners). */
      branchParam: selectedBranchId && selectedBranchId !== ALL_BRANCHES ? selectedBranchId : undefined,
      selectedBranch: activeBranches.find((b) => b.id === selectedBranchId) || null,
      isAllBranches: selectedBranchId === ALL_BRANCHES,
      can: (code) => permissions.has(code),
      canAny: (...codes) => codes.some((c) => permissions.has(c)),
      login,
      logout,
      refresh,
      selectBranch,
      setSession: applySession,
    };
  }, [session, status, selectedBranchId, login, logout, refresh, selectBranch, applySession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

export { ALL_BRANCHES };
