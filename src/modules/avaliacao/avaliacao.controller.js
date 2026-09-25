const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { canEvaluate } = require('../../services/permissionService');
const logService = require('../../services/logService');
const { createErrorEmbed, createSuccessEmbed } = require('../../utils/createEmbed');
const { EPHEMERAL_REPLY } = require('../../utils/interactionOptions');
const Member = require('../../database/models/Member');
const componentFactory = require('../../utils/componentFactory');
const logger = require('../../utils/logger');
const emojiHelper = require('../../utils/emojiHelper');

function getMemberDisplay(member) {
  if (!member) return '';
  return member.nickname || member.user.globalName || member.user.username;
}

function limitLabel(str, max = 90) {
  if (!str) return '';
  return str.length > max ? `${str.slice(0, max - 3)}...` : str;
}

/**
 * Inicia o fluxo de avaliação ao clicar no botão do painel, pedindo a patente.
 * Auto-detecta a corporação do superior pelos cargos dele.
 */
async function handleStart(interaction, corpSlug) {
  await interaction.deferReply(EPHEMERAL_REPLY);

  if (!await canEvaluate(interaction.member)) {
    return interaction.editReply({
      embeds: [createErrorEmbed('Sem Permissão', 'Apenas oficiais Cabo ou acima possuem autorização para avaliar.')],
    });
  }

  // Auto-detectar corporação do superior pelos cargos
  const corporationService = require('../../services/corporationService');
  const corpDoc = await corporationService.getByMemberRoles(interaction.member);

  if (!corpDoc || !corpDoc.ranks || corpDoc.ranks.length === 0) {
    return interaction.editReply({
      embeds: [createErrorEmbed('Corporação Não Identificada', 'Não foi possível identificar sua corporação. Verifique se você possui um cargo de patente válido.')],
    });
  }

  interaction._corpSlug = corpDoc.slug || corpSlug || 'pmesp';

  // Construir opções de patentes SOMENTE da corporação do avaliador
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
    return interaction.editReply({
      embeds: [createErrorEmbed('Sem Patentes', `Nenhuma patente encontrada para ${corpDoc.shortName}. Execute \`/setup-patentes\` primeiro.`)],
    });
  }

  // Limitar a 25 opções (limite do Discord)
  const payload = componentFactory.createAvaliacaoRankSelectPayload(options.slice(0, 25));
  return interaction.editReply(payload);
}

/**
 * Processa a escolha do cargo/patente no select menu e exibe a lista de membros filtrada.
 */
async function handleRankSelect(interaction) {
  if (!await canEvaluate(interaction.member)) {
    return interaction.reply({
      embeds: [createErrorEmbed('Sem Permissão', 'Você não possui permissão para avaliar.')],
      ...EPHEMERAL_REPLY,
    });
  }

  const roleId = interaction.values?.[0];
  const role = interaction.guild.roles.cache.get(roleId)
    || await interaction.guild.roles.fetch(roleId).catch(() => null);

  if (!role) {
    return interaction.update({
      content: '❌ Cargo/Patente não encontrado no servidor.',
      components: [],
    });
  }

  // Fetch all guild members to ensure fresh data
  const members = await interaction.guild.members.fetch().catch(() => null);
  const candidates = [...(members || interaction.guild.members.cache).values()]
    .filter((m) => !m.user.bot && m.roles.cache.has(role.id))
    .sort((a, b) => getMemberDisplay(a).localeCompare(getMemberDisplay(b), 'pt-BR'))
    .slice(0, 25);

  if (candidates.length === 0) {
    return interaction.update({
      content: `❌ Nenhum oficial encontrado com a patente **${role.name}**.`,
      components: [],
    });
  }

  const options = candidates.map((m) => ({
    label: limitLabel(getMemberDisplay(m), 90),
    description: limitLabel(`@${m.user.username} | ${m.id}`, 100),
    value: m.id,
  }));

  const payload = componentFactory.createAvaliacaoOfficerSelectPayload(role.id, options);
  return interaction.update(payload);
}

/**
 * Processa a escolha do oficial correspondente e abre o modal.
 */
