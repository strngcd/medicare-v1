import { api } from '../api/client.js';
import { useApi } from './useApi.js';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Active categories for selects (empty if the user cannot view categories).
 * `productType` (MEDICINE | COSMETIC) limits them to one kind of product.
 */
export function useCategories(productType) {
  const { can } = useAuth();
  return useApi(
    () => (can('CATEGORY_VIEW') ? fetchAllCategories(productType) : Promise.resolve([])),
    [productType],
  );
}

/** Every active category (the API pages at 100; the default catalog has more). */
async function fetchAllCategories(productType) {
  const all = [];
  for (let page = 1; ; page += 1) {
    const res = await api.get('/medicine-categories', { status: 'ACTIVE', productType, page, limit: 100, sortBy: 'name', sortOrder: 'asc' });
    all.push(...res.data);
    if (!res.pagination || page >= res.pagination.totalPages) return all;
  }
}

export function useSuppliers() {
  const { can } = useAuth();
  return useApi(
    () => (can('SUPPLIER_VIEW') ? api.get('/suppliers', { status: 'ACTIVE', limit: 100 }).then((r) => r.data) : Promise.resolve([])),
    [],
  );
}

export const toOptions = (rows, label = 'name', value = 'id') => (rows || []).map((r) => ({ value: r[value], label: r[label] }));
