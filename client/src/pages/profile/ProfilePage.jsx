import { useState } from 'react';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader, Panel, TextInput, PasswordInput, SelectInput, Button, Details, InlineAlert } from '../../components/ui/index.js';
import { passwordProblem } from '../../validators/password.js';

function PersonalInfo() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ fullName: user.fullName, phone: user.phone || '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      await api.patch('/users/me', form);
      await refresh();
      toast.success('Profile updated.');
    } catch (err) {
      setErrors(err.fieldErrors);
      if (!Object.keys(err.fieldErrors).length) toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel title="Personal information">
      <form className="stack" onSubmit={save}>
        <div className="form-grid">
          <TextInput label="Full name" required value={form.fullName} error={errors.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          <TextInput label="Phone" value={form.phone} error={errors.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <Details items={[
          { label: 'Email', value: user.email },
          { label: 'Role', value: user.role.name },
          { label: 'Employee ID', value: user.employeeId },
          { label: 'Job title', value: user.jobTitle },
        ]} />
        <p className="small muted">Email, role, branches and employee ID are managed by an administrator.</p>
        <div className="form-actions"><Button type="submit" loading={saving}>Save changes</Button></div>
      </form>
    </Panel>
  );
}

function ChangePassword() {
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    const problem = passwordProblem(form.newPassword);
    if (!form.currentPassword) next.currentPassword = 'Enter your current password.';
    if (problem) next.newPassword = problem;
    if (form.newPassword !== form.confirm) next.confirm = 'Passwords do not match.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      await api.post('/auth/change-password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
      toast.success('Password changed. Your other sessions were signed out.');
    } catch (err) {
      setErrors(err.fieldErrors);
      if (!Object.keys(err.fieldErrors).length) toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel title="Change password">
      <form className="stack" onSubmit={submit} noValidate>
        <PasswordInput label="Current password" autoComplete="current-password" value={form.currentPassword} error={errors.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
        <div className="form-grid">
          <PasswordInput label="New password" autoComplete="new-password" value={form.newPassword} error={errors.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} hint="At least 8 characters with a letter and a number." />
          <PasswordInput label="Confirm new password" autoComplete="new-password" value={form.confirm} error={errors.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
        </div>
        <div className="form-actions"><Button type="submit" loading={saving}>Change password</Button></div>
      </form>
    </Panel>
  );
}

export function PreferencesForm() {
  const { preferences, refresh } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ ...preferences });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch('/users/me/preferences', { theme: form.theme, pageSize: Number(form.pageSize), uiDensity: form.uiDensity });
      await refresh();
      toast.success('Preferences saved.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel title="Preferences">
      <div className="stack">
        <div className="grid-3">
          <SelectInput label="Theme" value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })}
            options={[{ value: 'SYSTEM', label: 'Match system' }, { value: 'LIGHT', label: 'Light' }, { value: 'DARK', label: 'Dark' }]} />
          <SelectInput label="Rows per page" value={form.pageSize} onChange={(e) => setForm({ ...form, pageSize: e.target.value })}
            options={[10, 25, 50, 100].map((n) => ({ value: n, label: String(n) }))} />
          <SelectInput label="Density" value={form.uiDensity} onChange={(e) => setForm({ ...form, uiDensity: e.target.value })}
            options={[{ value: 'COMFORTABLE', label: 'Comfortable' }, { value: 'COMPACT', label: 'Compact' }]} />
        </div>
        <InlineAlert tone="info">Preferences only affect your own account.</InlineAlert>
        <div className="form-actions"><Button onClick={save} loading={saving}>Save preferences</Button></div>
      </div>
    </Panel>
  );
}

export default function ProfilePage() {
  return (
    <div className="stack">
      <PageHeader title="Profile and preferences" />
      <PersonalInfo />
      <ChangePassword />
      <PreferencesForm />
    </div>
  );
}
