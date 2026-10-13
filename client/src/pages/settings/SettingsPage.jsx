import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useAction } from '../../hooks/useAction.js';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  PageHeader, Panel, Button, TextInput, SelectInput, TextArea, Checkbox, InlineAlert, Details, ErrorState, SkeletonRows, Tabs, DataTable, LearnHow,
} from '../../components/ui/index.js';
import { PreferencesForm } from '../profile/ProfilePage.jsx';
import { Receipt } from '../../components/sales/Receipt.jsx';
import { formatDateTime, humanize } from '../../utils/format.js';

const SECTIONS = [
  { value: 'pharmacy', label: 'Pharmacy', global: true },
  { value: 'branches', label: 'Branches' },
  { value: 'tax', label: 'Tax', global: true },
  { value: 'inventory', label: 'Inventory', global: true },
  { value: 'sales', label: 'Sales & POS' },
  { value: 'receipts', label: 'Receipts' },
  { value: 'numbering', label: 'Numbering' },
  { value: 'notifications', label: 'Notifications' },
  { value: 'preferences', label: 'My preferences' },
  { value: 'system', label: 'System' },
];

/** Saves only the fields of one global settings section. */
function GlobalSection({ settings, fields, onSaved, children }) {
  const { can, refresh } = useAuth();
  const editable = can('SETTINGS_EDIT');
  const [form, setForm] = useState(() => Object.fromEntries(fields.map((f) => [f, settings[f] ?? ''])));
  const action = useAction();
  const save = async () => {
    const payload = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? null : v]));
    const result = await action.run(() => api.patch('/settings', payload), { success: 'Settings saved.' });
    if (result) {
      onSaved(result.data);
      refresh();
    }
  };
  return (
    <div className="stack">
      {children({ form, setForm, errors: action.fieldErrors, editable })}
      {!editable && <InlineAlert tone="info">You can view these settings. Changing them requires the Settings edit permission.</InlineAlert>}
      {editable && <div className="form-actions"><Button onClick={save} loading={action.running}>Save</Button></div>}
    </div>
  );
}

function BranchSettingsSection({ branchId, section }) {
  const { can, activeBranches } = useAuth();
  const editable = can('SETTINGS_EDIT') || can('BRANCH_EDIT');
  const settings = useApi(() => api.get(`/branches/${branchId}/settings`).then((r) => r.data), [branchId], { enabled: Boolean(branchId) });
  const [form, setForm] = useState(null);
  const action = useAction();
  useEffect(() => setForm(settings.data), [settings.data]);

  if (!branchId) return <InlineAlert tone="info">Select a branch above to view its settings.</InlineAlert>;
  if (settings.error) return <ErrorState error={settings.error} onRetry={settings.reload} />;
  if (!form) return <SkeletonRows rows={4} />;

  const save = async () => {
    const keys = section === 'inventory' ? ['defaultMinimumStock'] : ['receiptShowTax', 'receiptShowDiscount', 'receiptShowBranchAddress', 'receiptShowBranchPhone', 'receiptShowStaff', 'receiptFooter'];
    const payload = Object.fromEntries(keys.map((k) => [k, k === 'defaultMinimumStock' ? Number(form[k]) : form[k]]));
    const result = await action.run(() => api.patch(`/branches/${branchId}/settings`, payload), { success: 'Branch settings saved.' });
    if (result) settings.setData(result.data);
  };
  const branchName = (activeBranches.find((b) => b.id === branchId) || {}).name;

  return (
    <div className="stack">
      {section === 'inventory' ? (
        <>
          <TextInput label={`Default minimum stock for new inventory records (${branchName || 'branch'})`} type="number" min="0" disabled={!editable}
            value={form.defaultMinimumStock} onChange={(e) => setForm({ ...form, defaultMinimumStock: e.target.value })} error={action.fieldErrors.defaultMinimumStock} />
          <InlineAlert tone="info">Changing the default affects only stock records created from now on. Existing minimum stock levels are not changed.</InlineAlert>
        </>
      ) : (
        <div className="grid-2">
          <div className="stack-sm">
            <Checkbox label="Show tax" checked={form.receiptShowTax} disabled={!editable} onChange={(e) => setForm({ ...form, receiptShowTax: e.target.checked })} />
            <Checkbox label="Show discount" checked={form.receiptShowDiscount} disabled={!editable} onChange={(e) => setForm({ ...form, receiptShowDiscount: e.target.checked })} />
            <Checkbox label="Show branch address" checked={form.receiptShowBranchAddress} disabled={!editable} onChange={(e) => setForm({ ...form, receiptShowBranchAddress: e.target.checked })} />
            <Checkbox label="Show branch phone" checked={form.receiptShowBranchPhone} disabled={!editable} onChange={(e) => setForm({ ...form, receiptShowBranchPhone: e.target.checked })} />
            <Checkbox label="Show staff name" checked={form.receiptShowStaff} disabled={!editable} onChange={(e) => setForm({ ...form, receiptShowStaff: e.target.checked })} />
            <TextArea label="Receipt footer" rows={3} disabled={!editable} value={form.receiptFooter || ''} onChange={(e) => setForm({ ...form, receiptFooter: e.target.value })} />
          </div>
          <ReceiptPreview branchName={branchName} form={form} />
        </div>
      )}
      {editable && <div className="form-actions"><Button onClick={save} loading={action.running}>Save branch settings</Button></div>}
    </div>
  );
}

