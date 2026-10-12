import { TextInput, SelectInput, TextArea, Checkbox } from '../../components/ui/index.js';
import { useCategories, toOptions } from '../../hooks/useLookups.js';

export const DOSAGE_FORMS = ['Tablet', 'Capsule', 'Syrup', 'Suspension', 'Injection', 'Cream', 'Ointment', 'Drops', 'Inhaler', 'Powder', 'Suppository', 'Device'];

export function emptyMedicine() {
  return {
    name: '', genericName: '', brandName: '', categoryId: '', manufacturer: '', countryOfOrigin: '', strength: '',
    dosageForm: '', packageSize: '', prescriptionRequired: false, description: '', storageInstructions: '', barcode: '',
  };
}

export function medicinePayload(form, { includeBarcode = true } = {}) {
  const payload = {};
  for (const [key, value] of Object.entries(form)) {
    if (key === 'barcode' && !includeBarcode) continue;
    payload[key] = typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value;
  }
  payload.name = form.name.trim();
  payload.packageSize = form.packageSize.trim();
  if (!includeBarcode) delete payload.barcode;
  return payload;
}

export function MedicineFields({ form, setForm, errors, showBarcode = true }) {
  const categories = useCategories();
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  return (
    <div className="form-grid">
      <TextInput label="Name" required value={form.name} onChange={set('name')} error={errors.name} fieldClassName="span-2" />
      <TextInput label="Generic name" value={form.genericName} onChange={set('genericName')} error={errors.genericName} />
      <TextInput label="Brand name" value={form.brandName} onChange={set('brandName')} error={errors.brandName} />
      <TextInput label="Strength" placeholder="e.g. 500 mg" value={form.strength} onChange={set('strength')} error={errors.strength} />
      <SelectInput label="Dosage form" value={form.dosageForm} onChange={set('dosageForm')} placeholder="Not specified"
        options={DOSAGE_FORMS.map((d) => ({ value: d, label: d }))} error={errors.dosageForm} />
      <TextInput label="Package size" required placeholder="e.g. 10 tablets" value={form.packageSize} onChange={set('packageSize')} error={errors.packageSize} />
      <SelectInput label="Category" value={form.categoryId || ''} onChange={set('categoryId')} placeholder="Uncategorized"
        options={toOptions(categories.data)} error={errors.categoryId} />
      <TextInput label="Manufacturer" value={form.manufacturer} onChange={set('manufacturer')} error={errors.manufacturer} />
      <TextInput label="Country of origin" value={form.countryOfOrigin} onChange={set('countryOfOrigin')} error={errors.countryOfOrigin} />
      {showBarcode && <TextInput label="Barcode" value={form.barcode} onChange={set('barcode')} error={errors.barcode} hint="Optional. Each barcode can belong to one medicine." />}
      <div className="field" style={{ justifyContent: 'flex-end' }}>
        <Checkbox label="Prescription required" checked={form.prescriptionRequired} onChange={(e) => setForm({ ...form, prescriptionRequired: e.target.checked })} />
      </div>
      <TextArea label="Storage instructions" rows={2} value={form.storageInstructions} onChange={set('storageInstructions')} fieldClassName="span-2" />
      <TextArea label="Description" rows={2} value={form.description} onChange={set('description')} fieldClassName="span-2" />
    </div>
  );
}
