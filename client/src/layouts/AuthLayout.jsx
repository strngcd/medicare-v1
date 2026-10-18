import { useEffect, useState } from 'react';
import { ShieldCheck, Boxes, Receipt, BarChart3 } from 'lucide-react';
import { api } from '../api/client.js';
import { BrandMark, useBrandFavicon } from '../components/shell/BrandMark.jsx';

/** Pharmacy name and logo for the signed-out pages. */
function useBranding() {
  const [branding, setBranding] = useState({ pharmacyName: 'Medicar Pharmacy', logoUrl: null });
  useEffect(() => {
    api.get('/branding').then((r) => setBranding(r.data)).catch(() => {});
  }, []);
  return branding;
}

export function AuthLayout({ children }) {
  const branding = useBranding();
  useBrandFavicon(branding.logoUrl);
  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <div className="row" style={{ gap: 10, color: '#fff', fontWeight: 600 }}>
          <BrandMark logoUrl={branding.logoUrl} />
          {branding.pharmacyName}
        </div>
        <div>
          <h2>Operations for every branch, in one place.</h2>
          <ul>
            <li><Boxes aria-hidden="true" /> Batch-level stock with FEFO and expiry tracking</li>
            <li><Receipt aria-hidden="true" /> Fast point of sale, refunds and receipts</li>
            <li><BarChart3 aria-hidden="true" /> Sales, profit and inventory reports</li>
            <li><ShieldCheck aria-hidden="true" /> Role-based access and a full audit trail</li>
          </ul>
        </div>
        <p className="small" style={{ color: '#7f93ad' }}>Internal system. Authorized staff only.</p>
      </aside>
      <main className="auth-main">
        <div className="auth-card">{children}</div>
      </main>
    </div>
  );
}

export function AuthBrand({ title, subtitle }) {
  const branding = useBranding();
  return (
    <div className="stack-sm">
      <div className="brand-row">
        <BrandMark logoUrl={branding.logoUrl} />
        {branding.pharmacyName}
      </div>
      <h1 style={{ fontSize: 22 }}>{title}</h1>
      {subtitle && <p className="muted">{subtitle}</p>}
    </div>
  );
}
