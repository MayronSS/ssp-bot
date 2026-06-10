const auditLogService = require('../services/auditLogService');

module.exports = {
  name: 'messageUpdate',

  async execute(oldMessage, newMessage) {
    await auditLogService.handleMessageUpdate(oldMessage, newMessage);
  },
};
