const fs = require('fs');
const path = require('path');
const { seedKey } = require('./categories');

/**
 * Default medicine catalog (seeds/data/medicine-catalog.csv, 499 medicines).
 *
 * Source: the pharmacy's 500-row catalog list, minus one exact duplicate
 * (MED0172 = MED0489, Dextrose 10% 500 mL), with its specific therapeutic
 * classes grouped into the broad starter categories (seeds/categories.js).
 * `prescription_required` was added by
 * standard classification: oral/topical OTC products (simple analgesics,
 * antacids, laxatives, ORS, common dewormers, antihistamines, cough and cold,
 * antiseptics, emollients, topical antifungals, vitamins, minerals and iron,
 * emergency contraception) are not prescription-only; everything else and
 * every injectable form is. "Various" manufacturer/country is stored as empty.
 *
 * Medicines are created ACTIVE without stock, each keyed by its catalog_id
 * (medicines.catalog_key). Re-running the seed skips every keyed medicine, even
 * one staff have since edited, so it never re-adds or overwrites anything.
 */
const CATALOG_FILE = path.join(__dirname, 'data', 'medicine-catalog.csv');

/** Minimal RFC 4180 parser: commas, quoted fields and doubled quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);
  const [header, ...data] = rows;
  return data.map((values) => Object.fromEntries(header.map((key, i) => [key.trim(), (values[i] || '').trim()])));
}

function loadCatalog() {
  return parseCsv(fs.readFileSync(CATALOG_FILE, 'utf8').replace(/^﻿/, ''));
}

const orNull = (value) => (value && value.toLowerCase() !== 'various' ? value : null);

async function seedMedicineCatalog(client) {
  const catalog = loadCatalog();
  // Catalog categories are starter categories (seeds/categories.js), found by their permanent key.
  const categoryIds = new Map();
  for (const name of new Set(catalog.map((r) => r.category).filter(Boolean))) {
    const { rows } = await client.query('SELECT id FROM medicine_categories WHERE seed_key = $1', [seedKey(name)]);
    categoryIds.set(name, rows[0] ? rows[0].id : null);
  }

  let created = 0;
  let adopted = 0;
  for (const r of catalog) {
    // Already seeded (possibly edited by staff since): never touch or re-add it.
    const known = await client.query('SELECT 1 FROM medicines WHERE catalog_key = $1', [r.catalog_id]);
    if (known.rowCount) continue;

    const values = [
      r.name, orNull(r.generic_name), orNull(r.brand_name), orNull(r.strength), orNull(r.dosage_form), r.package_size,
      categoryIds.get(r.category) || null, orNull(r.manufacturer), orNull(r.country_of_origin), r.prescription_required === 'true',
      r.catalog_id,
    ];
    // Seeded before catalog keys existed (or added by hand with identical details): adopt it.
    const adoption = await client.query(
      `UPDATE medicines SET catalog_key = $5
        WHERE id = (SELECT id FROM medicines
                     WHERE catalog_key IS NULL AND product_type = 'MEDICINE'
                       AND lower(name) = lower($1)
                       AND lower(coalesce(strength, '')) = lower(coalesce($2, ''))
                       AND lower(coalesce(dosage_form, '')) = lower(coalesce($3, ''))
                       AND lower(package_size) = lower($4)
                     ORDER BY created_at LIMIT 1)`,
      [r.name, orNull(r.strength), orNull(r.dosage_form), r.package_size, r.catalog_id],
    );
    if (adoption.rowCount) {
      adopted += 1;
      continue;
    }
    await client.query(
      `INSERT INTO medicines (product_type, name, generic_name, brand_name, strength, dosage_form, package_size,
         category_id, manufacturer, country_of_origin, prescription_required, status, catalog_key)
       VALUES ('MEDICINE', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ACTIVE', $11)`,
      values,
    );
    created += 1;
  }
  return { total: catalog.length, created, adopted };
}

module.exports = { seedMedicineCatalog, loadCatalog, parseCsv };
