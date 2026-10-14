const { resetDatabase, pool } = require('../helpers/db');
const { createBranch, createUser, createMedicine } = require('../helpers/factories');
const { loginAs } = require('../helpers/session');
const { daysFromToday } = require('../helpers/dates');

let branch;
let pharmacist;
let admin;
let cashier;
let skinCare;
let analgesics;

beforeEach(async () => {
  await resetDatabase();
  branch = await createBranch({ name: 'Bole', code: 'BOLE' });
  pharmacist = await loginAs(await createUser({ role: 'PHARMACIST', branches: [branch] }));
  admin = await loginAs(await createUser({ role: 'ADMIN', branches: [branch] }));
  cashier = await loginAs(await createUser({ role: 'CASHIER', branches: [branch] }));
  const { rows } = await pool.query("SELECT id, name, product_type FROM medicine_categories WHERE name IN ('Skin Care', 'Analgesics')");
  skinCare = rows.find((r) => r.name === 'Skin Care');
  analgesics = rows.find((r) => r.name === 'Analgesics');
});

afterAll(() => pool.end());

async function createCosmetic(overrides = {}) {
  const res = await pharmacist.post('/api/v1/medicines').send({
    productType: 'COSMETIC', name: 'Hydrating Cleanser', brandName: 'CeraVe', packageSize: '236 mL', categoryId: skinCare.id, ...overrides,
  });
  expect(res.status).toBe(201);
  const { medicine } = res.body.data;
  await pharmacist.patch(`/api/v1/medicines/${medicine.id}`).send({ status: 'ACTIVE' }).expect(200);
  return medicine;
}

function addStock(medicineId, overrides = {}) {
  return pharmacist.post('/api/v1/inventory/stock').send({
    branchId: branch.id, medicineId, purchasePrice: '100', sellingPrice: '150', quantity: 5, ...overrides,
  });
}

describe('cosmetic catalog', () => {
  test('seeded cosmetic categories exist and categories filter by type', async () => {
    expect(skinCare.product_type).toBe('COSMETIC');
    const res = await admin.get('/api/v1/medicine-categories?productType=COSMETIC&limit=100');
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((c) => c.productType === 'COSMETIC')).toBe(true);
  });

  test('creates a cosmetic without a prescription flag; lists separately from medicines', async () => {
    const cosmetic = await createCosmetic();
    expect(cosmetic).toMatchObject({ productType: 'COSMETIC', prescriptionRequired: false, brandName: 'CeraVe' });
    await createMedicine({ name: 'Paracetamol' });

    const cosmetics = await pharmacist.get('/api/v1/medicines?productType=COSMETIC');
    expect(cosmetics.body.data.map((m) => m.name)).toEqual(['Hydrating Cleanser']);
    const medicines = await pharmacist.get('/api/v1/medicines?productType=MEDICINE');
    expect(medicines.body.data.map((m) => m.name)).toEqual(['Paracetamol']);
  });

  test('cosmetics never require a prescription and only take cosmetic categories', async () => {
    const rx = await pharmacist.post('/api/v1/medicines').send({ productType: 'COSMETIC', name: 'X', packageSize: '1', prescriptionRequired: true });
    expect(rx.status).toBe(422);

    const wrongCategory = await pharmacist.post('/api/v1/medicines').send({ productType: 'COSMETIC', name: 'X', packageSize: '1', categoryId: analgesics.id });
    expect(wrongCategory.status).toBe(422);
    expect(wrongCategory.body.error.details.fields.categoryId).toBeDefined();

    const medInCosmeticCategory = await pharmacist.post('/api/v1/medicines').send({ name: 'Y', packageSize: '1', prescriptionRequired: false, categoryId: skinCare.id });
    expect(medInCosmeticCategory.status).toBe(422);

    const cosmetic = await createCosmetic();
    expect((await pharmacist.patch(`/api/v1/medicines/${cosmetic.id}`).send({ prescriptionRequired: true })).status).toBe(422);
  });

  test('medicines still require the prescription flag', async () => {
    const res = await pharmacist.post('/api/v1/medicines').send({ name: 'X', packageSize: '1' });
    expect(res.status).toBe(422);
    expect(res.body.error.details.fields.prescriptionRequired).toBeDefined();
  });

  test('product type cannot be changed', async () => {
    const cosmetic = await createCosmetic();
    expect((await pharmacist.patch(`/api/v1/medicines/${cosmetic.id}`).send({ productType: 'MEDICINE' })).status).toBe(422);
    await expect(pool.query("UPDATE medicines SET product_type = 'MEDICINE' WHERE id = $1", [cosmetic.id])).rejects.toThrow(/immutable/);
  });
});

