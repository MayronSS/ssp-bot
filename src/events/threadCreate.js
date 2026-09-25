const auditLogService = require('../services/auditLogService');

module.exports = {
  name: 'threadCreate',

  async execute(thread) {
    await auditLogService.handleThreadCreate(thread);
  },
};
