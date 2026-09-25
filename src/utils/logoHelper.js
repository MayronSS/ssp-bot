const fs = require('fs');
const path = require('path');
const GuildConfig = require('../database/models/GuildConfig');
const embedsConfig = require('../config/embeds');
const logger = require('./logger');
const { resolveChannel } = require('./resolver');
const { AttachmentBuilder } = require('discord.js');

async function initializeCustomLogo(client, guildId) {
  const logoPath = path.join(__dirname, '..', '..', 'logo.png');
  const targetPath = path.join(__dirname, '..', 'assets', 'images', 'lspd_badge.png');

  if (fs.existsSync(logoPath)) {
    try {
      // Copiar localmente para lspd_badge.png
      fs.copyFileSync(logoPath, targetPath);
      logger.success('[LogoHelper] logo.png copiado com sucesso para lspd_badge.png.');
    } catch (err) {
      logger.error('[LogoHelper] Erro ao copiar logo.png para assets:', err);
    }
  }

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  // Verificar se já temos a URL no banco de dados
  let config = await GuildConfig.findOne({ guildId });
  if (!config) {
    config = new GuildConfig({ guildId });
  }

  let cdnUrl = config.embeds?.design?.logo;

  // Se a URL não existe ou é inválida/legada, faz o upload
  if (!cdnUrl || !cdnUrl.startsWith('http')) {
    if (fs.existsSync(logoPath)) {
      try {
        // Resolver canal de logs gerais para o upload do logo
        const channel = await resolveChannel(guild, 'adminLogs', '📄・log-gerais', { autoCreate: true });

        if (channel) {
          logger.info('[LogoHelper] Fazendo upload do logo.png para obter link permanente do Discord CDN...');
          const attachment = new AttachmentBuilder(logoPath, { name: 'logo.png' });
          const message = await channel.send({
            content: '🛡️ **Logo Oficial SSP/LSPD** (Upload do Sistema)',
            files: [attachment]
          });

          const uploadedUrl = message.attachments.first()?.url;
          if (uploadedUrl) {
            cdnUrl = uploadedUrl;
            
            // Salvar no banco
            if (!config.embeds) config.embeds = {};
            if (!config.embeds.design) config.embeds.design = {};
            config.embeds.design.logo = cdnUrl;
            await config.save();
            
            logger.success(`[LogoHelper] Logo carregado no Discord CDN com sucesso: ${cdnUrl}`);
          }
        }
      } catch (uploadErr) {
        logger.error('[LogoHelper] Erro ao fazer upload do logo.png:', uploadErr);
      }
    }
  }

  if (cdnUrl && cdnUrl.startsWith('http')) {
    // Sobrescrever em memória no embedsConfig
    logger.info(`[LogoHelper] Aplicando URL permanente do logo nas configurações de embeds em memória: ${cdnUrl}`);
    
    // Função recursiva para substituir as referências locais pela URL do CDN
    function replaceAttachmentRefs(obj, replacementUrl) {
      for (const key in obj) {
        if (typeof obj[key] === 'string') {
          if (obj[key] === 'attachment://lspd_badge.png') {
            obj[key] = replacementUrl;
          }
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          replaceAttachmentRefs(obj[key], replacementUrl);
        }
      }
    }
    
    replaceAttachmentRefs(embedsConfig, cdnUrl);
  }
}

module.exports = {
  initializeCustomLogo,
};
