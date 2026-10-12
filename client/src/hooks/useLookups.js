import { api } from '../api/client.js';
import { useApi } from './useApi.js';
import { useAuth } from '../context/AuthContext.jsx';

/** Active categories for selects (empty if the user cannot view categories). */
export function useCategories() {
  const { can } = useAuth();
  return useApi(
    () => (can('CATEGORY_VIEW') ? api.get('/medicine-categories', { status: 'ACTIVE', limit: 100, sortBy: 'name', sortOrder: 'asc' }).then((r) => r.data) : Promise.resolve([])),
    [],
  );
}

export function useSuppliers() {
  const { can } = useAuth();
  return useApi(
    () => (can('SUPPLIER_VIEW') ? api.get('/suppliers', { status: 'ACTIVE', limit: 100 }).then((r) => r.data) : Promise.resolve([])),
    [],
  );
}

export const toOptions = (rows, label = 'name', value = 'id') => (rows || []).map((r) => ({ value: r[value], label: r[label] }));
