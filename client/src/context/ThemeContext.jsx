import { useEffect } from 'react';
import { useAuth } from './AuthContext.jsx';

/** Applies the user's theme and density preferences to the document root. */
export function ThemeSync() {
  const { preferences } = useAuth();
  const theme = (preferences && preferences.theme) || 'SYSTEM';
  const density = (preferences && preferences.uiDensity) || 'COMFORTABLE';

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'DARK' || (theme === 'SYSTEM' && media.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.density = density === 'COMPACT' ? 'compact' : 'comfortable';
  }, [density]);

  return null;
}
