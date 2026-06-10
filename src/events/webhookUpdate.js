const auditLogService = require('../services/auditLogService');

module.exports = {
  name: 'webhookUpdate',

  async execute(channel) {
    await auditLogService.handleWebhookUpdate(channel);
  },
};
