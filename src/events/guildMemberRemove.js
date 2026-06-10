const memberLogService = require('../services/memberLogService');
const logger = require('../utils/logger');

module.exports = {
  name: 'guildMemberRemove',

  async execute(member) {
    await memberLogService.sendMemberLog(member, 'leave');

    // Atualizar Hierarquia
    try {
      const hierarchyService = require('../services/hierarchyService');
      await hierarchyService.updateHierarchy(member.guild);
    } catch (err) {
      logger.error('Erro ao atualizar hierarquia no guildMemberRemove:', err);
    }
  },
};