async function handleOfficerSelect(interaction) {
  if (!await canEvaluate(interaction.member)) {
    return interaction.reply({
      embeds: [createErrorEmbed('Sem Permissão', 'Você não possui permissão para avaliar.')],
      ...EPHEMERAL_REPLY,
    });
  }

  const targetUserId = interaction.values?.[0];

  const targetUser = await interaction.client.users.fetch(targetUserId).catch(() => null);
  if (!targetUser) {
    return interaction.reply({
      embeds: [createErrorEmbed('Erro de Validação', 'Usuário não encontrado.')],
      ...EPHEMERAL_REPLY,
    });
  }

  if (targetUser.bot) {
    return interaction.reply({
      embeds: [createErrorEmbed('Erro de Validação', 'Você não pode avaliar um bot.')],
      ...EPHEMERAL_REPLY,
    });
  }

  // Criar o Modal
  const modal = new ModalBuilder()
    .setCustomId(`avaliacao_modal_${targetUserId}`)
    .setTitle(`Avaliar: ${targetUser.username}`);

  const notaInput = new TextInputBuilder()
    .setCustomId('nota')
    .setLabel('Nota da Avaliação (1 a 5)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Digite um número de 1 a 5')
    .setMinLength(1)
    .setMaxLength(1)
    .setRequired(true);

  const motivoInput = new TextInputBuilder()
    .setCustomId('motivo')
    .setLabel('Feedback / Motivo da Avaliação')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Descreva os pontos positivos e negativos do desempenho do oficial...')
    .setRequired(true);

  const row1 = new ActionRowBuilder().addComponents(notaInput);
  const row2 = new ActionRowBuilder().addComponents(motivoInput);

  modal.addComponents(row1, row2);

  await interaction.showModal(modal);
}

/**
 * Processa a submissão do modal.
 */
async function handleModalSubmit(interaction) {
  const customId = interaction.customId;
  const targetUserId = customId.replace('avaliacao_modal_', '');

  const notaStr = interaction.fields.getTextInputValue('nota');
  const motivo = interaction.fields.getTextInputValue('motivo');

  const nota = parseInt(notaStr);
  if (isNaN(nota) || nota < 1 || nota > 5) {
    return interaction.reply({
      embeds: [createErrorEmbed('Nota Inválida', 'A nota informada deve ser um número inteiro de 1 a 5.')],
      ...EPHEMERAL_REPLY,
    });
  }

  await interaction.deferReply(EPHEMERAL_REPLY);

  try {
    const targetUser = await interaction.client.users.fetch(targetUserId);

    // 1. Atualizar estatísticas do avaliador
    let evaluatorDb = await Member.findOne({ discordUserId: interaction.user.id });
    if (!evaluatorDb) {
      evaluatorDb = await Member.create({
        discordUserId: interaction.user.id,
        username: interaction.user.username,
        avatarUrl: interaction.user.displayAvatarURL({ dynamic: true }) || null
      });
    }
    evaluatorDb.avaliacoesRealizadas = (evaluatorDb.avaliacoesRealizadas || 0) + 1;
    await evaluatorDb.save();

    // 2. Atualizar estatísticas do avaliado
    let targetDb = await Member.findOne({ discordUserId: targetUserId });
    if (!targetDb) {
      targetDb = await Member.create({
        discordUserId: targetUserId,
        username: targetUser.username,
        avatarUrl: targetUser.displayAvatarURL({ dynamic: true }) || null
      });
    }
    targetDb.avaliacoesRecebidas = (targetDb.avaliacoesRecebidas || 0) + 1;
    await targetDb.save();

    // 3. Enviar log de avaliações
    await logService.logEvaluationCreated(interaction.client, {
      evaluatorId: interaction.user.id,
      targetId: targetUserId,
      rating: nota,
      comment: motivo
    });

    // 4. Responder com sucesso
    const successEmbed = createSuccessEmbed(
      'Avaliação Registrada com Sucesso',
      `O oficial <@${targetUserId}> foi avaliado com sucesso!\n\n` +
      `**Nota:** ${'⭐'.repeat(nota)} (${nota}/5)\n` +
      `**Feedback:** ${motivo}\n\n` +
      `*A estatística foi salva no banco de dados e sincronizada no Painel Web.*`
    );

    await interaction.editReply({ embeds: [successEmbed] });

  } catch (error) {
    logger.error('Erro ao processar modal de avaliação:', error);
    await interaction.editReply({
      embeds: [createErrorEmbed('Erro Interno', `Ocorreu um erro ao salvar a avaliação: ${error.message}`)],
    });
  }
}

module.exports = {
  handleStart,
  handleRankSelect,
  handleOfficerSelect,
  handleModalSubmit,
};