describe('cosmetic stock', () => {
  test('may be added without batch number or expiry; never expires and is sellable', async () => {
    const cosmetic = await createCosmetic();
    const res = await addStock(cosmetic.id);
    expect(res.status).toBe(201);
    const inventory = await pharmacist.get(`/api/v1/inventory?productType=COSMETIC&branchId=${branch.id}`);
    expect(inventory.body.data).toHaveLength(1);
    expect(inventory.body.data[0]).toMatchObject({ expiryDate: '9999-12-31', productType: 'COSMETIC' });
    expect(['AVAILABLE', 'LOW_STOCK']).toContain(inventory.body.data[0].status);
    expect(inventory.body.data[0].batchNumber).toMatch(/^LOT-[2-9A-Z]{6}$/);

    // A second undated delivery gets its own generated lot.
    await addStock(cosmetic.id).expect(201);
    const lots = await pool.query('SELECT DISTINCT batch_number FROM batches WHERE medicine_id = $1', [cosmetic.id]);
    expect(lots.rows).toHaveLength(2);

    const alerts = await admin.get('/api/v1/alerts?type=EXPIRING_SOON');
    expect(JSON.stringify(alerts.body.data || [])).not.toContain('Hydrating Cleanser');
  });

  test('medicines still need a batch number and expiry date', async () => {
    const med = await createMedicine();
    const res = await addStock(med.id);
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.details.fields)).toEqual(expect.arrayContaining(['expiryDate']));
    const noBatch = await addStock(med.id, { expiryDate: '2030-01-01' });
    expect(noBatch.body.error.details.fields.batchNumber).toBeDefined();
  });

  test('the database refuses the no-expiry date for medicines', async () => {
    const med = await createMedicine();
    await expect(pool.query(
      "INSERT INTO batches (medicine_id, batch_number, expiry_date, purchase_price) VALUES ($1, 'X', '9999-12-31', 1)",
      [med.id],
    )).rejects.toThrow(/expiry date/);
  });

  test('sells dated stock before undated stock (FEFO)', async () => {
    const cosmetic = await createCosmetic();
    await addStock(cosmetic.id, { quantity: 3 }).expect(201);
    await addStock(cosmetic.id, { quantity: 2, batchNumber: 'DATED', expiryDate: daysFromToday(200), purchasePrice: '90' }).expect(201);

    const preview = await cashier.post('/api/v1/inventory/fefo-preview').send({ branchId: branch.id, medicineId: cosmetic.id, quantity: 4 });
    expect(preview.status).toBe(200);
    expect(preview.body.data.allocation.map((a) => [a.batchNumber, a.quantity])).toEqual([['DATED', 2], [expect.stringMatching(/^LOT-/), 2]]);
  });

  test('receives through purchasing without batch number or expiry', async () => {
    const cosmetic = await createCosmetic();
    const supplier = (await admin.post('/api/v1/suppliers').send({ companyName: 'Beauty Imports', phone: '0911' })).body.data.supplier;
    const res = await pharmacist.post('/api/v1/purchases').send({
      supplierId: supplier.id,
      branchId: branch.id,
      items: [{ medicineId: cosmetic.id, orderedQuantity: 10, unitPurchasePrice: '80' }],
      receive: { items: [{ medicineId: cosmetic.id, batchNumber: null, expiryDate: null, quantity: 10, sellingPrice: '120' }] },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('RECEIVED');
    const { rows } = await pool.query('SELECT b.batch_number, b.expiry_date FROM batches b WHERE b.medicine_id = $1', [cosmetic.id]);
    expect(rows).toEqual([{ batch_number: expect.stringMatching(/^LOT-/), expiry_date: '9999-12-31' }]);
  });
});
