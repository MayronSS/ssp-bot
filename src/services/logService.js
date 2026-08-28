const { createBaseEmbed } = require('../utils/createEmbed');
const settings = require('../config/settings');
const env = require('../config/env');
const logger = require('../utils/logger');
const { discordTimestamp } = require('../utils/formatDate');
const { resolveChannel } = require('../utils/resolver');
const corporationsConfig = require('../config/corporations');

/**
 * Serviço centralizado de logs.
 * Envia embeds de log para canais configurados de forma dinâmica (zero-config).
 */

/**
 * Resolve corporação e batalhão de um membro a partir dos cargos.
 * Retorna { corporation: string|null, battalion: string|null, corpEmoji: string }
 */
function resolveMemberAffiliation(member) {
  if (!member || !member.roles) return { corporation: null, battalion: null, corpEmoji: '🛡️' };

  const roleNames = member.roles.cache ? 
    [...member.roles.cache.values()].map(r => r.name.toLowerCase()) :
    [];

  let corporation = null;
  let corpEmoji = '🛡️';

  // Verificar corporação primária
  for (const corp of corporationsConfig.corporations) {
    const geralName = corp.systemRoles.geral.toLowerCase();
    if (roleNames.some(r => r === geralName)) {
      corporation = corp.shortName;
      corpEmoji = corp.emoji || '🛡️';
      break;
    }
  }

  // Verificar batalhão/tag
  let battalion = null;
  for (const tag of corporationsConfig.tags) {
    const tagName = tag.tagRole.toLowerCase();
    if (roleNames.some(r => r === tagName)) {
      battalion = tag.shortName;
      break;
    }
  }

  return { corporation, battalion, corpEmoji };
}

/**
 * Formata a linha de afiliação para exibição nos logs.
 * Ex: "🛡️ PMESP • ⚡ FT" ou "🛡️ PCESP"
 */
function formatAffiliation({ corporation, battalion, corpEmoji }) {
  if (!corporation) return '—';
  let text = `${corpEmoji} ${corporation}`;
  if (battalion) {
    const tag = corporationsConfig.tags.find(t => t.shortName === battalion);
    text += ` • ${tag ? tag.emoji : '🏷️'} ${battalion}`;
  }
  return text;
}

/**
 * Envia um embed de log para um canal específico.
 */
async function sendLog(client, channelId, embed) {
  try {
    const guildId = env.GUILD_ID;
    const guild = client.guilds.cache.get(guildId) || client.guilds.cache.first();
    if (!guild) {
      logger.error('Guild não encontrada no cache do bot para logs.');
      return;
    }
    const channel = await resolveChannel(guild, channelId, '📄・log-gerais', { autoCreate: false });
    if (!channel) {
      logger.warn(`Canal de log não pôde ser resolvido ou criado: ${channelId}`);
      return;
    }
    await channel.send({ embeds: [embed] });
  } catch (error) {
    logger.error('Erro ao enviar log para o canal:', error);
  }
}

/**
 * Log: Ticket aberto
 */
async function logTicketOpened(client, { userId, username, reason, channelName, corporationSlug }) {
  const corpLabel = corporationSlug
    ? (corporationsConfig.corporations.find(c => c.slug === corporationSlug)?.shortName || corporationSlug.toUpperCase())
    : '—';

  const embed = createBaseEmbed({
    title: '🎫 Ticket Aberto',
    color: settings.colors.info,
    fields: [
      { name: 'Usuário', value: `<@${userId}> (\`${username}\`)`, inline: true },
      { name: 'Corporação', value: `🛡️ ${corpLabel}`, inline: true },
      { name: 'Canal', value: `\`${channelName}\``, inline: true },
      { name: 'Motivo', value: reason || 'Não informado', inline: false },
    ],
    timestamp: true,
  });
  await sendLog(client, 'adminLogs', embed);
}

/**
 * Log: Ticket fechado
 */
