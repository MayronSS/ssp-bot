const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const Exoneracao = require('../../database/models/Exoneracao');
const componentFactory = require('../../utils/componentFactory');
const emojiHelper = require('../../utils/emojiHelper');
const logger = require('../../utils/logger');
const configService = require('../../services/configService');
const corporationService = require('../../services/corporationService');
const { canSetupPanels } = require('../../services/permissionService');
const { EPHEMERAL_REPLY } = require('../../utils/interactionOptions');

const EXONERACOES_LOG_CHANNEL_ID = '1510993738384539729';

async function handleExoneracaoButton(interaction) {
  // Apenas Comando/Administradores
  if (!await canSetupPanels(interaction.member)) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} **Acesso Negado:** Apenas o Comando/Diretoria pode registrar exonerações.`,
      ...EPHEMERAL_REPLY,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId('exoneracao_modal_submit')
    .setTitle('SSP — Registrar Exoneração');

  const officerInput = new TextInputBuilder()
    .setCustomId('exoneracao_discord_id')
    .setLabel('Membro do Discord (Menção ou ID):')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Ex: @JohnDoe ou 1510854551593549944')
    .setRequired(true);

  const motivoInput = new TextInputBuilder()
    .setCustomId('exoneracao_motivo')
    .setLabel('Motivo / Justificativa:')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Descreva o motivo administrativo da exoneração...')
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(officerInput),
    new ActionRowBuilder().addComponents(motivoInput)
  );

  await interaction.showModal(modal);
}

async function handleExoneracaoModalSubmit(interaction) {
  await interaction.deferReply(EPHEMERAL_REPLY);

  // Apenas Comando/Administradores
  if (!await canSetupPanels(interaction.member)) {
    return interaction.editReply({
      content: `${emojiHelper.get('stop')} **Acesso Negado:** Apenas o Comando/Diretoria pode registrar exonerações.`,
    });
  }

  const officerInputVal = interaction.fields.getTextInputValue('exoneracao_discord_id').trim();
  const motivo = interaction.fields.getTextInputValue('exoneracao_motivo').trim();

  // Extrair ID do Discord
  const targetUserId = officerInputVal.replace(/\D/g, '');
  if (!targetUserId) {
    return interaction.editReply({
      content: `${emojiHelper.get('stop')} Discord ID ou Menção do oficial inválida.`,
    });
  }

  try {
    const targetMember = await interaction.guild.members.fetch(targetUserId).catch(() => null);
    if (!targetMember) {
      return interaction.editReply({
        content: `${emojiHelper.get('stop')} Não foi possível encontrar este oficial no servidor Discord.`,
      });
    }

    const nickname = targetMember.nickname || '';
    const badgeMatch = nickname.match(/\[(\d+)\]/);
    const citizenId = badgeMatch ? badgeMatch[1] : 'N/A';

    // 1. Criar o registro no banco
    const exoneracao = await Exoneracao.create({
      guildId: interaction.guildId,
      messageId: 'PENDING_' + Date.now(),
      userId: targetUserId,
      citizenId,
      motivo,
      status: 'approved',
      resolvedBy: interaction.user.id,
      resolvedAt: new Date(),
    });

    // 2. Coletar cargos policiais para remover
    const rolesToRemove = new Set();

    // Roles do GuildConfig legado
    const guildConfig = await configService.getOrLoadConfig(interaction.guildId);
    if (guildConfig?.roles) {
      const legacyRoleKeys = ['lspdGeral', 'comandoAdmin', 'ticketStaff', 'policial', 'recrutaCadete', 'caboRole', 'administrativo', 'ministrador'];
      for (const key of legacyRoleKeys) {
        const rid = guildConfig.roles[key];
        if (rid) rolesToRemove.add(rid);
      }
    }

    // Roles de todas as corporações primárias e tags
    const corps = await corporationService.listAll(interaction.guildId);
    for (const corp of corps) {
      if (corp.roles) {
        const corpRoleKeys = ['geral', 'comando', 'staff', 'ministrador', 'administrativo'];
        for (const key of corpRoleKeys) {
          const rid = corp.roles[key];
          if (rid) rolesToRemove.add(rid);
        }
      }
      // Ranks das corporações
      if (corp.ranks) {
        for (const rank of corp.ranks) {
          if (rank.roleId) rolesToRemove.add(rank.roleId);
        }
      }
      // Exclusive ranks
      if (corp.exclusiveRanks) {
        for (const exRank of corp.exclusiveRanks) {
          if (exRank.roleId) rolesToRemove.add(exRank.roleId);
        }
      }
    }

    // Remover todos os cargos que o membro tiver dessa lista
    const memberRoles = [...targetMember.roles.cache.keys()];
    const rolesToStrip = memberRoles.filter(rid => rolesToRemove.has(rid));

    if (rolesToStrip.length > 0) {
      await targetMember.roles.remove(rolesToStrip, 'Oficial Exonerado').catch((err) => {
        logger.error(`Erro ao remover cargos de exoneração de ${targetMember.user.tag}:`, err);
      });
    }

    // Adicionar o cargo de Cidadão
    const cidadaoRoleId = await configService.getRole(interaction.guildId, 'cidadao');
    if (cidadaoRoleId) {
      const cidadaoRole = interaction.guild.roles.cache.get(cidadaoRoleId);
      if (cidadaoRole) {
        await targetMember.roles.add(cidadaoRole).catch(() => null);
      }
    }

    // 3. Enviar log para o canal final de exonerações (1510993738384539729)
    const avatarUrl = targetMember.user.displayAvatarURL({ extension: 'png', size: 256 }) || null;
    const payload = componentFactory.createExoneracaoCardPayload(exoneracao, avatarUrl);

    const targetChannel = interaction.guild.channels.cache.get(EXONERACOES_LOG_CHANNEL_ID) ||
      await interaction.guild.channels.fetch(EXONERACOES_LOG_CHANNEL_ID).catch(() => null) ||
      interaction.channel;

    const logMessage = await targetChannel.send(payload);

    exoneracao.messageId = logMessage.id;
    await exoneracao.save();

    await interaction.editReply({
      content: `${emojiHelper.get('check')} Exoneração do oficial <@${targetUserId}> registrada com sucesso no canal <#${targetChannel.id}> e cargos removidos!`,
    });
  } catch (error) {
    logger.error('Erro ao registrar exoneração:', error);
    await interaction.editReply({
      content: `${emojiHelper.get('stop')} Ocorreu um erro ao processar o registro no banco de dados.`,
    });
  }
}

module.exports = {
  handleExoneracaoButton,
  handleExoneracaoModalSubmit,
};
