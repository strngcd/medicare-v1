import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Users, Copy } from 'lucide-react';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useAction } from '../../hooks/useAction.js';
import { useListState } from '../../hooks/useListState.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Can } from '../../permissions/Can.jsx';
import { PageHeader, Panel, DataTable, Pagination, Button, StatusBadge, EmptyState, SelectInput, Modal, TextInput, Checkbox, InlineAlert, FilterToolbar, FileInput } from '../../components/ui/index.js';
import { formatDateTime } from '../../utils/format.js';

const ROLES = [
  { value: 'OWNER', label: 'Owner' },
  { value: 'ADMIN', label: 'Admin' },
  { value: 'PHARMACIST', label: 'Pharmacist' },
  { value: 'CASHIER', label: 'Cashier' },
];

/** Roles the current user may assign (Owners: any; others: below their own). */
export function assignableRoles(user) {
  const rank = { OWNER: 1, ADMIN: 2, PHARMACIST: 3, CASHIER: 4 };
  const mine = rank[user.role.code];
  return ROLES.filter((r) => user.role.code === 'OWNER' || rank[r.value] > mine);
}

export function SetupLinkNotice({ link }) {
  const toast = useToast();
  return (
    <InlineAlert tone="success">
      <div className="stack-sm">
        <span>Share this one-time setup link with the staff member (it was also emailed if email is configured). It expires {formatDateTime(link.expiresAt)}.</span>
        <div className="row">
          <input className="input mono" readOnly value={link.url} onFocus={(e) => e.target.select()} aria-label="Setup link" />
          <Button variant="secondary" icon={Copy} onClick={() => navigator.clipboard.writeText(link.url).then(() => toast.success('Link copied.'))}>Copy</Button>
        </div>
      </div>
    </InlineAlert>
  );
}

function CreateStaffModal({ onClose, onCreated }) {
  const { user, activeBranches } = useAuth();
  const roles = assignableRoles(user);
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', employeeId: '', jobTitle: '', hireDate: '', roleCode: roles[roles.length - 1].value, branchIds: [] });
  const [created, setCreated] = useState(null);
  const [cv, setCv] = useState(null);
  const [cvError, setCvError] = useState(null);
  const [cvUploadError, setCvUploadError] = useState(null);
  const [uploadingCv, setUploadingCv] = useState(false);
  const action = useAction();
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const save = async () => {
    const payload = { ...form, branchIds: form.roleCode === 'OWNER' ? [] : form.branchIds };
    for (const key of ['phone', 'employeeId', 'jobTitle', 'hireDate']) if (!payload[key]) payload[key] = null;
    const result = await action.run(() => api.post('/users', payload), { success: 'Staff account created.' });
    if (!result) return;
    if (cv) {
      // The account exists either way; a failed CV upload can be retried from the profile.
      setUploadingCv(true);
      try {
        result.data.user = (await api.upload(`/users/${result.data.user.id}/cv`, cv)).data;
      } catch (err) {
        setCvUploadError(err.message);
      } finally {
        setUploadingCv(false);
      }
    }
    setCreated(result.data);
  };
  const busy = action.running || uploadingCv;

  if (created) {
    return (
      <Modal open title="Staff account created" onClose={() => onCreated(created.user)}
        footer={<Button onClick={() => onCreated(created.user)}>Open staff profile</Button>}>
        <p><strong>{created.user.fullName}</strong> ({created.user.role.name}) can now set their own password.</p>
        {cvUploadError && <InlineAlert tone="warning">The CV could not be uploaded ({cvUploadError}). You can upload it from the staff profile.</InlineAlert>}
        <SetupLinkNotice link={created.setupLink} />
      </Modal>
    );
  }

  return (
    <Modal open size="lg" title="New staff member" onClose={onClose} closeDisabled={busy}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={save} loading={busy}>Create account</Button></>}>
      <div className="form-grid">
        <TextInput label="Full name" required value={form.fullName} onChange={set('fullName')} error={action.fieldErrors.fullName} />
        <TextInput label="Email" type="email" required value={form.email} onChange={set('email')} error={action.fieldErrors.email || (action.error && action.error.code === 'DUPLICATE_EMAIL' ? action.error.message : undefined)} />
        <TextInput label="Phone" value={form.phone} onChange={set('phone')} />
        <TextInput label="Employee ID" value={form.employeeId} onChange={set('employeeId')} error={action.fieldErrors.employeeId || (action.error && action.error.code === 'DUPLICATE_EMPLOYEE_ID' ? action.error.message : undefined)} />
        <TextInput label="Job title" value={form.jobTitle} onChange={set('jobTitle')} />
        <TextInput label="Hire date" type="date" value={form.hireDate} onChange={set('hireDate')} />
        <SelectInput label="Role" required value={form.roleCode} options={roles} onChange={set('roleCode')} />
        <FileInput label="CV (optional)" accept="application/pdf" typeLabel="PDF file" maxBytes={5 * 1024 * 1024} hint="PDF, up to 5 MB."
          value={cv} error={cvError} buttonLabel={cv ? 'Change file' : 'Choose PDF'} disabled={busy}
          onChange={(file, message) => { setCv(file); setCvError(message); }} />
      </div>
      {form.roleCode !== 'OWNER' ? (
        <div className="stack-sm">
          <span className="field-label">Branches (at least one)</span>
          <div className="row-wrap" style={{ gap: 16 }}>
            {activeBranches.map((b) => (
              <Checkbox key={b.id} label={b.name} checked={form.branchIds.includes(b.id)}
                onChange={(e) => setForm({ ...form, branchIds: e.target.checked ? [...form.branchIds, b.id] : form.branchIds.filter((x) => x !== b.id) })} />
            ))}
          </div>
          {action.fieldErrors.branchIds && <span className="field-error">{action.fieldErrors.branchIds}</span>}
        </div>
      ) : <InlineAlert tone="info">Owners have access to every branch.</InlineAlert>}
      <InlineAlert tone="info">No password is set here. The staff member receives a single-use link to choose their own password.</InlineAlert>
    </Modal>
  );
}

