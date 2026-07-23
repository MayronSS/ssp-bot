const auditLogService = require('../services/auditLogService');

module.exports = {
  name: 'roleDelete',

  async execute(role) {
    await auditLogService.handleRoleDelete(role);
  },
};
