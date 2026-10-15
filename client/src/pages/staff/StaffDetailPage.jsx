import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { UserX, UserCheck, Link2, FileText, Download, Trash2 } from 'lucide-react';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useAction } from '../../hooks/useAction.js';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  PageHeader, Panel, Button, StatusBadge, Details, Tabs, DataTable, ErrorState, SkeletonRows, EmptyState, Pagination,
  TextInput, Checkbox, InlineAlert, ConfirmDialog, Badge, LearnHow, FileInput, formatFileSize,
} from '../../components/ui/index.js';
import { assignableRoles, SetupLinkNotice } from './StaffPage.jsx';
import { DeleteRecordButton } from '../../components/DeleteRecordButton.jsx';
import { formatDate, formatDateTime, humanize } from '../../utils/format.js';

const CV_MAX_BYTES = 5 * 1024 * 1024;

/** The staff member's CV (PDF): view, download, replace or remove. */
function CvSection({ staff, editable, onSaved }) {
  const [error, setError] = useState(null);
  const upload = useAction();
  const remove = useAction();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const cvUrl = `/api/v1/users/${staff.id}/cv`;
  const choose = async (file, message) => {
    setError(message);
    if (file && await upload.run(() => api.upload(`/users/${staff.id}/cv`, file), { success: 'CV uploaded.' })) onSaved();
  };
  const removeCv = async () => {
    const result = await remove.run(() => api.delete(`/users/${staff.id}/cv`), { success: 'CV removed.' });
    setConfirmRemove(false);
    if (result) onSaved();
  };
  return (
    <div className="stack-sm">
      <span className="field-label">CV</span>
      {staff.cv ? (
        <div className="row-wrap">
          <FileText aria-hidden="true" className="muted" />
          <span className="cell-strong" style={{ overflowWrap: 'anywhere' }}>{staff.cv.fileName}</span>
          <span className="small muted">{formatFileSize(staff.cv.sizeBytes)} · uploaded {formatDate(staff.cv.uploadedAt)}</span>
          <a className="btn btn-secondary btn-sm" href={cvUrl} target="_blank" rel="noopener noreferrer">View</a>
          <a className="btn btn-ghost btn-sm" href={`${cvUrl}?download=1`}><Download aria-hidden="true" /> Download</a>
          {editable && <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setConfirmRemove(true)}>Remove</Button>}
        </div>
      ) : <span className="muted small">No CV uploaded.</span>}
      {editable && (
        <FileInput accept="application/pdf" typeLabel="PDF file" maxBytes={CV_MAX_BYTES} hint="PDF, up to 5 MB."
          buttonLabel={upload.running ? 'Uploading…' : staff.cv ? 'Replace CV' : 'Upload CV'}
          error={error || (upload.error && upload.error.message)} disabled={upload.running} onChange={choose} />
      )}
      <ConfirmDialog open={confirmRemove} title="Remove CV" tone="danger" confirmLabel="Remove" loading={remove.running}
        message={`The CV will no longer be attached to ${staff.fullName}'s profile.`}
        onConfirm={removeCv} onClose={() => setConfirmRemove(false)} />
    </div>
  );
}

