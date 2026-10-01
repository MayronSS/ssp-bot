const auditLogService = require('../services/auditLogService');

module.exports = {
  name: 'threadDelete',

  async execute(thread) {
    await auditLogService.handleThreadDelete(thread);
  },
};
