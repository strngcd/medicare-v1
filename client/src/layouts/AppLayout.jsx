import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { HelpCircle, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Search, UserRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { NAVIGATION } from '../constants/navigation.js';
import { preloadRoutes } from '../routes.jsx';
import { api } from '../api/client.js';
import { useApi, usePolling } from '../hooks/useApi.js';
import { Dropdown, IconButton } from '../components/ui/index.js';
import { BranchSelector } from '../components/shell/BranchSelector.jsx';
import { GlobalSearch } from '../components/shell/GlobalSearch.jsx';
import { NotificationsMenu } from '../components/shell/NotificationsMenu.jsx';
import { BrandMark, useBrandFavicon } from '../components/shell/BrandMark.jsx';
import { initials } from '../utils/format.js';

const COLLAPSE_KEY = 'medicar.sidebarCollapsed';

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

export function AppLayout() {
  const { user, pharmacy, can, canAny, logout, branchParam } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileSearch, setMobileSearch] = useState(false);

  const alerts = useApi(
    () => (can('ALERT_VIEW') ? api.get('/alerts/count', { branchId: branchParam }).then((r) => r.data.total) : Promise.resolve(0)),
    [branchParam],
  );
  usePolling(() => alerts.reload({ silent: true }), 120000);

  useBrandFavicon(pharmacy && pharmacy.logoUrl);
  useEffect(() => {
    setMobileOpen(false);
    setMobileSearch(false);
  }, [location.pathname]);
  // Fetch page code in the background so later navigation is instant.
  useEffect(() => preloadRoutes(canAny), [user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        /* storage unavailable: preference simply not remembered */
      }
      return !c;
    });
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`} aria-label="Main navigation">
        <div className="sidebar-brand">
          <BrandMark logoUrl={pharmacy && pharmacy.logoUrl} />
          <span className="brand-name">{(pharmacy && pharmacy.name) || 'Medicar'}</span>
        </div>
        <nav className="sidebar-nav">
          {NAVIGATION.map((section) => {
            const items = section.items.filter((item) => canAny(...item.any));
            if (items.length === 0) return null;
            return (
              <div key={section.section}>
                <div className="nav-section">{section.section}</div>
                {items.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.end} className="nav-link" title={item.label}>
                    <item.icon aria-hidden="true" />
                    <span className="nav-label">{item.label}</span>
                    {item.badge === 'alerts' && alerts.data > 0 && <span className="nav-count">{alerts.data}</span>}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <NavLink to="/help" className="nav-link" title="Help center">
            <HelpCircle aria-hidden="true" />
            <span className="nav-label">Help center</span>
          </NavLink>
        </div>
      </aside>
      <div className={`mobile-overlay ${mobileOpen ? 'open' : ''}`} onClick={() => setMobileOpen(false)} />

      <div className="main">
        {/* On phones an open search takes over the whole bar (see .topbar.searching). */}
        <header className={`topbar no-print ${mobileSearch ? 'searching' : ''}`}>
          <IconButton className="menu-toggle" icon={Menu} label="Open navigation" onClick={() => setMobileOpen(true)} />
          <IconButton
            className="collapse-toggle"
            icon={collapsed ? PanelLeftOpen : PanelLeftClose}
            label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={toggleCollapsed}
          />
          <GlobalSearch mobileVisible={mobileSearch} onClose={() => setMobileSearch(false)} />
          <div className="topbar-actions">
            <IconButton className="mobile-search-toggle" icon={Search} label="Search" onClick={() => setMobileSearch(true)} />
            <BranchSelector />
            {can('NOTIFICATION_VIEW') && <NotificationsMenu />}
            <IconButton icon={HelpCircle} label="Help" onClick={() => navigate('/help')} />
            <Dropdown
              trigger={({ toggle }) => (
                <button type="button" className="profile-button" onClick={toggle} aria-label="Account menu">
                  <span className="avatar">{initials(user.fullName)}</span>
                  <span className="profile-meta">
                    <span className="name">{user.fullName}</span>
                    <span className="role">{user.role.name}</span>
                  </span>
                </button>
              )}
            >
              <div style={{ padding: '6px 10px' }}>
                <div style={{ fontWeight: 600 }}>{user.fullName}</div>
                <div className="small muted">{user.email}</div>
                <div className="small subtle">{user.role.name}</div>
              </div>
              <div className="dropdown-divider" />
              <button type="button" className="dropdown-item" onClick={() => navigate('/profile')}>
                <UserRound aria-hidden="true" /> Profile and preferences
              </button>
              <button type="button" className="dropdown-item" onClick={handleLogout}>
                <LogOut aria-hidden="true" /> Sign out
              </button>
            </Dropdown>
          </div>
        </header>
        <main className="content" id="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
