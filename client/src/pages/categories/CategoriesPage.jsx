import { useState } from 'react';
import { Plus, FolderTree, Pencil, Archive, ArchiveRestore } from 'lucide-react';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useAction } from '../../hooks/useAction.js';
import { useListState } from '../../hooks/useListState.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Can } from '../../permissions/Can.jsx';
import { PageHeader, Panel, DataTable, Pagination, Button, StatusBadge, EmptyState, Modal, TextInput, TextArea, SelectInput, IconButton, FilterToolbar } from '../../components/ui/index.js';
import { formatNumber, PRODUCT_TYPE_OPTIONS } from '../../utils/format.js';

const TYPE_LABEL = { MEDICINE: 'Medicine', COSMETIC: 'Cosmetic' };

function CategoryModal({ category, onClose, onSaved }) {
  const [form, setForm] = useState({ name: category ? category.name : '', description: category ? category.description || '' : '', productType: 'MEDICINE' });
  const action = useAction();
  const save = async () => {
    const { productType, ...fields } = form;
    // The type is chosen once, on create.
    const call = category ? () => api.patch(`/medicine-categories/${category.id}`, fields) : () => api.post('/medicine-categories', form);
    const result = await action.run(call, { success: category ? 'Category updated.' : 'Category created.' });
    if (result) onSaved();
  };
  return (
    <Modal open title={category ? 'Edit category' : 'New category'} onClose={onClose} closeDisabled={action.running}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={action.running}>Save</Button></>}>
      <TextInput label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={action.fieldErrors.name || (action.error && action.error.code === 'DUPLICATE_CATEGORY' ? action.error.message : undefined)} />
      {category
        ? <p className="small muted">For {TYPE_LABEL[category.productType].toLowerCase()}s. The type cannot be changed.</p>
        : <SelectInput label="For" required value={form.productType} options={PRODUCT_TYPE_OPTIONS} onChange={(e) => setForm({ ...form, productType: e.target.value })} hint="Cannot be changed later." />}
      <TextArea label="Description" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
    </Modal>
  );
}

export default function CategoriesPage() {
  const { can } = useAuth();
  const { state, update, clear, hasFilters } = useListState();
  const list = useApi(() => api.get('/medicine-categories', state), [JSON.stringify(state)]);
  const [modal, setModal] = useState(null);
  const action = useAction();

  const toggle = async (c) => {
    const archive = c.status === 'ACTIVE';
    const result = await action.run(() => api.post(`/medicine-categories/${c.id}/${archive ? 'archive' : 'restore'}`), { success: archive ? 'Category archived.' : 'Category restored.' });
    if (result) list.reload({ silent: true });
  };

  const columns = [
    { key: 'name', label: 'Name', sortable: true, render: (c) => <span className="cell-strong">{c.name}</span> },
    { key: 'productType', label: 'For', render: (c) => TYPE_LABEL[c.productType] },
    { key: 'description', label: 'Description', render: (c) => <span className="small muted">{c.description || '—'}</span> },
    { key: 'medicineCount', label: 'Products', align: 'right', sortable: true, render: (c) => formatNumber(c.medicineCount) },
    { key: 'status', label: 'Status', render: (c) => <StatusBadge status={c.status} /> },
    {
      key: 'actions',
      label: '',
      render: (c) => (
        <span className="row">
          {can('CATEGORY_EDIT') && <IconButton icon={Pencil} label="Edit" onClick={() => setModal({ category: c })} />}
          {c.status === 'ACTIVE' && can('CATEGORY_ARCHIVE') && <IconButton icon={Archive} label="Archive" onClick={() => toggle(c)} disabled={action.running} />}
          {c.status === 'ARCHIVED' && can('CATEGORY_RESTORE') && <IconButton icon={ArchiveRestore} label="Restore" onClick={() => toggle(c)} disabled={action.running} />}
        </span>
      ),
    },
  ];

  return (
    <div className="stack">
      <PageHeader title="Categories" description="Categories for medicines and cosmetics. Archived categories stay on existing products but cannot be assigned to new ones."
        actions={<Can permission="CATEGORY_CREATE"><Button icon={Plus} onClick={() => setModal({})}>New category</Button></Can>} />
      <Panel flush>
        <FilterToolbar>
          <div className="field search-field">
            <span className="field-label">Search</span>
            <input className="input" type="search" placeholder="Category name" defaultValue={state.search || ''} onChange={(e) => update({ search: e.target.value })} aria-label="Search categories" />
          </div>
          <SelectInput label="For" value={state.productType || ''} placeholder="All" options={PRODUCT_TYPE_OPTIONS} onChange={(e) => update({ productType: e.target.value })} />
          <SelectInput label="Status" value={state.status || ''} placeholder="All" options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'ARCHIVED', label: 'Archived' }]} onChange={(e) => update({ status: e.target.value })} />
        </FilterToolbar>
        <DataTable columns={columns} rows={list.data && list.data.data} loading={list.loading} error={list.error} onRetry={list.reload}
          sort={state} onSort={update} filtered={hasFilters} isSearch={Boolean(state.search)} onClearFilters={clear}
          empty={<EmptyState icon={FolderTree} title="No categories" action={<Can permission="CATEGORY_CREATE"><Button icon={Plus} onClick={() => setModal({})}>New category</Button></Can>} />} />
        <Pagination pagination={list.data && list.data.pagination} onChange={(page) => update({ page }, { resetPage: false })} />
      </Panel>
      {modal && <CategoryModal category={modal.category} onClose={() => setModal(null)} onSaved={() => { setModal(null); list.reload({ silent: true }); }} />}
    </div>
  );
}
