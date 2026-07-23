const { ActivityType } = require('discord.js');
const logger = require('../utils/logger');
const env = require('../config/env');
const disciplinaryService = require('../services/disciplinaryService');
const corporationService = require('../services/corporationService');
const { startPontoWatcher } = require('../services/pontoWatcher');

/**
 * Evento ready — executado quando o bot fica online.
 */
module.exports = {
  name: 'clientReady',
  once: true,

  async execute(client) {
    logger.success(`Bot online como ${client.user.tag}`);

    // Verificar se o servidor configurado existe
    const guild = client.guilds.cache.get(env.GUILD_ID);
    if (!guild) {
      logger.error('GUILD_ID não encontrado ou inválido no .env');
      return;
    }

    logger.info(`Servidor: ${guild.name} (${guild.memberCount} membros)`);

    // Inicializar logo customizado
    try {
      const logoHelper = require('../utils/logoHelper');
      await logoHelper.initializeCustomLogo(client, guild.id);
    } catch (err) {
      logger.error('Erro ao inicializar logo customizado:', err);
    }

    // Sincronizar corporações (auto-seed do config estático → MongoDB)
    try {
      await corporationService.syncCorporations(guild.id);
    } catch (err) {
      logger.error('Erro ao sincronizar corporações:', err);
    }

    // Inicializar helper de emojis customizados brancos
    const emojiHelper = require('../utils/emojiHelper');
    await emojiHelper.init(guild);

    // Atualizar Hierarquia no startup
    try {
      const hierarchyService = require('../services/hierarchyService');
      await hierarchyService.updateHierarchy(guild);
    } catch (err) {
      logger.error('Erro ao atualizar hierarquia no startup:', err);
    }

    // Status rotativo do bot
    const activities = [
      { name: `a segurança em ${guild.name}`, type: ActivityType.Watching },
      { name: 'a central de suporte', type: ActivityType.Listening },
      { name: `${guild.memberCount} agentes`, type: ActivityType.Watching },
    ];

    let index = 0;
    client.user.setActivity(activities[index]);

    setInterval(() => {
      index = (index + 1) % activities.length;
      client.user.setActivity(activities[index]);
    }, 15000);

    disciplinaryService.startWarningExpiryScheduler(client);

    // Iniciar monitoramento automático do ponto (integração FiveM)
    startPontoWatcher(client);

    logger.success('Bot pronto para operar!');
  },
};
