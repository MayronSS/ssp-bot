const auditLogService = require('../services/auditLogService');

module.exports = {
  name: 'guildUpdate',

  async execute(oldGuild, newGuild) {
    await auditLogService.handleGuildUpdate(oldGuild, newGuild);
  },
};
