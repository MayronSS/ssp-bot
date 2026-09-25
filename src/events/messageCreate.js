const ticketAiService = require('../services/ticketAiService');
const securityService = require('../services/securityService');
const configService = require('../services/configService');
const corporationService = require('../services/corporationService');
const sugestoesController = require('../modules/sugestoes/sugestoes.controller');
const editalController = require('../modules/edital/edital.controller');
const logger = require('../utils/logger');

module.exports = {
  name: 'messageCreate',

  async execute(message) {
    if (message.author.bot || !message.guild) return;

    try {
      const guildId = message.guild.id;

      // Interceptar mensagens do preenchimento do edital no canal
      const editalHandled = await editalController.handleEditalMessage(message);
      if (editalHandled) return;

      // Verificar se a mensagem é do canal de sugestões (global ou corporações)
      const globalSugestoesId = await configService.getChannel(guildId, 'sugestoes');
      const corps = await corporationService.listPrimary(guildId);
      const corpSugestoesIds = corps.map(c => c.channels?.sugestoes).filter(Boolean);
      
      const allSugestoesIds = [globalSugestoesId, ...corpSugestoesIds];

      if (allSugestoesIds.includes(message.channel.id)) {
        await sugestoesController.handleSugestaoAutoConvert(message);
        return;
      }

      // Verificar segurança de links/spam
      const wasIntercepted = await securityService.checkMessage(message);
      if (wasIntercepted) return;

      await ticketAiService.handleTicketMessage(message);
    } catch (error) {
      logger.error('Erro no processamento da mensagem:', error);
    }
  },
};
