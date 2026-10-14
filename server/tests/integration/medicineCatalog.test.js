const { resetDatabase, pool } = require('../helpers/db');
const { withTransaction } = require('../../src/database/db');
const { seedMedicineCatalog, parseCsv } = require('../../seeds/medicineCatalog');
const { seedAll } = require('../../scripts/seed');

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
  expect(first).toEqual({ total: 499, created: 499, adopted: 0 });

  const { rows } = await pool.query(
    `SELECT count(*)::int AS n, count(*) FILTER (WHERE status = 'ACTIVE')::int AS active,
            count(*) FILTER (WHERE category_id IS NULL)::int AS uncategorized,
            count(*) FILTER (WHERE product_type = 'MEDICINE')::int AS medicines
       FROM medicines`,
  );
  expect(rows[0]).toEqual({ n: 499, active: 499, uncategorized: 0, medicines: 499 });

  const again = await withTransaction((client) => seedMedicineCatalog(client));
  expect(again).toMatchObject({ created: 0, adopted: 0 });
});

test('re-seeding never re-adds medicines or categories that staff edited', async () => {
  await withTransaction((client) => seedAll(client));
  await pool.query("UPDATE medicines SET package_size = '100 tabs', name = 'Paracetamol (Panadol)' WHERE catalog_key = 'MED0001'");
  await pool.query("UPDATE medicine_categories SET name = 'Pain relief' WHERE seed_key = 'analgesics'");
  const counts = async () => (await pool.query(
    'SELECT (SELECT count(*) FROM medicines)::int AS medicines, (SELECT count(*) FROM medicine_categories)::int AS categories',
  )).rows[0];
  const before = await counts();

  await withTransaction((client) => seedAll(client));
  expect(await counts()).toEqual(before);
  const { rows } = await pool.query("SELECT name FROM medicine_categories WHERE lower(name) IN ('analgesics', 'pain relief')");
  expect(rows.map((r) => r.name)).toEqual(['Pain relief']);
});

test('adopts medicines seeded before catalog keys existed instead of duplicating them', async () => {
  await pool.query(
    `INSERT INTO medicines (name, strength, dosage_form, package_size, prescription_required, status)
     VALUES ('Paracetamol', '500 mg', 'Tablet', '100 tablets', false, 'ACTIVE')`,
  );
  const result = await withTransaction((client) => seedMedicineCatalog(client));
  expect(result).toMatchObject({ created: 498, adopted: 1 });
  const { rows } = await pool.query("SELECT catalog_key FROM medicines WHERE name = 'Paracetamol' AND strength = '500 mg' AND dosage_form = 'Tablet'");
  expect(rows).toEqual([{ catalog_key: 'MED0001' }]);
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
