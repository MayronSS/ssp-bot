const auditLogService = require('../services/auditLogService');

module.exports = {
  name: 'roleUpdate',

  async execute(oldRole, newRole) {
    await auditLogService.handleRoleUpdate(oldRole, newRole);
  },
};
