/**
 * DEMO DATA for development and evaluation only. Refuses to run in production.
 *
 *   npm run seed:demo
 *
 * Creates demo branches, staff, medicines, suppliers, purchases (received),
 * sales, a refund, a void and a transfer by calling the real services, so
 * every record follows the same business rules, ledger and audit trail as
 * normal use. All demo staff use the password printed at the end.
 * Requires an Owner account (npm run create-owner) and no stock yet. The demo
 * adds its own ten medicines next to the default catalog from npm run seed.
 */
const config = require('../src/config');
const { pool, query } = require('../src/database/db');
const { loadAuthContext } = require('../src/auth/authContext');
const { hashPassword } = require('../src/auth/password');
const branches = require('../src/modules/branches/branches.service');
const users = require('../src/modules/users/users.service');
const medicines = require('../src/modules/medicines/medicines.service');
const suppliers = require('../src/modules/suppliers/suppliers.service');
const purchases = require('../src/modules/purchases/purchases.service');
const payments = require('../src/modules/supplierPayments/supplierPayments.service');
const sales = require('../src/modules/sales/sales.service');
const refunds = require('../src/modules/refunds/refunds.service');
const transfers = require('../src/modules/transfers/transfers.service');
const { addDays, businessToday } = require('../src/utils/time');
const { money, toMoneyString } = require('../src/utils/money');

const DEMO_PASSWORD = 'Demo12345';

const MEDICINES = [
  ['Amoxicillin', '500 mg', 'Capsule', '20 capsules', true, 'Antibiotics', '45.00', '68.00'],
  ['Paracetamol', '500 mg', 'Tablet', '10 tablets', false, 'Analgesics', '8.00', '15.00'],
  ['Ibuprofen', '400 mg', 'Tablet', '20 tablets', false, 'Analgesics', '22.00', '38.00'],
  ['Metformin', '500 mg', 'Tablet', '30 tablets', true, 'Antidiabetics', '60.00', '95.00'],
  ['Amlodipine', '5 mg', 'Tablet', '30 tablets', true, 'Antihypertensives', '55.00', '88.00'],
  ['Cetirizine', '10 mg', 'Tablet', '10 tablets', false, 'Antihistamines', '12.00', '25.00'],
  ['Omeprazole', '20 mg', 'Capsule', '14 capsules', false, 'Gastrointestinal', '30.00', '52.00'],
  ['Salbutamol Inhaler', '100 mcg', 'Inhaler', '200 doses', true, 'Respiratory', '120.00', '185.00'],
  ['Vitamin C', '1000 mg', 'Tablet', '20 effervescent', false, 'Vitamins and Supplements', '40.00', '65.00'],
  ['Artemether/Lumefantrine', '20/120 mg', 'Tablet', '24 tablets', true, 'Antimalarials', '85.00', '130.00'],
];

function actorFor(auth) {
  return { userId: auth.userId, roleCode: auth.roleCode, ipAddress: '127.0.0.1', userAgent: 'seed-demo' };
}

