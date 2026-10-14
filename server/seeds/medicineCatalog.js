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

function loadCatalog(file = CATALOG_FILE) {
  return parseCsv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

const orNull = (value) => (value && value.toLowerCase() !== 'various' ? value : null);

/**
 * Inserts catalog products once, keyed by catalog_key. Already-keyed products
 * are skipped (even if staff edited them); an unkeyed product with the same
 * name, strength, form and size (e.g. from a seed before keys existed) is
 * adopted instead of duplicated.
 */
async function seedProducts(client, productType, products) {
  // Catalog categories are starter categories (seeds/categories.js), found by their permanent key.
  const categoryIds = new Map();
  for (const name of new Set(products.map((p) => p.category).filter(Boolean))) {
    const { rows } = await client.query('SELECT id FROM medicine_categories WHERE seed_key = $1', [seedKey(name)]);
    categoryIds.set(name, rows[0] ? rows[0].id : null);
  }

  let created = 0;
  let adopted = 0;
  for (const p of products) {
    const known = await client.query('SELECT 1 FROM medicines WHERE catalog_key = $1', [p.catalogKey]);
    if (known.rowCount) continue;

    const adoption = await client.query(
      `UPDATE medicines SET catalog_key = $5
        WHERE id = (SELECT id FROM medicines
                     WHERE catalog_key IS NULL AND product_type = $6
                       AND lower(name) = lower($1)
                       AND lower(coalesce(strength, '')) = lower(coalesce($2, ''))
                       AND lower(coalesce(dosage_form, '')) = lower(coalesce($3, ''))
                       AND lower(package_size) = lower($4)
                     ORDER BY created_at LIMIT 1)`,
      [p.name, p.strength, p.dosageForm, p.packageSize, p.catalogKey, productType],
    );
    if (adoption.rowCount) {
      adopted += 1;
      continue;
    }
    await client.query(
      `INSERT INTO medicines (product_type, name, generic_name, brand_name, strength, dosage_form, package_size,
         category_id, manufacturer, country_of_origin, prescription_required, status, catalog_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'ACTIVE', $12)`,
      [
        productType, p.name, p.genericName, p.brandName, p.strength, p.dosageForm, p.packageSize,
        categoryIds.get(p.category) || null, p.manufacturer, p.countryOfOrigin, p.prescriptionRequired, p.catalogKey,
      ],
    );
    created += 1;
  }
  return { total: products.length, created, adopted };
}

async function seedMedicineCatalog(client) {
  const products = loadCatalog().map((r) => ({
    catalogKey: r.catalog_id,
    name: r.name,
    genericName: orNull(r.generic_name),
    brandName: orNull(r.brand_name),
    strength: orNull(r.strength),
    dosageForm: orNull(r.dosage_form),
    packageSize: r.package_size,
    category: r.category,
    manufacturer: orNull(r.manufacturer),
    countryOfOrigin: orNull(r.country_of_origin),
    prescriptionRequired: r.prescription_required === 'true',
  }));
  return seedProducts(client, 'MEDICINE', products);
}

/**
 * Default cosmetic catalog (seeds/data/cosmetic-catalog.csv, 95 products,
 * keys COS0001...). Source: the pharmacy's cosmetics list, with its detailed
 * categories grouped into the broad cosmetic starter categories. Cosmetics
 * never require a prescription; expiry is entered per batch when stock arrives.
 */
const COSMETIC_FILE = path.join(__dirname, 'data', 'cosmetic-catalog.csv');

async function seedCosmeticCatalog(client) {
  const products = loadCatalog(COSMETIC_FILE).map((r) => ({
    catalogKey: r.catalog_id,
    name: r.name,
    genericName: null,
    brandName: orNull(r.brand_name),
    strength: null,
    dosageForm: orNull(r.form),
    packageSize: r.size,
    category: r.category,
    manufacturer: orNull(r.manufacturer),
    countryOfOrigin: orNull(r.country_of_origin),
    prescriptionRequired: false,
  }));
  return seedProducts(client, 'COSMETIC', products);
}

module.exports = { seedMedicineCatalog, seedCosmeticCatalog, loadCatalog, parseCsv, COSMETIC_FILE };