function ReceiptPreview({ branchName, form }) {
  const { pharmacy, user } = useAuth();
  const sample = {
    pharmacy: { name: pharmacy.name, logoUrl: pharmacy.logoUrl, currencyCode: pharmacy.currencyCode },
    branch: { name: branchName, address: form.receiptShowBranchAddress ? 'Branch address' : null, phone: form.receiptShowBranchPhone ? '+251 …' : null },
    receiptNumber: 'SAL-XXXXXX',
    status: 'COMPLETED',
    completedAt: new Date().toISOString(),
    staff: form.receiptShowStaff ? user.fullName : null,
    paymentMethod: 'CASH',
    items: [{ medicineName: 'Sample medicine', quantity: 2, unitSellingPrice: '50.00', lineTotal: '100.00' }],
    subtotal: '100.00',
    discount: form.receiptShowDiscount ? '10.00' : null,
    tax: form.receiptShowTax && pharmacy.tax.enabled ? '13.50' : null,
    taxName: pharmacy.tax.name,
    taxRate: pharmacy.tax.rate,
    taxMode: pharmacy.tax.mode,
    total: '103.50',
    footer: form.receiptFooter,
  };
  return <div className="stack-sm"><span className="field-label">Preview (sample data)</span><Receipt receipt={sample} /></div>;
}

