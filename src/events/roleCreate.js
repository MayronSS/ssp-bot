const auditLogService = require('../services/auditLogService');

module.exports = {
  name: 'roleCreate',

  async execute(role) {
    await auditLogService.handleRoleCreate(role);
  },
};
