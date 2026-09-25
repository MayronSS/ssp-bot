const memberLogService = require('../services/memberLogService');
const logger = require('../utils/logger');

module.exports = {
  name: 'guildMemberRemove',

  async execute(member) {
    await memberLogService.sendMemberLog(member, 'leave');

    // Encerrar ponto se o membro sair do Discord
    try {
      const pontoService = require('../modules/ponto/ponto.service');
      await pontoService.encerrarPontoUsuario({
        guild: member.guild,
        targetUser: member.user,
        actorUser: member.guild.client.user,
        saveHours: false,
        reason: 'Membro saiu do servidor do Discord'
      });
    } catch (err) {
      logger.error('Erro ao encerrar ponto no guildMemberRemove:', err);
    }

    // Atualizar Hierarquia
    try {
      const hierarchyService = require('../services/hierarchyService');
      await hierarchyService.updateHierarchy(member.guild);
    } catch (err) {
      logger.error('Erro ao atualizar hierarquia no guildMemberRemove:', err);
    }
  },
};