async function main() {
  if (config.isProduction) throw new Error('Refusing to create demo data in production.');

  const owner = await query("SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'OWNER' AND u.status = 'ACTIVE' LIMIT 1");
  if (!owner.rows[0]) throw new Error('Create an Owner first: npm run create-owner');
  const existing = await query('SELECT count(*)::int AS n FROM batches');
  if (existing.rows[0].n > 0) throw new Error('Demo data needs an empty inventory (stock already exists).');

  let ownerAuth = await loadAuthContext(owner.rows[0].id);
  const ownerActor = actorFor(ownerAuth);

  // Branches (reuse any existing ones, add two demo branches).
  const bole = (await query("SELECT id FROM branches WHERE code = 'BOLE'")).rows[0]
    || (await branches.createBranch(ownerAuth, ownerActor, { name: 'Bole Main', code: 'BOLE', city: 'Addis Ababa', phone: '+251 11 000 0001' }));
  const piassa = await branches.createBranch(ownerAuth, ownerActor, { name: 'Piassa', code: 'PIASSA', city: 'Addis Ababa', phone: '+251 11 000 0002' });
  const boleId = bole.id;

  // Staff with a known demo password (set directly, never logged by the app).
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const staff = {};
  for (const [key, fullName, email, roleCode, branchIds] of [
    ['admin', 'Abebe Admin', 'admin@medicar.local', 'ADMIN', [boleId, piassa.id]],
    ['pharmacist', 'Hana Pharmacist', 'pharmacist@medicar.local', 'PHARMACIST', [boleId]],
    ['cashier', 'Selam Cashier', 'cashier@medicar.local', 'CASHIER', [boleId]],
    ['piassaCashier', 'Dawit Cashier', 'cashier.piassa@medicar.local', 'CASHIER', [piassa.id]],
  ]) {
    const created = await users.createUser(ownerAuth, ownerActor, { fullName, email, roleCode, branchIds, employeeId: `DEMO-${key.toUpperCase()}` });
    await query('UPDATE users SET password_hash = $2 WHERE id = $1', [created.user.id, passwordHash]);
    await query("UPDATE password_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [created.user.id]);
    staff[key] = created.user;
  }
  ownerAuth = await loadAuthContext(owner.rows[0].id);

  // Suppliers and medicines.
  const supplierA = (await suppliers.createSupplier(ownerAuth, ownerActor, { companyName: 'Ethio Pharma Distributors', phone: '+251 11 555 0101', contactPerson: 'Tigist' })).supplier;
  const supplierB = (await suppliers.createSupplier(ownerAuth, ownerActor, { companyName: 'Addis Medical Supplies', phone: '+251 11 555 0202' })).supplier;
  const categories = Object.fromEntries((await query('SELECT id, name FROM medicine_categories')).rows.map((r) => [r.name, r.id]));
  const meds = [];
  for (const [name, strength, dosageForm, packageSize, prescriptionRequired, category, cost, price] of MEDICINES) {
    const { medicine } = await medicines.createMedicine(ownerAuth, ownerActor, {
      name, strength, dosageForm, packageSize, prescriptionRequired, categoryId: categories[category],
      barcode: `629${String(meds.length + 1).padStart(10, '0')}`,
    });
    await medicines.updateMedicine(ownerAuth, ownerActor, medicine.id, { status: 'ACTIVE' });
    meds.push({ ...medicine, cost, price });
  }

  // Purchase and receive stock into Bole (two batches each, different expiry).
  const today = businessToday();
  const order = await purchases.createPurchase(ownerAuth, ownerActor, {
    supplierId: supplierA.id, branchId: boleId, status: 'PENDING',
    items: meds.map((m) => ({ medicineId: m.id, orderedQuantity: 120, unitPurchasePrice: m.cost })),
  });
  const items = order.items;
  await purchases.receivePurchase(ownerAuth, ownerActor, order.id, {
    notes: 'Demo delivery',
    items: items.flatMap((item, i) => {
      const med = meds.find((m) => m.id === item.medicineId);
      const lowStock = i === 3; // Metformin ends up low
      return [
        { purchaseItemId: item.id, batchNumber: `${med.name.slice(0, 3).toUpperCase()}-A1`, expiryDate: addDays(today, i === 5 ? 20 : 120), quantity: lowStock ? 8 : 60, sellingPrice: med.price },
        { purchaseItemId: item.id, batchNumber: `${med.name.slice(0, 3).toUpperCase()}-B1`, expiryDate: addDays(today, 400), quantity: lowStock ? 0 : 60, sellingPrice: med.price },
      ].filter((line) => line.quantity > 0);
    }),
  });
  await payments.createPayment(ownerAuth, ownerActor, { purchaseId: order.id, amount: '3000.00', paymentMethod: 'BANK_TRANSFER', referenceNumber: 'DEMO-TRX-1' });

  // A second, still-pending order from another supplier.
  await purchases.createPurchase(ownerAuth, ownerActor, {
    supplierId: supplierB.id, branchId: piassa.id, status: 'PENDING',
    items: meds.slice(0, 4).map((m) => ({ medicineId: m.id, orderedQuantity: 50, unitPurchasePrice: m.cost })),
  });

  // Sales by the cashier, one refund and one void.
  const cashierAuth = await loadAuthContext(staff.cashier.id);
  const cashierActor = actorFor(cashierAuth);
  const sold = [];
  for (const [index, qty] of [[1, 3], [2, 2], [0, 1], [6, 2], [8, 4], [1, 5], [5, 2]].entries()) {
    const [medIndex, quantity] = qty;
    const priced = toMoneyString(money(meds[medIndex].price).times(quantity));
    const sale = await sales.createSale(cashierAuth, cashierActor, {
      branchId: boleId,
      items: [{ medicineId: meds[medIndex].id, quantity }],
      paymentMethod: index % 2 ? 'BANK_TRANSFER' : 'CASH',
      amountPaid: priced,
    });
    sold.push(sale.body);
  }
  await refunds.createRefund(cashierAuth, cashierActor, {
    saleId: sold[0].id, reason: 'CUSTOMER_RETURN', items: [{ saleItemId: sold[0].items[0].id, quantity: 1 }],
  });
  const adminAuth = await loadAuthContext(staff.admin.id);
  await sales.voidSale(adminAuth, actorFor(adminAuth), sold[1].id, 'Demo: entered twice');

  // Expired stock to show expiry alerts (inserted via the ledger rules: batch + movement).
  await medicines.updateMedicine(ownerAuth, ownerActor, meds[9].id, { description: 'Demo medicine with an expired batch' });
  const expiredBatch = await query(
    `INSERT INTO batches (medicine_id, batch_number, expiry_date, purchase_price, supplier_id)
     VALUES ($1, 'ART-OLD', $2, $3, $4) RETURNING id`,
    [meds[9].id, addDays(today, -10), meds[9].cost, supplierA.id],
  );
  const expiredInventory = await query(
    `INSERT INTO branch_inventory (branch_id, batch_id, quantity, minimum_stock, selling_price)
     VALUES ($1, $2, 6, 10, $3) RETURNING id`,
    [boleId, expiredBatch.rows[0].id, meds[9].price],
  );
  await query(
    `INSERT INTO stock_movements (branch_id, batch_id, movement_type, quantity_change, quantity_before, quantity_after,
       reference_type, reference_id, reason, created_by)
     VALUES ($1, $2, 'ADJUSTMENT', 6, 0, 6, 'STOCK_ADDITION', $3, 'Demo opening stock (already expired)', $4)`,
    [boleId, expiredBatch.rows[0].id, expiredInventory.rows[0].id, ownerAuth.userId],
  );

  // A transfer from Bole to Piassa, shipped and waiting to be received.
  const boleStock = await query(
    `SELECT b.id FROM batches b JOIN branch_inventory bi ON bi.batch_id = b.id
      WHERE bi.branch_id = $1 AND b.batch_number LIKE 'PAR-B1'`,
    [boleId],
  );
  const transfer = await transfers.createTransfer(adminAuth, actorFor(adminAuth), {
    sourceBranchId: boleId, destinationBranchId: piassa.id, items: [{ batchId: boleStock.rows[0].id, requestedQuantity: 20 }],
  });
  await transfers.requestTransfer(adminAuth, actorFor(adminAuth), transfer.id);
  await transfers.approveTransfer(adminAuth, actorFor(adminAuth), transfer.id, {});
  await transfers.shipTransfer(adminAuth, actorFor(adminAuth), transfer.id, {}, null);

  console.log('\nDemo data created.');
  console.log(`Demo staff (password "${DEMO_PASSWORD}"):`);
  console.log('  admin@medicar.local, pharmacist@medicar.local, cashier@medicar.local, cashier.piassa@medicar.local');
}

main()
  .catch((err) => {
    console.error('Demo seed failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
