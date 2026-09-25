const { createBaseEmbed } = require('../utils/createEmbed');
const logService = require('./logService');
const permissionService = require('./permissionService');
const logger = require('../utils/logger');
const settings = require('../config/settings');

// Tracker de spam de links na memória: userId -> array de timestamps
const linkSpamTracker = new Map();

/**
 * Verifica se um membro é isento de segurança (Staff/Comando/Admin).
 */
async function isExempt(member) {
  if (!member) return false;
  
  // Administrators ou quem gerencia canais
  if (member.permissions.has('Administrator') || member.permissions.has('ManageChannels')) {
    return true;
  }

  // Cargos de staff de tickets, comandos e administradores de qualquer corporação
  const canManage = await permissionService.canManageTickets(member);
  const canSetup = await permissionService.canSetupPanels(member);
  const canWarn = await permissionService.canApplyWarnings(member);

  return canManage || canSetup || canWarn;
}

/**
 * Analisa a mensagem em busca de links maliciosos, scams ou spam de links.
 * Se violar as regras, deleta a mensagem, avisa o usuário e registra o log.
 * 
 * @param {Message} message - Mensagem do Discord
 * @returns {Promise<boolean>} - Retorna true se a mensagem foi apagada/punida, false caso contrário
 */
async function checkMessage(message) {
  // Ignorar mensagens de bots, de sistema, ou em DMs
  if (message.author.bot || !message.guild || !message.member) return false;

  const content = message.content;
  const linkRegex = /https?:\/\/[^\s]+/gi;
  const urls = content.match(linkRegex);

  // Se não contiver links, segue o fluxo normal
  if (!urls || urls.length === 0) return false;

  // Se for Staff/Comando, é isento da verificação
  const exempt = await isExempt(message.member);
  if (exempt) return false;

  const userId = message.author.id;
  const now = Date.now();

  let isViolating = false;
  let violationReason = '';
  let matchedUrl = '';

  // 1. Verificar links maliciosos / Phishing / Encurtadores
  for (const url of urls) {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();

      // Verificar TLDs russos ou soviéticos (.ru ou .su)
      if (hostname.endsWith('.ru') || hostname.endsWith('.su')) {
        isViolating = true;
        violationReason = 'Domínio suspeito ou não confiável (.ru/.su)';
        matchedUrl = url;
        break;
      }

      // Verificar falsos Nitro do Discord
      if (hostname.includes('nitro') || hostname.includes('gift')) {
        if (!hostname.endsWith('discord.gift') && !hostname.endsWith('discord.com') && !hostname.endsWith('discordapp.com')) {
          isViolating = true;
          violationReason = 'Phishing ou golpe de Discord Nitro gratuito';
          matchedUrl = url;
          break;
        }
      }

      // Verificar typosquatting de Discord e Steam
      const phishingKeywords = ['dlscord', 'discorcl', 'steamcommunity.com.', 'steampowered.com.', 'gift-steam', 'steam-nitro', 'free-nitro'];
      if (phishingKeywords.some(kw => hostname.includes(kw))) {
        if (!hostname.endsWith('steamcommunity.com') && !hostname.endsWith('steampowered.com') && !hostname.endsWith('discord.com')) {
          isViolating = true;
          violationReason = 'Phishing ou tentativa de clonagem de site oficial (Discord/Steam)';
          matchedUrl = url;
          break;
        }
      }

      // Verificar encurtadores de link conhecidos
      const shorteners = ['bit.ly', 'tinyurl.com', 'shorte.st', 'cutt.ly', 't.co', 'goo.gl', 'rebrand.ly'];
      if (shorteners.some(s => hostname === s || hostname.endsWith('.' + s))) {
        isViolating = true;
        violationReason = 'Uso de link encurtado não autorizado (potencial disfarce)';
        matchedUrl = url;
        break;
      }

    } catch (error) {
      // Fallback em caso de erro ao parsear a URL
      const lowerUrl = url.toLowerCase();
      if (lowerUrl.includes('.ru/') || lowerUrl.includes('.ru?') || lowerUrl.endsWith('.ru') ||
          lowerUrl.includes('.su/') || lowerUrl.includes('.su?') || lowerUrl.endsWith('.su')) {
        isViolating = true;
        violationReason = 'Domínio suspeito ou não confiável (.ru/.su)';
        matchedUrl = url;
        break;
      }
      if (lowerUrl.includes('bit.ly') || lowerUrl.includes('tinyurl.com') || lowerUrl.includes('cutt.ly')) {
        isViolating = true;
        violationReason = 'Uso de link encurtado';
        matchedUrl = url;
        break;
      }
    }
  }

  // 2. Verificar Spam de links (Mais de 3 links em 15 segundos)
  if (!isViolating) {
    const userHistory = linkSpamTracker.get(userId) || [];
    // Filtrar apenas envios ocorridos nos últimos 15 segundos
    const recentLinkTimes = userHistory.filter(time => now - time < 15000);

    // Contabilizar cada link contido nesta mensagem
    for (let i = 0; i < urls.length; i++) {
      recentLinkTimes.push(now);
    }
    linkSpamTracker.set(userId, recentLinkTimes);

    if (recentLinkTimes.length > 3) {
      isViolating = true;
      violationReason = 'Spam de links (limite de 3 URLs a cada 15s excedido)';
      matchedUrl = urls.join(', ');
    }
  }

  // Se violou as diretrizes de segurança, agir
  if (isViolating) {
    try {
      // Apagar mensagem original
      await message.delete().catch(() => {});

      // Avisar o usuário no canal
      const warningMessage = await message.channel.send({
        content: `⚠️ **Segurança SSP:** <@${userId}>, não é permitido enviar links maliciosos, encurtados ou fazer spam de links neste servidor!`,
      });

      // Apagar aviso após 5 segundos
      setTimeout(() => {
        warningMessage.delete().catch(() => {});
      }, 5000);

      // Logar no canal administrativo (adminLogs -> log-gerais)
      const client = message.client;
      const embed = createBaseEmbed({
        title: '🛡️ Filtro de Segurança — Mensagem Apagada',
        color: settings.colors.danger,
        fields: [
          { name: 'Infrator', value: `<@${userId}> (\`${message.author.tag}\` / \`${userId}\`)`, inline: true },
          { name: 'Canal', value: `<#${message.channel.id}> (\`${message.channel.name}\`)`, inline: true },
          { name: 'Motivo do Filtro', value: violationReason, inline: false },
          { name: 'Link Detectado', value: `\`\`\`${matchedUrl.slice(0, 1000)}\`\`\``, inline: false },
          { name: 'Conteúdo Original', value: `\`\`\`${content.slice(0, 1000)}\`\`\``, inline: false }
        ],
        timestamp: true
      });

      await logService.sendLog(client, 'adminLogs', embed);
      logger.warn(`Mensagem suspeita de ${message.author.tag} deletada em #${message.channel.name}. Motivo: ${violationReason}`);

      return true;
    } catch (err) {
      logger.error('Erro ao gerenciar segurança de mensagem:', err);
    }
  }

  return false;
}

module.exports = {
  checkMessage,
};
