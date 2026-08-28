const auditLogService = require('../services/auditLogService');

module.exports = {
  name: 'messageDelete',

  async execute(message) {
    await auditLogService.handleMessageDelete(message);
  },
};
