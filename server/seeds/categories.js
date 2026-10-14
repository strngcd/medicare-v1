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
];

/** Inserts the starter categories. Existing categories (by name) are left as they are. */
async function seedCategories(client) {
  const all = [
    ...CATEGORIES.map(([name, description]) => [name, description, 'MEDICINE']),
    ...COSMETIC_CATEGORIES.map(([name, description]) => [name, description, 'COSMETIC']),
  ];
  for (const [name, description, productType] of all) {
    await client.query(
      `INSERT INTO medicine_categories (name, description, product_type)
       VALUES ($1, $2, $3)
       ON CONFLICT ((lower(name))) DO NOTHING`,
      [name, description, productType],
    );
  }
}

module.exports = { seedCategories, CATEGORIES, COSMETIC_CATEGORIES };
