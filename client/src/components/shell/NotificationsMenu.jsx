import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { api } from '../../api/client.js';
import { useApi, usePolling } from '../../hooks/useApi.js';
import { Dropdown, IconButton } from '../ui/index.js';
import { formatDateTime } from '../../utils/format.js';

const ENTITY_ROUTES = { PURCHASE: '/purchases/', TRANSFER: '/transfers/', USER: '/profile' };

/** Bell with unread count (light polling) and the latest notifications. */
export function NotificationsMenu() {
  const navigate = useNavigate();
  const [items, setItems] = useState(null);
  const count = useApi(() => api.get('/notifications/unread-count').then((r) => r.data.unread), []);
  usePolling(() => count.reload({ silent: true }), 60000);

  const loadItems = () => api.get('/notifications', { limit: 8 }).then((r) => setItems(r.data)).catch(() => setItems([]));

  const open = async (n) => {
    if (!n.readAt) await api.patch(`/notifications/${n.id}/read`).catch(() => {});
    count.reload({ silent: true });
    const base = ENTITY_ROUTES[n.entityType];
    if (base) navigate(base === '/profile' ? base : `${base}${n.entityId}`);
    else navigate('/notifications');
  };

  const markAll = async () => {
    await api.patch('/notifications/read-all').catch(() => {});
    count.reload({ silent: true });
    loadItems();
  };

  return (
    <Dropdown
      trigger={({ toggle }) => (
        <IconButton
          icon={Bell}
          label="Notifications"
          badge={count.data || 0}
          onClick={() => {
            if (items === null) loadItems();
            else loadItems();
            toggle();
          }}
        />
      )}
    >
      <div className="spread" style={{ padding: '6px 10px' }}>
        <strong>Notifications</strong>
        <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); markAll(); }}>
          <CheckCheck aria-hidden="true" /> Mark all read
        </button>
      </div>
      <div className="dropdown-divider" />
      {items === null && <div className="dropdown-item muted">Loading…</div>}
      {items && items.length === 0 && <div className="dropdown-item muted">You are all caught up.</div>}
      {items && items.map((n) => (
        <button key={n.id} type="button" className="dropdown-item" style={{ alignItems: 'flex-start', width: 320 }} onClick={() => open(n)}>
          <span className="stack-sm" style={{ gap: 2 }}>
            <span style={{ fontWeight: n.readAt ? 400 : 600 }}>{n.title}</span>
            <span className="small muted">{n.message}</span>
            <span className="small subtle">{formatDateTime(n.createdAt)}</span>
          </span>
        </button>
      ))}
      <div className="dropdown-divider" />
      <button type="button" className="dropdown-item" onClick={() => navigate('/notifications')}>View all notifications</button>
    </Dropdown>
  );
}
