const auditLogService = require('../services/auditLogService');

module.exports = {
  name: 'inviteCreate',

  async execute(invite) {
    await auditLogService.handleInviteCreate(invite);
  },
};
