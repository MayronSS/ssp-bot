const memberLogService = require('../services/memberLogService');
const configService = require('../services/configService');
const logger = require('../utils/logger');

module.exports = {
  name: 'guildMemberAdd',

  async execute(member) {
    await memberLogService.sendMemberLog(member, 'join');

    // Auto-role de Cidadão
    try {
      const cidadaoRoleId = await configService.getRole(member.guild.id, 'cidadao');
      let role = null;

      if (cidadaoRoleId) {
        role = member.guild.roles.cache.get(cidadaoRoleId);
      }

      if (!role) {
        // Fallback por nome
        role = member.guild.roles.cache.find(r =>
          ['👤 ┃ Cidadão', 'Cidadão'].includes(r.name)
        );
      }

      if (role) {
        await member.roles.add(role);
        logger.info(`[Auto-Role] Cargo "${role.name}" adicionado automaticamente para o novo membro ${member.user.tag}`);
      }
    } catch (err) {
      logger.error(`[Auto-Role] Erro ao atribuir cargo inicial a ${member.user.tag}:`, err);
    }

    // Atualizar Hierarquia
    try {
      const hierarchyService = require('../services/hierarchyService');
      await hierarchyService.updateHierarchy(member.guild);
    } catch (err) {
      logger.error('Erro ao atualizar hierarquia no guildMemberAdd:', err);
    }
  },
};