function ProfileTab({ staff, editable, cvEditable, onSaved }) {
  const [form, setForm] = useState({
    fullName: staff.fullName, email: staff.email, phone: staff.phone || '', employeeId: staff.employeeId || '', jobTitle: staff.jobTitle || '', hireDate: staff.hireDate || '',
  });
  const action = useAction();
  const save = async () => {
    const payload = { ...form };
    for (const key of ['phone', 'employeeId', 'jobTitle', 'hireDate']) if (!payload[key]) payload[key] = null;
    const result = await action.run(() => api.patch(`/users/${staff.id}`, payload), { success: 'Profile saved.' });
    if (result) onSaved();
  };
  if (!editable) {
    return (
      <div className="panel-body">
        <Details items={[
          { label: 'Email', value: staff.email },
          { label: 'Phone', value: staff.phone },
          { label: 'Employee ID', value: staff.employeeId },
          { label: 'Job title', value: staff.jobTitle },
          { label: 'Hire date', value: formatDate(staff.hireDate) },
          { label: 'Last sign-in', value: formatDateTime(staff.lastLoginAt) },
        ]} />
        <div style={{ marginTop: 16 }}><CvSection staff={staff} editable={cvEditable} onSaved={onSaved} /></div>
      </div>
    );
  }
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="panel-body stack">
      <div className="form-grid">
        <TextInput label="Full name" required value={form.fullName} onChange={set('fullName')} error={action.fieldErrors.fullName} />
        <TextInput label="Email" required value={form.email} onChange={set('email')} error={action.fieldErrors.email || (action.error && action.error.code === 'DUPLICATE_EMAIL' ? action.error.message : undefined)} />
        <TextInput label="Phone" value={form.phone} onChange={set('phone')} />
        <TextInput label="Employee ID" value={form.employeeId} onChange={set('employeeId')} error={action.fieldErrors.employeeId || (action.error && action.error.code === 'DUPLICATE_EMPLOYEE_ID' ? action.error.message : undefined)} />
        <TextInput label="Job title" value={form.jobTitle} onChange={set('jobTitle')} />
        <TextInput label="Hire date" type="date" value={form.hireDate} onChange={set('hireDate')} />
      </div>
      <div className="form-actions"><Button onClick={save} loading={action.running}>Save profile</Button></div>
      <CvSection staff={staff} editable={cvEditable} onSaved={onSaved} />
    </div>
  );
}

