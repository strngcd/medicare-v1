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

/** Inserts the starter categories. Existing categories (by name) are left as they are. */
async function seedCategories(client) {
  for (const [name, description] of CATEGORIES) {
    await client.query(
      `INSERT INTO medicine_categories (name, description)
       VALUES ($1, $2)
       ON CONFLICT ((lower(name))) DO NOTHING`,
      [name, description],
    );
  }
}

module.exports = { seedCategories, CATEGORIES };
