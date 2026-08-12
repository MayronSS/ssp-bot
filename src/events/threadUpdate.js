const auditLogService = require('../services/auditLogService');

module.exports = {
  name: 'threadUpdate',

  async execute(oldThread, newThread) {
    await auditLogService.handleThreadUpdate(oldThread, newThread);
  },
};
