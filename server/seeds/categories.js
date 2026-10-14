const CATEGORIES = [
  ['Analgesics', 'Pain relief and fever reduction'],
  ['Antibiotics', 'Medicines that treat bacterial infections'],
  ['Antifungals', 'Medicines that treat fungal infections'],
  ['Antimalarials', 'Prevention and treatment of malaria'],
  ['Antihypertensives', 'Blood pressure management'],
  ['Antidiabetics', 'Blood glucose management'],
  ['Antihistamines', 'Allergy relief'],
  ['Gastrointestinal', 'Antacids, antiemetics, laxatives and related medicines'],
  ['Respiratory', 'Asthma, cough and cold medicines'],
  ['Cardiovascular', 'Heart and circulation medicines'],
  ['Dermatological', 'Skin preparations'],
  ['Vitamins and Supplements', 'Vitamins, minerals and nutritional supplements'],
  ['Ophthalmic and Otic', 'Eye and ear preparations'],
  ['Medical Supplies', 'Consumables and devices sold over the counter'],
  ['Antivirals and Antiparasitics', 'Antivirals, antiretrovirals, dewormers and antiprotozoals'],
  ['Central Nervous System', 'Antidepressants, antipsychotics, antiepileptics and other CNS medicines'],
  ['Hormones and Contraceptives', 'Contraceptives, hormone therapy, thyroid and corticosteroid medicines'],
  ['Oncology and Immunology', 'Cancer medicines, biologics and immunosuppressants'],
  ['Blood and Coagulation', 'Anticoagulants, antiplatelets, hemostatics and blood-cell stimulants'],
  ['IV Fluids and Electrolytes', 'Infusion fluids, electrolytes and diluents'],
  ['Emergency and Anesthetics', 'Emergency medicines and local anesthetics'],
  ['Urology', 'Prostate, erectile dysfunction and other urology medicines'],
  ['Antiseptics and Disinfectants', 'Skin and wound antiseptics and disinfectants'],
];

const COSMETIC_CATEGORIES = [
  ['Skin Care', 'Cleansers, moisturizers, serums and treatments'],
  ['Hair Care', 'Shampoos, conditioners, oils and styling'],
  ['Sun Care', 'Sunscreens and after-sun care'],
  ['Makeup', 'Face, eye and lip cosmetics'],
  ['Fragrance', 'Perfumes, colognes and body mists'],
  ['Personal Hygiene', 'Deodorants, soaps, oral and intimate care'],
  ['Baby Care', 'Baby lotions, oils, powders and wipes'],
  ['Body Care', 'Body lotions, creams, scrubs and oils'],
  ["Men's Grooming", 'Shaving, razors, men\'s skin care and body wash'],
];

/** Permanent key of a starter category: "Vitamins and Supplements" -> "vitamins-and-supplements". */
const seedKey = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Inserts the starter categories once. Each carries a permanent seed_key,
 * so a starter category that staff renamed or archived is recognised and
 * left alone instead of being created again. A same-named category made by
 * staff (from before seed keys existed) is adopted if it is the same type.
 */
async function seedCategories(client) {
  const all = [
    ...CATEGORIES.map(([name, description]) => [name, description, 'MEDICINE']),
    ...COSMETIC_CATEGORIES.map(([name, description]) => [name, description, 'COSMETIC']),
  ];
  for (const [name, description, productType] of all) {
    const key = seedKey(name);
    const known = await client.query('SELECT 1 FROM medicine_categories WHERE seed_key = $1', [key]);
    if (known.rowCount) continue;
    const adopted = await client.query(
      `UPDATE medicine_categories SET seed_key = $1
        WHERE lower(name) = lower($2) AND product_type = $3 AND seed_key IS NULL`,
      [key, name, productType],
    );
    if (adopted.rowCount) continue;
    await client.query(
      `INSERT INTO medicine_categories (name, description, product_type, seed_key)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ((lower(name))) DO NOTHING`,
      [name, description, productType, key],
    );
  }
}

module.exports = { seedCategories, seedKey, CATEGORIES, COSMETIC_CATEGORIES };
