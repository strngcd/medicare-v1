import { useEffect } from 'react';
import { Cross } from 'lucide-react';

const DEFAULT_FAVICON = '/favicon.svg';

/** The pharmacy's uploaded logo, or the default Medicar mark when none is set. */
export function BrandMark({ logoUrl }) {
  if (logoUrl) return <img className="brand-logo" src={logoUrl} alt="" />;
  return <span className="brand-mark"><Cross aria-hidden="true" /></span>;
}

/** Uses the uploaded logo as the browser tab icon, falling back to the default. */
export function useBrandFavicon(logoUrl) {
  useEffect(() => {
    const link = document.querySelector("link[rel='icon']");
    if (!link) return;
    link.type = logoUrl ? '' : 'image/svg+xml';
    link.href = logoUrl || DEFAULT_FAVICON;
  }, [logoUrl]);
}
