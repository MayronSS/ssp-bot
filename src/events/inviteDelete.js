const auditLogService = require('../services/auditLogService');

module.exports = {
  name: 'inviteDelete',

  async execute(invite) {
    await auditLogService.handleInviteDelete(invite);
  },
};
