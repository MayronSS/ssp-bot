const auditLogService = require('../services/auditLogService');
const logger = require('../utils/logger');

module.exports = {
  name: 'guildMemberUpdate',

  async execute(oldMember, newMember) {
    await auditLogService.handleGuildMemberUpdate(oldMember, newMember);

    const rolesChanged = !oldMember.roles.cache.equals(newMember.roles.cache);
    const nicknameChanged = oldMember.nickname !== newMember.nickname;

    if (rolesChanged || nicknameChanged) {
      try {
        const hierarchyService = require('../services/hierarchyService');
        await hierarchyService.updateHierarchy(newMember.guild);
      } catch (err) {
        logger.error('Erro ao atualizar hierarquia no guildMemberUpdate:', err);
      }
    }
  },
};
