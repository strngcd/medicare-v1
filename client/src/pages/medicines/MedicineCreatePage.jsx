import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, CheckCircle2 } from 'lucide-react';
import { api, newIdempotencyKey } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useAction } from '../../hooks/useAction.js';
import { PageHeader, Panel, Button, Steps, InlineAlert, DataTable, LearnHow } from '../../components/ui/index.js';
import { BatchFields, batchPayload } from '../../components/inventory/AddStockModal.jsx';
import { MedicineFields, emptyMedicine, medicinePayload } from './MedicineFields.jsx';
import { formatDate, formatMoney, formatNumber } from '../../utils/format.js';

const STEPS = [{ value: 'info', label: 'Medicine information' }, { value: 'batches', label: 'Batches' }];

/**
 * Two-step flow: 1) save the medicine as DRAFT, 2) add one or more batches,
 * then finish (DRAFT -> ACTIVE).
 */
export default function MedicineCreatePage() {
  const navigate = useNavigate();
  const { activeBranches, branchParam, can } = useAuth();
  const [step, setStep] = useState('info');
  const [form, setForm] = useState(emptyMedicine());
  const [medicine, setMedicine] = useState(null);
  const [duplicates, setDuplicates] = useState([]);
  const [batches, setBatches] = useState([]);
  const blankBatch = () => ({
    branchId: branchParam || (activeBranches[0] && activeBranches[0].id) || '',
    batchNumber: '', manufacturingDate: '', expiryDate: '', purchasePrice: '', sellingPrice: '', quantity: '', supplierId: '', notes: '',
  });
  const [batch, setBatch] = useState(blankBatch);
  const [batchKey, setBatchKey] = useState(() => newIdempotencyKey('stock'));
  const saveAction = useAction();
  const batchAction = useAction();
  const finishAction = useAction();

  const saveDraft = async (e) => {
    e.preventDefault();
    const result = await saveAction.run(() => api.post('/medicines', medicinePayload(form)), { success: 'Saved as draft.' });
    if (result) {
      setMedicine(result.data.medicine);
      setDuplicates(result.data.warnings.duplicates);
      setStep('batches');
    }
  };

  const addBatch = async () => {
    const result = await batchAction.run(
      () => api.post('/inventory/stock', batchPayload(batch, medicine.id), { idempotencyKey: batchKey }),
      { success: 'Batch added.' },
    );
    if (result) {
      setBatches((list) => [...list, { ...result.data.inventory, key: result.data.inventoryId + list.length }]);
      setBatch(blankBatch());
      setBatchKey(newIdempotencyKey('stock'));
    }
  };

  const finish = async () => {
    const result = await finishAction.run(() => api.patch(`/medicines/${medicine.id}`, { status: 'ACTIVE' }), { success: 'Medicine is now active.' });
    if (result) navigate(`/medicines/${medicine.id}`, { replace: true });
  };

  return (
    <div className="stack">
      <PageHeader
        title="Add medicine"
        breadcrumbs={[{ label: 'Medicines', to: '/medicines' }, { label: 'New' }]}
        actions={<LearnHow slug="adding-a-medicine" />}
      />
      <Steps steps={STEPS} current={step} />

      {step === 'info' && (
        <Panel title="Medicine information">
          <form className="stack" onSubmit={saveDraft}>
            <MedicineFields form={form} setForm={setForm} errors={saveAction.fieldErrors} />
            <div className="form-actions">
              <Button variant="secondary" onClick={() => navigate('/medicines')}>Cancel</Button>
              <Button type="submit" loading={saveAction.running}>Save draft and continue</Button>
            </div>
          </form>
        </Panel>
      )}

      {step === 'batches' && medicine && (
        <>
          {duplicates.length > 0 && (
            <InlineAlert tone="warning">
              A similar medicine already exists:{' '}
              {duplicates.map((d, i) => (
                <span key={d.id}>{i > 0 && ', '}<Link to={`/medicines/${d.id}`}>{d.name} {d.strength} ({d.status.toLowerCase()})</Link></span>
              ))}
              . Check it is not a duplicate before adding stock.
            </InlineAlert>
          )}
          <Panel title={`${medicine.name} — draft`} actions={<span className="small muted">{[medicine.strength, medicine.dosageForm, medicine.packageSize].filter(Boolean).join(' · ')}</span>}>
            <p className="muted">Add the batches you have on hand. You can also finish now and receive stock later through a purchase.</p>
          </Panel>

          {batches.length > 0 && (
            <Panel title="Batches added" flush>
              <DataTable rowKey="key" rows={batches} columns={[
                { key: 'batchNumber', label: 'Batch' },
                { key: 'branchName', label: 'Branch' },
                { key: 'expiryDate', label: 'Expiry', render: (b) => formatDate(b.expiryDate) },
                { key: 'quantity', label: 'Quantity', align: 'right', render: (b) => formatNumber(b.quantity) },
                { key: 'sellingPrice', label: 'Selling price', align: 'right', render: (b) => formatMoney(b.sellingPrice) },
              ]} />
            </Panel>
          )}

          {can('INVENTORY_ADD_STOCK') ? (
            <Panel title="Add a batch">
              <div className="stack">
                <BatchFields form={batch} setForm={setBatch} errors={batchAction.fieldErrors} showBranch
                  branchOptions={activeBranches.map((b) => ({ value: b.id, label: b.name }))} />
                {batchAction.error && ['BATCH_COST_CONFLICT', 'BATCH_DATA_CONFLICT'].includes(batchAction.error.code) && (
                  <InlineAlert tone="danger">{batchAction.error.message}</InlineAlert>
                )}
                <div className="form-actions">
                  <Button variant="secondary" icon={Plus} onClick={addBatch} loading={batchAction.running}>Add batch</Button>
                </div>
              </div>
            </Panel>
          ) : (
            <InlineAlert tone="info">You do not have permission to add stock. The medicine can still be activated and stocked through purchasing.</InlineAlert>
          )}

          <div className="form-actions">
            <Button variant="secondary" onClick={() => navigate(`/medicines/${medicine.id}`)}>Keep as draft</Button>
            <Button icon={CheckCircle2} onClick={finish} loading={finishAction.running}>Finish and activate</Button>
          </div>
        </>
      )}
    </div>
  );
}
