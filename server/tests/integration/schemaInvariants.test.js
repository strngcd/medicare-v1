const { resetDatabase, pool } = require('../helpers/db');

/**
 * These tests prove that the most important invariants are enforced by
 * PostgreSQL itself, independent of application code.
 */

let ids;

async function insertFixtures() {
  const role = await pool.query("SELECT id FROM roles WHERE code = 'PHARMACIST'");
  const branch = await pool.query(
    "INSERT INTO branches (name, code) VALUES ('Main', 'MAIN') RETURNING id",
  );
  const user = await pool.query(
    "INSERT INTO users (full_name, email, role_id) VALUES ('Test User', 'test@example.com', $1) RETURNING id",
    [role.rows[0].id],
  );
  const medicine = await pool.query(
    "INSERT INTO medicines (name, package_size, prescription_required) VALUES ('Paracetamol', '10 tablets', false) RETURNING id",
  );
  const batch = await pool.query(
    "INSERT INTO batches (medicine_id, batch_number, expiry_date, purchase_price) VALUES ($1, 'B1', '2030-01-01', 5.00) RETURNING id",
    [medicine.rows[0].id],
  );
  const inventory = await pool.query(
    'INSERT INTO branch_inventory (branch_id, batch_id, quantity, selling_price) VALUES ($1, $2, 10, 8.00) RETURNING id',
    [branch.rows[0].id, batch.rows[0].id],
  );
  return {
    branchId: branch.rows[0].id,
    userId: user.rows[0].id,
    medicineId: medicine.rows[0].id,
    batchId: batch.rows[0].id,
    inventoryId: inventory.rows[0].id,
  };
}

beforeAll(async () => {
  await resetDatabase();
  ids = await insertFixtures();
});

afterAll(() => pool.end());

describe('database invariants', () => {
  test('branch inventory can never go negative', async () => {
    await expect(
      pool.query('UPDATE branch_inventory SET quantity = -1 WHERE id = $1', [ids.inventoryId]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  test('stock movements are append-only', async () => {
    const { rows } = await pool.query(
      `INSERT INTO stock_movements (branch_id, batch_id, movement_type, quantity_change,
         quantity_before, quantity_after, reference_type, reference_id, created_by)
       VALUES ($1, $2, 'ADJUSTMENT', 5, 10, 15, 'STOCK_ADDITION', $3, $4) RETURNING id`,
      [ids.branchId, ids.batchId, ids.inventoryId, ids.userId],
    );
    await expect(
      pool.query('UPDATE stock_movements SET reason = $1 WHERE id = $2', ['x', rows[0].id]),
    ).rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM stock_movements WHERE id = $1', [rows[0].id])).rejects.toThrow(/append-only/);
  });

  test('stock movement arithmetic must be consistent', async () => {
    await expect(
      pool.query(
        `INSERT INTO stock_movements (branch_id, batch_id, movement_type, quantity_change,
           quantity_before, quantity_after, reference_type, reference_id, created_by)
         VALUES ($1, $2, 'ADJUSTMENT', 5, 10, 99, 'STOCK_ADDITION', $3, $4)`,
        [ids.branchId, ids.batchId, ids.inventoryId, ids.userId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  test('batch purchase price is immutable', async () => {
    await expect(
      pool.query('UPDATE batches SET purchase_price = 99 WHERE id = $1', [ids.batchId]),
    ).rejects.toThrow(/immutable/);
  });

  test('branch code is immutable and branches cannot be deleted', async () => {
    await expect(pool.query("UPDATE branches SET code = 'OTHER' WHERE id = $1", [ids.branchId])).rejects.toThrow(/immutable/);
    await expect(pool.query('DELETE FROM branches WHERE id = $1', [ids.branchId])).rejects.toThrow(/not allowed/);
  });

  test('email uniqueness is case-insensitive', async () => {
    const role = await pool.query("SELECT id FROM roles WHERE code = 'CASHIER'");
    await expect(
      pool.query(
        "INSERT INTO users (full_name, email, role_id) VALUES ('Dup', 'test@example.com', $1)",
        [role.rows[0].id],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      pool.query(
        "INSERT INTO users (full_name, email, role_id) VALUES ('Upper', 'TEST@EXAMPLE.COM', $1)",
        [role.rows[0].id],
      ),
    ).rejects.toMatchObject({ code: '23514' }); // emails must be stored normalized
  });

  test('barcode is unique when present but optional', async () => {
    await pool.query("UPDATE medicines SET barcode = '123456' WHERE id = $1", [ids.medicineId]);
    await expect(
      pool.query(
        "INSERT INTO medicines (name, package_size, prescription_required, barcode) VALUES ('Other', '1', false, '123456')",
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await pool.query("INSERT INTO medicines (name, package_size, prescription_required) VALUES ('NoCode A', '1', false)");
    await pool.query("INSERT INTO medicines (name, package_size, prescription_required) VALUES ('NoCode B', '1', false)");
  });

  test('purchase items cannot be over-received', async () => {
    const supplier = await pool.query(
      "INSERT INTO suppliers (company_name, phone) VALUES ('Acme', '0911000000') RETURNING id",
    );
    const purchase = await pool.query(
      `INSERT INTO purchases (purchase_number, supplier_id, branch_id, purchase_date, created_by)
       VALUES ('PUR-2026-000001', $1, $2, '2026-01-01', $3) RETURNING id`,
      [supplier.rows[0].id, ids.branchId, ids.userId],
    );
    const item = await pool.query(
      `INSERT INTO purchase_items (purchase_id, medicine_id, ordered_quantity, unit_purchase_price, line_total)
       VALUES ($1, $2, 10, 5.00, 50.00) RETURNING id`,
      [purchase.rows[0].id, ids.medicineId],
    );
    await expect(
      pool.query('UPDATE purchase_items SET received_quantity = 11 WHERE id = $1', [item.rows[0].id]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  test('document sequence types are restricted to the approved list', async () => {
    await expect(
      pool.query("INSERT INTO document_sequences (sequence_type, year, last_value) VALUES ('RECEIVING', 2026, 0)"),
    ).rejects.toMatchObject({ code: '23514' });
  });

  test('audit logs are append-only', async () => {
    const { rows } = await pool.query(
      "INSERT INTO audit_logs (action, entity_type, description) VALUES ('TEST', 'TEST', 'test') RETURNING id",
    );
    await expect(pool.query('DELETE FROM audit_logs WHERE id = $1', [rows[0].id])).rejects.toThrow(/append-only/);
  });
});
