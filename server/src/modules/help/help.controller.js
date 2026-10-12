const service = require('./help.service');
const { sendData } = require('../../utils/response');

module.exports = {
  async list(req, res) {
    sendData(res, await service.listArticles(req.valid.query.category));
  },
  async search(req, res) {
    sendData(res, await service.searchArticles(req.valid.query.q));
  },
  async get(req, res) {
    sendData(res, await service.getArticle(req.valid.params.id));
  },
};
