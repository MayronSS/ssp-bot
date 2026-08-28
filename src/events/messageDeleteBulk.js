const auditLogService = require('../services/auditLogService');

module.exports = {
  name: 'messageDeleteBulk',

  async execute(messages, channel) {
    await auditLogService.handleMessageDeleteBulk(messages, channel);
  },
};
