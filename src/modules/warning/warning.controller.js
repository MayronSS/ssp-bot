const { ModalBuilder, TextInputBuilder, ActionRowBuilder, TextInputStyle } = require('discord.js');
const permissionService = require('../../services/permissionService');
const warningService = require('./warning.service');
const componentFactory = require('../../utils/componentFactory');
const disciplinaryService = require('../../services/disciplinaryService');
const emojiHelper = require('../../utils/emojiHelper');
const logger = require('../../utils/logger');
const { EPHEMERAL_REPLY } = require('../../utils/interactionOptions');

function getMemberDisplay(member) {
  if (!member) return '';
  return member.nickname || member.user.globalName || member.user.username;
}

function limitLabel(str, max = 90) {
  if (!str) return '';
  return str.length > max ? `${str.slice(0, max - 3)}...` : str;
}

async function handleWarningStart(interaction, corpSlug) {
  if (!await permissionService.canApplyWarnings(interaction.member)) {
    return interaction.reply({
      content: `${emojiHelper.get('stop') || '❌'} Você não possui autorização para aplicar advertências.`,
      ...EPHEMERAL_REPLY,
    });
  }

  // Auto-detectar corporação do superior pelos cargos
  const corporationService = require('../../services/corporationService');
  const corpDoc = await corporationService.getByMemberRoles(interaction.member);

  if (!corpDoc || !corpDoc.ranks || corpDoc.ranks.length === 0) {
    return interaction.reply({
      content: `${emojiHelper.get('stop') || '❌'} Não foi possível identificar sua corporação. Verifique se você possui um cargo de patente válido.`,
      ...EPHEMERAL_REPLY,
    });
  }

  interaction._corpSlug = corpDoc.slug || corpSlug || 'pmesp';

  // Construir opções de patentes SOMENTE da corporação do aplicador
  const options = [];
  for (const rank of corpDoc.ranks) {
    if (!rank.roleId) continue;
    
    const customEmoji = emojiHelper.findCustomRankEmoji(interaction.guild, rank);
    let emojiPayload = customEmoji ? { id: customEmoji.id } : null;
    
    if (!emojiPayload && rank.emoji) {
      if (rank.emoji.includes(':')) {
        const match = rank.emoji.match(/:(\d+)>/);
        if (match) {
          emojiPayload = { id: match[1] };
        }
      } else {
        emojiPayload = rank.emoji;
      }
    }

    options.push({
      label: limitLabel(rank.name, 90),
      emoji: emojiPayload || undefined,
      description: limitLabel(corpDoc.shortName, 100),
      value: rank.roleId,
    });
  }

  if (options.length === 0) {
    return interaction.reply({
      content: `${emojiHelper.get('stop') || '❌'} Nenhuma patente encontrada para ${corpDoc.shortName}. Execute \`/setup-patentes\` primeiro.`,
      ...EPHEMERAL_REPLY,
    });
  }

  const payload = componentFactory.createWarningRankSelectPayload(options.slice(0, 25));
  return interaction.reply({
    ...payload,
    ...EPHEMERAL_REPLY,
  });
}

async function handleRankSelect(interaction) {
  if (!await permissionService.canApplyWarnings(interaction.member)) {
    return interaction.reply({
      content: `${emojiHelper.get('stop') || '❌'} Você não possui autorização para aplicar advertências.`,
      ...EPHEMERAL_REPLY,
    });
  }

  const roleId = interaction.values?.[0];
  const role = interaction.guild.roles.cache.get(roleId)
    || await interaction.guild.roles.fetch(roleId).catch(() => null);

  if (!role) {
    return interaction.update({
      content: `${emojiHelper.get('stop') || '❌'} Cargo/Patente não encontrado no servidor.`,
      components: [],
    });
  }

  const members = await interaction.guild.members.fetch().catch(() => null);
  const candidates = [...(members || interaction.guild.members.cache).values()]
    .filter((m) => !m.user.bot && m.roles.cache.has(role.id))
    .sort((a, b) => getMemberDisplay(a).localeCompare(getMemberDisplay(b), 'pt-BR'))
    .slice(0, 25);

  if (candidates.length === 0) {
    return interaction.update({
      content: `${emojiHelper.get('stop') || '❌'} Nenhum membro encontrado com a patente **${role.name}**.`,
      components: [],
    });
  }

  const options = candidates.map((m) => ({
    label: limitLabel(getMemberDisplay(m), 90),
    description: limitLabel(`@${m.user.username} | ${m.id}`, 100),
    value: m.id,
  }));

  const payload = componentFactory.createWarningOfficerSelectPayload(role.id, options);
  return interaction.update(payload);
}

