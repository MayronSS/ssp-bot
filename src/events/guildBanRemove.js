const auditLogService = require('../services/auditLogService');

module.exports = {
  name: 'guildBanRemove',

  async execute(ban) {
    await auditLogService.handleGuildBanRemove(ban);
  },
};
