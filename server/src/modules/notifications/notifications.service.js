const AppError = require('../../errors/AppError');
const { parseListParams } = require('../../utils/pagination');
const { camelize } = require('../../utils/camelize');
const repo = require('./notifications.repository');

async function listNotifications(auth, query) {
  const params = parseListParams(query, { sortable: { default: '1' }, defaultSort: 'default' });
  const { rows, total } = await repo.list(auth.userId, {
    unreadOnly: query.unreadOnly,
    type: query.type,
    limit: params.limit,
    offset: params.offset,
  });
  return {
    rows: rows.map((r) => {
      const dto = camelize(r);
      delete dto.totalCount;
      return dto;
    }),
    total,
    page: params.page,
    limit: params.limit,
  };
}

async function unreadCount(auth) {
  return { unread: await repo.unreadCount(auth.userId) };
}

async function markRead(auth, id) {
  if (!(await repo.mark(auth.userId, id, 'read_at'))) throw AppError.notFound('Notification not found.');
}

async function dismiss(auth, id) {
  if (!(await repo.mark(auth.userId, id, 'dismissed_at'))) throw AppError.notFound('Notification not found.');
}

async function markAllRead(auth) {
  return { updated: await repo.markAllRead(auth.userId) };
}

module.exports = { listNotifications, unreadCount, markRead, dismiss, markAllRead };
