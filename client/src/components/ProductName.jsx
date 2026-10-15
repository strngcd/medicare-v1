/**
 * Product name with its strength, plus dosage form and pack size underneath,
 * so products that share a name (e.g. Paracetamol 500 mg / 1 g) can be told apart.
 * Accepts rows that carry `medicineName` (stock, purchases, transfers) or `name`.
 */
export function productLabel(row) {
  return [row.medicineName ?? row.name, row.strength].filter(Boolean).join(' ');
}

export function productDetail(row) {
  return [row.productType === 'COSMETIC' && 'Cosmetic', row.brandName, row.dosageForm, row.packageSize].filter(Boolean).join(' · ');
}

export function ProductName({ row, as: Tag = 'span' }) {
  const detail = productDetail(row);
  return (
    <span className="stack-sm" style={{ gap: 1 }}>
      <Tag className="cell-strong">{productLabel(row)}</Tag>
      {detail && <span className="small muted">{detail}</span>}
    </span>
  );
}
