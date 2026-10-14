const fs = require('fs');
const path = require('path');

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
 * Medicines are created ACTIVE without stock. A medicine that already exists
 * (same name, strength, dosage form and package size) is left untouched, so
 * the seed is safe to run repeatedly. Missing categories are created.
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
  const categoryIds = new Map();
  for (const name of new Set(catalog.map((r) => r.category).filter(Boolean))) {
    await client.query(
      `INSERT INTO medicine_categories (name, product_type) VALUES ($1, 'MEDICINE')
       ON CONFLICT ((lower(name))) DO NOTHING`,
      [name],
    );
    const { rows } = await client.query('SELECT id FROM medicine_categories WHERE lower(name) = lower($1)', [name]);
    categoryIds.set(name, rows[0].id);
  }

  let created = 0;
  for (const r of catalog) {
    const { rowCount } = await client.query(
      `INSERT INTO medicines (product_type, name, generic_name, brand_name, strength, dosage_form, package_size,
         category_id, manufacturer, country_of_origin, prescription_required, status)
       SELECT 'MEDICINE', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ACTIVE'
        WHERE NOT EXISTS (
          SELECT 1 FROM medicines
           WHERE lower(name) = lower($1)
             AND lower(coalesce(strength, '')) = lower(coalesce($4, ''))
             AND lower(coalesce(dosage_form, '')) = lower(coalesce($5, ''))
             AND lower(package_size) = lower($6))`,
      [
        r.name, orNull(r.generic_name), orNull(r.brand_name), orNull(r.strength), orNull(r.dosage_form), r.package_size,
        categoryIds.get(r.category) || null, orNull(r.manufacturer), orNull(r.country_of_origin), r.prescription_required === 'true',
      ],
    );
    created += rowCount;
  }
  return { total: catalog.length, created };
}

module.exports = { seedMedicineCatalog, loadCatalog, parseCsv };