export default function SettingsPage() {
  const { can, activeBranches, branchParam } = useAuth();
  const [params, setParams] = useSearchParams();
  const section = params.get('section') || (can('SETTINGS_VIEW') ? 'pharmacy' : 'receipts');
  const [branchId, setBranchId] = useState(params.get('branchId') || branchParam || (activeBranches[0] && activeBranches[0].id) || '');
  const canGlobal = can('SETTINGS_VIEW');
  const settings = useApi(() => api.get('/settings').then((r) => r.data), [], { enabled: canGlobal });
  const system = useApi(() => api.get('/system/info').then((r) => r.data), [], { enabled: canGlobal && ['numbering', 'system'].includes(section) });

  const visible = SECTIONS.filter((s) => !s.global || canGlobal).filter((s) => canGlobal || !['numbering', 'system'].includes(s.value));
  const go = (value) => setParams({ section: value });
  const s = settings.data;
  const needsGlobal = SECTIONS.find((x) => x.value === section).global;

  let body;
  if (needsGlobal && settings.error) body = <ErrorState error={settings.error} onRetry={settings.reload} />;
  else if (needsGlobal && !s) body = <SkeletonRows rows={5} />;
  else if (section === 'pharmacy') {
    body = (
      <GlobalSection settings={s} fields={['pharmacyName', 'logoUrl', 'phone', 'email', 'address', 'city', 'country', 'website', 'currencyCode']} onSaved={settings.setData}>
        {({ form, setForm, errors, editable }) => (
          <div className="form-grid">
            {[['pharmacyName', 'Pharmacy name'], ['logoUrl', 'Logo URL'], ['phone', 'Phone'], ['email', 'Email'], ['address', 'Address'], ['city', 'City'], ['country', 'Country'], ['website', 'Website'], ['currencyCode', 'Currency (ISO code)']].map(([k, label]) => (
              <TextInput key={k} label={label} disabled={!editable} value={form[k] || ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} error={errors[k]} />
            ))}
          </div>
        )}
      </GlobalSection>
    );
  } else if (section === 'tax') {
    body = (
      <GlobalSection settings={s} fields={['taxEnabled', 'taxName', 'taxRate', 'taxMode']} onSaved={settings.setData}>
        {({ form, setForm, errors, editable }) => (
          <>
            <Checkbox label="Charge tax on sales" checked={Boolean(form.taxEnabled)} disabled={!editable} onChange={(e) => setForm({ ...form, taxEnabled: e.target.checked })} />
            <div className="grid-3">
              <TextInput label="Tax name" disabled={!editable} value={form.taxName || ''} onChange={(e) => setForm({ ...form, taxName: e.target.value })} error={errors.taxName} />
              <TextInput label="Rate (%)" inputMode="decimal" disabled={!editable} value={form.taxRate || ''} onChange={(e) => setForm({ ...form, taxRate: e.target.value })} error={errors.taxRate} />
              <SelectInput label="Mode" disabled={!editable} value={form.taxMode} onChange={(e) => setForm({ ...form, taxMode: e.target.value })}
                options={[{ value: 'ADDED_ON_TOP', label: 'Added on top of prices' }, { value: 'INCLUDED', label: 'Included in prices' }]} />
            </div>
            <InlineAlert tone="warning">Tax changes apply to new sales only. Completed sales keep the tax recorded at the time of sale.</InlineAlert>
          </>
        )}
      </GlobalSection>
    );
  } else if (section === 'inventory') {
    body = (
      <div className="stack">
        <GlobalSection settings={s} fields={['expiryWarningDays']} onSaved={settings.setData}>
          {({ form, setForm, errors, editable }) => (
            <TextInput label="Expiry warning period (days)" type="number" min="1" max="365" disabled={!editable} value={form.expiryWarningDays}
              onChange={(e) => setForm({ ...form, expiryWarningDays: Number(e.target.value) })} error={errors.expiryWarningDays}
              hint="Batches expiring within this many days are flagged as Expiring soon." />
          )}
        </GlobalSection>
        <BranchPicker branchId={branchId} setBranchId={setBranchId} />
        <BranchSettingsSection branchId={branchId} section="inventory" />
      </div>
    );
  } else if (section === 'receipts') {
    body = (<div className="stack"><BranchPicker branchId={branchId} setBranchId={setBranchId} /><BranchSettingsSection branchId={branchId} section="receipts" /></div>);
  } else if (section === 'branches') {
    body = (
      <div className="stack">
        <p>Branch details, status and staff are managed on the Branches page. Branch-specific options are under Inventory (default minimum stock) and Receipts.</p>
        {can('BRANCH_VIEW') && <div><Link className="btn btn-secondary" to="/branches">Open branches</Link></div>}
      </div>
    );
  } else if (section === 'sales') {
    body = (
      <div className="stack">
        <Details items={[
          { label: 'Payment methods', value: 'Cash, Bank transfer' },
          { label: 'Payment rule', value: 'Exact payment, one method per sale' },
          { label: 'Batch selection', value: 'First-expired, first-out (FEFO)' },
          { label: 'Discounts', value: 'Percentage or fixed; requires the discount permission' },
          { label: 'Prescription medicines', value: 'Warning shown at the till' },
          { label: 'Selling prices', value: 'Per branch and batch (Inventory)' },
        ]} />
        <LearnHow slug="using-the-pos" />
      </div>
    );
  } else if (section === 'numbering' || section === 'system') {
    const info = system.data;
    if (system.error) body = <ErrorState error={system.error} onRetry={system.reload} />;
    else if (!info) body = <SkeletonRows rows={4} />;
    else if (section === 'numbering') {
      body = (
        <div className="stack">
          <p className="muted">{info.numbering.format}. Numbers are generated by the system and cannot be edited.</p>
          <DataTable rowKey="sequenceType" rows={Object.entries(info.numbering.prefixes).map(([type, prefix]) => {
            const latest = info.numbering.latestNumbers.find((n) => n.documentType === type);
            return { sequenceType: type, prefix, last: latest ? latest.number : 'None yet' };
          })} columns={[
            { key: 'sequenceType', label: 'Document', render: (r) => humanize(r.sequenceType) },
            { key: 'prefix', label: 'Prefix', render: (r) => <span className="mono">{r.prefix}</span> },
            { key: 'last', label: 'Last issued', render: (r) => <span className="mono">{r.last}</span> },
          ]} />
        </div>
      );
    } else {
      body = (
        <Details items={[
          { label: 'Application', value: info.application },
          { label: 'Version', value: info.version },
          { label: 'Environment', value: info.environment },
          { label: 'Business time zone', value: info.businessTimezone },
          { label: 'Business date', value: info.businessDate },
          { label: 'Server time', value: formatDateTime(info.serverTime) },
          { label: 'Database schema', value: info.schemaVersion },
          { label: 'Active branches', value: info.counts.activeBranches },
          { label: 'Active users', value: info.counts.activeUsers },
          { label: 'Active medicines', value: info.counts.activeMedicines },
        ]} />
      );
    }
  } else if (section === 'notifications') {
    body = (
      <div className="stack">
        <p><strong>Inventory alerts</strong> (expired, expiring soon, low and out of stock) are calculated from current stock and clear automatically. The expiring-soon window is set under Inventory.</p>
        <p><strong>Notifications</strong> tell you about purchases received or cancelled, transfer steps and discrepancies, and account security events. Security notifications are always sent.</p>
        <div className="row-wrap"><Link className="btn btn-secondary" to="/notifications">Open my notifications</Link><Link className="btn btn-secondary" to="/alerts">Open alerts</Link></div>
      </div>
    );
  } else if (section === 'preferences') {
    body = <PreferencesForm />;
  }

  return (
    <div className="stack">
      <PageHeader title="Settings" description="Global pharmacy settings, branch settings and your own preferences are kept separate." />
      <Panel flush>
        <Tabs tabs={visible} active={section} onChange={go} />
        <div className="panel-body">
          {SECTIONS.find((x) => x.value === section).global && <p className="small subtle" style={{ marginBottom: 12 }}>Applies to all branches.</p>}
          {body}
        </div>
      </Panel>
    </div>
  );
}

function BranchPicker({ branchId, setBranchId }) {
  const { activeBranches } = useAuth();
  return (
    <SelectInput label="Branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}
      options={activeBranches.map((b) => ({ value: b.id, label: b.name }))} placeholder="Select branch" fieldClassName="" />
  );
}
