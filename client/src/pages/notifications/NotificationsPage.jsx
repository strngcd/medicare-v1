import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, X } from 'lucide-react';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useListState } from '../../hooks/useListState.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader, Panel, DataTable, Pagination, Button, EmptyState, IconButton, Checkbox, FilterToolbar } from '../../components/ui/index.js';
import { formatDateTime, humanize } from '../../utils/format.js';

const ROUTES = { PURCHASE: '/purchases/', TRANSFER: '/transfers/' };

export default function NotificationsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { state, update } = useListState();
  const list = useApi(() => api.get('/notifications', state), [JSON.stringify(state)]);

  const act = async (fn, message) => {
    try {
      await fn();
      if (message) toast.success(message);
      list.reload({ silent: true });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const columns = [
    {
      key: 'title',
      label: 'Notification',
      render: (n) => (
        <span className="stack-sm" style={{ gap: 2 }}>
          <span style={{ fontWeight: n.readAt ? 400 : 600 }}>{n.title}</span>
          <span className="small muted">{n.message}</span>
        </span>
      ),
    },
    { key: 'type', label: 'Type', render: (n) => <span className="small">{humanize(n.type)}</span> },
    { key: 'createdAt', label: 'Received', render: (n) => <span className="nowrap small">{formatDateTime(n.createdAt)}</span> },
    {
      key: 'actions',
      label: '',
      render: (n) => (
        <span className="row" onClick={(e) => e.stopPropagation()}>
          {!n.readAt && <IconButton icon={CheckCheck} label="Mark as read" onClick={() => act(() => api.patch(`/notifications/${n.id}/read`))} />}
          <IconButton icon={X} label="Dismiss" onClick={() => act(() => api.patch(`/notifications/${n.id}/dismiss`), 'Notification dismissed.')} />
        </span>
      ),
    },
  ];

  return (
    <div className="stack">
      <PageHeader
        title="Notifications"
        description="Updates about purchases, transfers and your account."
        actions={<Button variant="secondary" icon={CheckCheck} onClick={() => act(() => api.patch('/notifications/read-all'), 'All marked as read.')}>Mark all read</Button>}
      />
      <Panel flush>
        <FilterToolbar>
          <Checkbox label="Unread only" checked={state.unreadOnly === 'true'} onChange={(e) => update({ unreadOnly: e.target.checked ? 'true' : '' })} />
        </FilterToolbar>
        <DataTable
          columns={columns}
          rows={list.data && list.data.data}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          filtered={state.unreadOnly === 'true'}
          onClearFilters={() => update({ unreadOnly: '' })}
          onRowClick={(n) => {
            if (!n.readAt) api.patch(`/notifications/${n.id}/read`).catch(() => {});
            if (ROUTES[n.entityType]) navigate(`${ROUTES[n.entityType]}${n.entityId}`);
          }}
          empty={<EmptyState icon={Bell} title="No notifications" message="You will see purchase, transfer and security updates here." />}
        />
        <Pagination pagination={list.data && list.data.pagination} onChange={(page) => update({ page }, { resetPage: false })} />
      </Panel>
    </div>
  );
}
