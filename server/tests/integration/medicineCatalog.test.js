const { resetDatabase, pool } = require('../helpers/db');
const { withTransaction } = require('../../src/database/db');
const { seedMedicineCatalog, parseCsv } = require('../../seeds/medicineCatalog');

beforeEach(() => resetDatabase());
afterAll(() => pool.end());

async function rxOf(name, dosageForm) {
  const { rows } = await pool.query(
    'SELECT prescription_required FROM medicines WHERE name = $1 AND dosage_form = $2 LIMIT 1',
    [name, dosageForm],
  );
  return rows[0].prescription_required;
}

test('loads 499 active medicines into the starter categories, once', async () => {
  const before = (await pool.query('SELECT count(*)::int AS n FROM medicine_categories')).rows[0].n;
  const first = await withTransaction((client) => seedMedicineCatalog(client));
  // Every catalog category is one of the broad starter categories.
  expect((await pool.query('SELECT count(*)::int AS n FROM medicine_categories')).rows[0].n).toBe(before);
  expect(first).toEqual({ total: 499, created: 499 });

  const { rows } = await pool.query(
    `SELECT count(*)::int AS n, count(*) FILTER (WHERE status = 'ACTIVE')::int AS active,
            count(*) FILTER (WHERE category_id IS NULL)::int AS uncategorized,
            count(*) FILTER (WHERE product_type = 'MEDICINE')::int AS medicines
       FROM medicines`,
  );
  expect(rows[0]).toEqual({ n: 499, active: 499, uncategorized: 0, medicines: 499 });

  const again = await withTransaction((client) => seedMedicineCatalog(client));
  expect(again.created).toBe(0);
});

test('marks prescription-only medicines', async () => {
  await withTransaction((client) => seedMedicineCatalog(client));
  expect(await rxOf('Paracetamol', 'Tablet')).toBe(false);
  expect(await rxOf('Amoxicillin', 'Capsule')).toBe(true);
  expect(await rxOf('Ceftriaxone', 'Powder for injection')).toBe(true);
  expect(await rxOf('Diclofenac', 'Topical gel')).toBe(false);
  expect(await rxOf('Diclofenac', 'Tablet')).toBe(true);

  const { rows } = await pool.query("SELECT count(*)::int AS n FROM medicines WHERE manufacturer = 'Various' OR country_of_origin = 'Various'");
  expect(rows[0].n).toBe(0);
});

test('parses quoted CSV fields', () => {
  expect(parseCsv('a,b,c\n1,"20,000 IU","say ""hi"""\r\n')).toEqual([{ a: '1', b: '20,000 IU', c: 'say "hi"' }]);
});
