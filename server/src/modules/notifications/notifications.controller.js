const service = require('./notifications.service');
const { sendData, sendPage } = require('../../utils/response');

module.exports = {
  async list(req, res) {
    sendPage(res, await service.listNotifications(req.auth, req.valid.query));
  },
  async unreadCount(req, res) {
    sendData(res, await service.unreadCount(req.auth));
  },
  async markRead(req, res) {
    await service.markRead(req.auth, req.valid.params.id);
    sendData(res, null, { message: 'Notification marked as read.' });
  },
  async dismiss(req, res) {
    await service.dismiss(req.auth, req.valid.params.id);
    sendData(res, null, { message: 'Notification dismissed.' });
  },
  async markAllRead(req, res) {
    sendData(res, await service.markAllRead(req.auth), { message: 'All notifications marked as read.' });
  },
};