async function handleOfficerSelect(interaction) {
  if (!await permissionService.canApplyWarnings(interaction.member)) {
    return interaction.reply({
      content: `${emojiHelper.get('stop') || '❌'} Você não possui autorização para aplicar advertências.`,
      ...EPHEMERAL_REPLY,
    });
  }

  const accusedUserId = interaction.values?.[0];
  const payload = componentFactory.createWarningConfigPayload(accusedUserId, 'adv1', 'd7');
  return interaction.update(payload);
}

async function handleConfigSelect(interaction) {
  if (!await permissionService.canApplyWarnings(interaction.member)) {
    return interaction.reply({
      content: `${emojiHelper.get('stop') || '❌'} Você não possui autorização para aplicar advertências.`,
      ...EPHEMERAL_REPLY,
    });
  }

  const parts = interaction.customId.split(':');
  const userId = parts[1];
  let level = parts[2];
  let duration = parts[3];

  if (interaction.customId.startsWith('warning_level_select:')) {
    level = interaction.values?.[0];
  } else if (interaction.customId.startsWith('warning_duration_select:')) {
    duration = interaction.values?.[0];
  }

  const payload = componentFactory.createWarningConfigPayload(userId, level, duration);
  return interaction.update(payload);
}

async function handleProceedButton(interaction) {
  if (!await permissionService.canApplyWarnings(interaction.member)) {
    return interaction.reply({
      content: `${emojiHelper.get('stop') || '❌'} Você não possui autorização para aplicar advertências.`,
      ...EPHEMERAL_REPLY,
    });
  }

  const parts = interaction.customId.split(':');
  const userId = parts[1];
  const level = parts[2];
  const duration = parts[3];

  const modal = new ModalBuilder()
    .setCustomId(`warning_reason_modal:${userId}:${level}:${duration}`)
    .setTitle('Justificativa da Advertência');

  const reasonInput = new TextInputBuilder()
    .setCustomId('warning_reason_input')
    .setLabel('Motivo / Justificativa da Punição')
    .setPlaceholder('Descreva detalhadamente o ocorrido e infração cometida pelo oficial.')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(900);

  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
  return interaction.showModal(modal);
}

async function handleModalSubmit(interaction) {
  if (!await permissionService.canApplyWarnings(interaction.member)) {
    return interaction.reply({
      content: `${emojiHelper.get('stop') || '❌'} Você não possui autorização para aplicar advertências.`,
      ...EPHEMERAL_REPLY,
    });
  }

  await interaction.deferReply(EPHEMERAL_REPLY);

  const parts = interaction.customId.split(':');
  const userId = parts[1];
  const level = parts[2];
  const duration = parts[3];
  const reason = interaction.fields.getTextInputValue('warning_reason_input').trim();

  try {
    const warning = await warningService.applyDirectWarning(
      interaction.guild,
      userId,
      level,
      duration,
      reason,
      interaction.user.id
    );

    const penalty = disciplinaryService.PENALTIES[level];
    const resolvedDuration = disciplinaryService.resolveDuration(duration);

    return interaction.editReply({
      content: `${emojiHelper.get('check') || '✅'} Punição de **${penalty.label}** (${resolvedDuration.label}) aplicada com sucesso em <@${userId}> (ID: \`${warning.caseNumber}\`).`,
    });
  } catch (error) {
    logger.error('Erro ao aplicar advertência direta:', error);
    return interaction.editReply({
      content: `${emojiHelper.get('stop') || '❌'} Não foi possível aplicar a advertência: ${error.message}`,
    });
  }
}

module.exports = {
  handleWarningStart,
  handleRankSelect,
  handleOfficerSelect,
  handleConfigSelect,
  handleProceedButton,
  handleModalSubmit,
};
