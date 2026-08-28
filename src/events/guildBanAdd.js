const auditLogService = require('../services/auditLogService');

module.exports = {
  name: 'guildBanAdd',

  async execute(ban) {
    await auditLogService.handleGuildBanAdd(ban);
  },
};
