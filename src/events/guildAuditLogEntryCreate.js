const auditLogService = require('../services/auditLogService');

module.exports = {
  name: 'guildAuditLogEntryCreate',

  async execute(entry, guild) {
    await auditLogService.handleGuildAuditLogEntryCreate(entry, guild);
  },
};