function RoleAndBranchesTab({ staff, canRole, canBranches, onSaved }) {
  const { user, activeBranches } = useAuth();
  const [roleCode, setRoleCode] = useState(staff.role.code);
  const [branchIds, setBranchIds] = useState(staff.branches.map((b) => b.id));
  const roleAction = useAction();
  const branchAction = useAction();
  const roles = assignableRoles(user);
  const roleOptions = roles.some((r) => r.value === staff.role.code) ? roles : [{ value: staff.role.code, label: staff.role.name }, ...roles];

  return (
    <div className="panel-body stack">
      <div className="stack-sm">
        <h3>Role</h3>
        {canRole ? (
          <div className="row-wrap">
            <select className="select" style={{ maxWidth: 220 }} value={roleCode} onChange={(e) => setRoleCode(e.target.value)} aria-label="Role">
              {roleOptions.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <Button disabled={roleCode === staff.role.code} loading={roleAction.running}
              onClick={async () => { if (await roleAction.run(() => api.patch(`/users/${staff.id}/role`, { roleCode }), { success: 'Role changed.' })) onSaved(); }}>Change role</Button>
          </div>
        ) : <p>{staff.role.name}</p>}
      </div>
      <div className="stack-sm">
        <h3>Branches</h3>
        {staff.role.code === 'OWNER' ? <p className="muted">Owners have access to all branches.</p> : canBranches ? (
          <>
            <div className="row-wrap" style={{ gap: 16 }}>
              {activeBranches.map((b) => (
                <Checkbox key={b.id} label={b.name} checked={branchIds.includes(b.id)}
                  onChange={(e) => setBranchIds(e.target.checked ? [...branchIds, b.id] : branchIds.filter((x) => x !== b.id))} />
              ))}
            </div>
            {staff.branches.some((b) => !activeBranches.some((a) => a.id === b.id)) && (
              <p className="small muted">Also assigned to: {staff.branches.filter((b) => !activeBranches.some((a) => a.id === b.id)).map((b) => b.name).join(', ')} (managed by others or inactive).</p>
            )}
            <div><Button loading={branchAction.running}
              onClick={async () => { if (await branchAction.run(() => api.patch(`/users/${staff.id}/branches`, { branchIds }), { success: 'Branches updated.' })) onSaved(); }}>Save branches</Button></div>
          </>
        ) : <p>{staff.branches.map((b) => b.name).join(', ') || '—'}</p>}
      </div>
      <LearnHow slug="roles-and-permissions" />
    </div>
  );
}

const OVERRIDE_OPTIONS = [
  { value: 'INHERITED', label: 'Inherited' },
  { value: 'GRANT', label: 'Explicit grant' },
  { value: 'DENY', label: 'Explicit deny' },
];

function PermissionsTab({ staffId }) {
  const perms = useApi(() => api.get(`/users/${staffId}/permissions`).then((r) => r.data), [staffId]);
  const action = useAction();
  const groups = useMemo(() => {
    if (!perms.data) return [];
    const map = new Map();
    for (const p of perms.data.permissions) {
      if (!map.has(p.module)) map.set(p.module, []);
      map.get(p.module).push(p);
    }
    return [...map.entries()];
  }, [perms.data]);

  if (perms.error) return <ErrorState error={perms.error} onRetry={perms.reload} />;
  if (!perms.data) return <SkeletonRows rows={8} />;

  const change = async (code, value) => {
    const call = value === 'INHERITED'
      ? () => api.delete(`/users/${staffId}/permissions/${code}`)
      : () => api.put(`/users/${staffId}/permissions/${code}`, { granted: value === 'GRANT' });
    const result = await action.run(call, { success: 'Permission updated.' });
    if (result) perms.setData(result.data);
  };

  return (
    <div className="stack">
      {perms.data.isOwner && <div className="panel-body"><InlineAlert tone="info">Owners always have every permission. Owner permissions cannot be changed.</InlineAlert></div>}
      {groups.map(([module, list]) => (
        <div key={module}>
          <div className="search-group-label" style={{ padding: '10px 16px 4px' }}>{humanize(module)}</div>
          <table className="table responsive">
            <tbody>
              {list.map((p) => (
                <tr key={p.code}>
                  <td data-label="Permission">
                    <span className="stack-sm" style={{ gap: 1 }}>
                      <span className="mono">{p.code}</span>
                      <span className="small muted">{p.description}</span>
                    </span>
                  </td>
                  <td data-label="Role default">{p.inherited ? <Badge tone="primary">Role default</Badge> : <span className="subtle small">Not in role</span>}</td>
                  <td data-label="Setting">
                    <select className="select" style={{ width: 160 }} value={p.override || 'INHERITED'} disabled={!p.canModify || action.running}
                      onChange={(e) => change(p.code, e.target.value)} aria-label={`Setting for ${p.code}`}>
                      {OVERRIDE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </td>
                  <td data-label="Effective">{p.effective ? <Badge tone="success">Allowed</Badge> : <Badge>Not allowed</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function ActivityTab({ staffId }) {
  const [page, setPage] = useState(1);
  const activity = useApi(() => api.get(`/users/${staffId}/activity`, { page }), [staffId, page]);
  return (
    <>
      <DataTable rows={activity.data && activity.data.data} loading={activity.loading} error={activity.error} onRetry={activity.reload}
        columns={[
          { key: 'timestamp', label: 'When', render: (a) => <span className="nowrap small">{formatDateTime(a.timestamp)}</span> },
          { key: 'action', label: 'Action', render: (a) => humanize(a.action) },
          { key: 'description', label: 'Description' },
          { key: 'branchName', label: 'Branch', render: (a) => a.branchName || '—' },
        ]}
        empty={<EmptyState title="No recorded activity" />} />
      <Pagination pagination={activity.data && activity.data.pagination} onChange={setPage} />
    </>
  );
}

export default function StaffDetailPage() {
  const { id } = useParams();
  const { user, can } = useAuth();
  const [tab, setTab] = useState('profile');
  const [confirm, setConfirm] = useState(null);
  const [setupLink, setSetupLink] = useState(null);
  const action = useAction();
  const staff = useApi(() => api.get(`/users/${id}`).then((r) => r.data), [id]);

  if (staff.error) return <Panel><ErrorState error={staff.error} onRetry={staff.reload} /></Panel>;
  if (!staff.data) return <Panel><SkeletonRows rows={6} /></Panel>;
  const s = staff.data;
  const self = s.id === user.id;
  const rank = { OWNER: 1, ADMIN: 2, PHARMACIST: 3, CASHIER: 4 };
  const outranks = user.role.code === 'OWNER' || rank[s.role.code] > rank[user.role.code];
  const manageable = !self && outranks;
  const refresh = () => staff.reload({ silent: true });

  const toggleStatus = async () => {
    const deactivate = s.status === 'ACTIVE';
    const result = await action.run(() => api.post(`/users/${id}/${deactivate ? 'deactivate' : 'reactivate'}`), { success: deactivate ? 'Account deactivated and signed out.' : 'Account reactivated.' });
    setConfirm(null);
    if (result) refresh();
  };
  const resendLink = async () => {
    const result = await action.run(() => api.post(`/users/${id}/setup-link`), { success: 'New setup link issued.' });
    if (result) setSetupLink(result.data.setupLink);
  };

  const tabs = [
    { value: 'profile', label: 'Profile' },
    { value: 'access', label: 'Role & branches' },
    { value: 'permissions', label: 'Permissions' },
    can('AUDIT_LOG_VIEW') && { value: 'activity', label: 'Activity' },
  ].filter(Boolean);

  return (
    <div className="stack">
      <PageHeader
        breadcrumbs={[{ label: 'Staff', to: '/staff' }, { label: s.fullName }]}
        title={<span className="row-wrap">{s.fullName} <StatusBadge status={s.status} /></span>}
        description={`${s.role.name} · ${s.email}`}
        actions={manageable && (
          <>
            {!s.hasPassword && s.status === 'ACTIVE' && can('STAFF_CREATE') && <Button variant="secondary" icon={Link2} onClick={resendLink} loading={action.running}>New setup link</Button>}
            {s.status === 'ACTIVE' && can('STAFF_DEACTIVATE') && <Button variant="ghost" icon={UserX} onClick={() => setConfirm('deactivate')}>Deactivate</Button>}
            {s.status === 'INACTIVE' && can('STAFF_REACTIVATE') && <Button variant="secondary" icon={UserCheck} onClick={toggleStatus} loading={action.running}>Reactivate</Button>}
            {s.canDelete && can('STAFF_DEACTIVATE') && <DeleteRecordButton path={`/users/${id}`} name={s.fullName} what="staff account" listPath="/staff" />}
          </>
        )}
      />
      {self && <InlineAlert tone="info">This is your own account. Your role, permissions, branches and status can only be changed by someone else. Edit your personal details on your profile page.</InlineAlert>}
      {!self && !outranks && <InlineAlert tone="info">You cannot modify a user with an equal or higher role.</InlineAlert>}
      {!s.hasPassword && s.status === 'ACTIVE' && <InlineAlert tone="warning">Account setup is pending: this person has not chosen a password yet.</InlineAlert>}
      {setupLink && <SetupLinkNotice link={setupLink} />}
      <Panel flush>
        <Tabs tabs={tabs} active={tab} onChange={setTab} />
        {tab === 'profile' && <ProfileTab staff={s} editable={manageable && can('STAFF_EDIT')} cvEditable={(self || outranks) && (can('STAFF_EDIT') || can('STAFF_CREATE'))} onSaved={refresh} />}
        {tab === 'access' && <RoleAndBranchesTab key={s.updatedAt} staff={s} canRole={manageable && can('STAFF_CHANGE_ROLE')} canBranches={manageable && can('STAFF_MANAGE_BRANCHES')} onSaved={refresh} />}
        {tab === 'permissions' && <PermissionsTab staffId={s.id} />}
        {tab === 'activity' && <ActivityTab staffId={s.id} />}
      </Panel>
      <ConfirmDialog open={confirm === 'deactivate'} title="Deactivate account" tone="danger" confirmLabel="Deactivate" loading={action.running}
        message={`${s.fullName} will be signed out everywhere and will not be able to sign in. Their history is kept and the account can be reactivated.`}
        onConfirm={toggleStatus} onClose={() => setConfirm(null)} />
    </div>
  );
}