async function logTicketClosed(client, { userId, username, closedBy, channelName, corporationSlug }) {
  const corpLabel = corporationSlug
    ? (corporationsConfig.corporations.find(c => c.slug === corporationSlug)?.shortName || corporationSlug.toUpperCase())
    : '—';

  const embed = createBaseEmbed({
    title: '🔒 Ticket Fechado',
    color: settings.colors.danger,
    fields: [
      { name: 'Ticket', value: `\`${channelName}\``, inline: true },
      { name: 'Corporação', value: `🛡️ ${corpLabel}`, inline: true },
      { name: 'Aberto por', value: `<@${userId}> (\`${username}\`)`, inline: true },
      { name: 'Fechado por', value: `<@${closedBy}>`, inline: true },
      { name: 'Encerrado em', value: discordTimestamp(new Date()), inline: false },
    ],
    timestamp: true,
  });
  await sendLog(client, 'adminLogs', embed);
}

/**
 * Log: Setup executado
 */
async function logSetupExecuted(client, { userId, module: moduleName }) {
  const embed = createBaseEmbed({
    title: '⚙️ Setup Executado',
    color: settings.colors.info,
    fields: [
      { name: 'Executado por', value: `<@${userId}>`, inline: true },
      { name: 'Módulo', value: `\`${moduleName}\``, inline: true },
    ],
    timestamp: true,
  });
  await sendLog(client, 'adminLogs', embed);
}

/**
 * Log: Avaliação de Membro registrada (Padrão Components V2)
 */
async function logEvaluationCreated(client, { evaluatorId, targetId, rating, comment }) {
  try {
    const guildId = env.GUILD_ID;
    const guild = client.guilds.cache.get(guildId) || client.guilds.cache.first();
    if (!guild) {
      logger.error('Guild não encontrada no cache do bot para logs de avaliação.');
      return;
    }

    const channel = await resolveChannel(guild, 'avaliacaoLogs', '📄・log-avaliacoes', { autoCreate: false });
    if (!channel) {
      logger.warn('Canal de log de avaliação não pôde ser resolvido ou criado.');
      return;
    }

    // Tentar resolver afiliação do avaliador
    let affiliationText = '—';
    try {
      const member = await guild.members.fetch(evaluatorId).catch(() => null);
      if (member) {
        const affiliation = resolveMemberAffiliation(member);
        affiliationText = formatAffiliation(affiliation);
      }
    } catch (e) { /* ignore */ }

    const componentFactory = require('../utils/componentFactory');
    const payload = componentFactory.createAvaliacaoLogPayload({
      evaluatorId,
      targetId,
      rating,
      comment,
      affiliationText,
    });

    await channel.send(payload);
  } catch (error) {
    logger.error('Erro ao enviar log de avaliação em padrão Components V2:', error);
  }
}

/**
 * Log genérica com afiliação do membro.
 * Usada por outros módulos para logs enriquecidas.
 */
async function logWithAffiliation(client, { channelKey, title, color, member, fields = [], userId }) {
  try {
    const guildId = env.GUILD_ID;
    const guild = client.guilds.cache.get(guildId) || client.guilds.cache.first();
    if (!guild) return;

    let affiliationText = '—';
    const targetMember = member || (userId ? await guild.members.fetch(userId).catch(() => null) : null);
    if (targetMember) {
      const affiliation = resolveMemberAffiliation(targetMember);
      affiliationText = formatAffiliation(affiliation);
    }

    const allFields = [
      ...fields,
      { name: 'Corporação / Batalhão', value: affiliationText, inline: true },
    ];

    const embed = createBaseEmbed({
      title,
      color: color || settings.colors.info,
      fields: allFields,
      timestamp: true,
    });

    await sendLog(client, channelKey || 'adminLogs', embed);
  } catch (error) {
    logger.error('Erro ao enviar log com afiliação:', error);
  }
}

module.exports = {
  sendLog,
  logTicketOpened,
  logTicketClosed,
  logSetupExecuted,
  logEvaluationCreated,
  logWithAffiliation,
  resolveMemberAffiliation,
  formatAffiliation,
};
