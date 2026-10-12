import { formatDateTime, formatMoney, humanize } from '../../utils/format.js';

/** Receipt rendered from historical sale data returned by GET /sales/:id/receipt. */
export function Receipt({ receipt }) {
  const r = receipt;
  const money = (v) => formatMoney(v, { withCurrency: false });
  return (
    <div className="receipt">
      <div className="center">
        {r.pharmacy.logoUrl && <img src={r.pharmacy.logoUrl} alt="" style={{ maxHeight: 48, maxWidth: 160 }} />}
        <div style={{ fontWeight: 700, fontSize: 14 }}>{r.pharmacy.name}</div>
        <div>{r.branch.name}</div>
        {r.branch.address && <div>{r.branch.address}</div>}
        {r.branch.phone && <div>Tel: {r.branch.phone}</div>}
      </div>
      <div className="rule" />
      <table>
        <tbody>
          <tr><td>Receipt</td><td className="r">{r.receiptNumber}</td></tr>
          <tr><td>Date</td><td className="r">{formatDateTime(r.completedAt)}</td></tr>
          {r.staff && <tr><td>Served by</td><td className="r">{r.staff}</td></tr>}
          {r.status === 'VOIDED' && <tr><td colSpan={2} className="center" style={{ fontWeight: 700 }}>*** VOIDED ***</td></tr>}
        </tbody>
      </table>
      <div className="rule" />
      <table>
        <tbody>
          {r.items.map((item, i) => (
            <tr key={i}>
              <td>{item.medicineName}<br />{item.quantity} x {money(item.unitSellingPrice)}</td>
              <td className="r">{money(item.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="rule" />
      <table>
        <tbody>
          <tr><td>Subtotal</td><td className="r">{money(r.subtotal)}</td></tr>
          {r.discount !== null && Number(r.discount) > 0 && <tr><td>Discount</td><td className="r">-{money(r.discount)}</td></tr>}
          {r.tax !== null && Number(r.tax) > 0 && (
            <tr><td>{r.taxName || 'Tax'} {Number(r.taxRate)}%{r.taxMode === 'INCLUDED' ? ' (incl.)' : ''}</td><td className="r">{money(r.tax)}</td></tr>
          )}
          <tr style={{ fontWeight: 700, fontSize: 13 }}><td>TOTAL {r.pharmacy.currencyCode}</td><td className="r">{money(r.total)}</td></tr>
          <tr><td>Paid by</td><td className="r">{humanize(r.paymentMethod)}</td></tr>
        </tbody>
      </table>
      <div className="rule" />
      <div className="center">{r.footer || 'Thank you.'}</div>
    </div>
  );
}

export function printReceipt() {
  document.body.classList.add('printing-receipt');
  const cleanup = () => {
    document.body.classList.remove('printing-receipt');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
}