export default function StaffPage() {
  const navigate = useNavigate();
  const { activeBranches } = useAuth();
  const { state, update, clear, hasFilters } = useListState();
  const list = useApi(() => api.get('/users', state), [JSON.stringify(state)]);
  const [creating, setCreating] = useState(false);

  return (
    <div className="stack">
      <PageHeader title="Staff" description="Accounts, roles, branch assignments and permissions."
        actions={<Can permission="STAFF_CREATE"><Button icon={Plus} onClick={() => setCreating(true)}>New staff member</Button></Can>} />
      <Panel flush>
        <FilterToolbar>
          <div className="field search-field">
            <span className="field-label">Search</span>
            <input className="input" type="search" placeholder="Name, email or employee ID" defaultValue={state.search || ''} onChange={(e) => update({ search: e.target.value })} aria-label="Search staff" />
          </div>
          <SelectInput label="Role" value={state.role || ''} placeholder="All roles" options={ROLES} onChange={(e) => update({ role: e.target.value })} />
          <SelectInput label="Branch" value={state.branchId || ''} placeholder="All branches" options={activeBranches.map((b) => ({ value: b.id, label: b.name }))} onChange={(e) => update({ branchId: e.target.value })} />
          <SelectInput label="Status" value={state.status || ''} placeholder="All" options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }]} onChange={(e) => update({ status: e.target.value })} />
        </FilterToolbar>
        <DataTable rows={list.data && list.data.data} loading={list.loading} error={list.error} onRetry={list.reload}
          sort={state} onSort={update} filtered={hasFilters} isSearch={Boolean(state.search)} onClearFilters={clear}
          onRowClick={(u) => navigate(`/staff/${u.id}`)}
          columns={[
            { key: 'fullName', label: 'Name', sortable: true, render: (u) => <span className="cell-strong">{u.fullName}</span> },
            { key: 'email', label: 'Email', sortable: true },
            { key: 'employeeId', label: 'Employee ID', sortable: true, render: (u) => u.employeeId || '—' },
            { key: 'role', label: 'Role', sortable: true, render: (u) => u.role.name },
            { key: 'branches', label: 'Branches', render: (u) => (u.role.code === 'OWNER' ? 'All' : u.branches.map((b) => b.code).join(', ') || '—') },
            { key: 'status', label: 'Status', sortable: true, render: (u) => (<span className="row-wrap"><StatusBadge status={u.status} />{!u.hasPassword && u.status === 'ACTIVE' && <StatusBadge status="PENDING" label="Setup pending" />}</span>) },
            { key: 'lastLoginAt', label: 'Last sign-in', sortable: true, render: (u) => formatDateTime(u.lastLoginAt) },
          ]}
          empty={<EmptyState icon={Users} title="No staff" />} />
        <Pagination pagination={list.data && list.data.pagination} onChange={(page) => update({ page }, { resetPage: false })} />
      </Panel>
      {creating && <CreateStaffModal onClose={() => setCreating(false)} onCreated={(u) => navigate(`/staff/${u.id}`)} />}
    </div>
  );
}
