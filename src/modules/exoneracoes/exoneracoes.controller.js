const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');

const Exoneracao = require('../../database/models/Exoneracao');
const componentFactory = require('../../utils/componentFactory');
const emojiHelper = require('../../utils/emojiHelper');
const logger = require('../../utils/logger');
const configService = require('../../services/configService');
const corporationService = require('../../services/corporationService');

const {
  canManageExoneracoes,
} = require('../../services/permissionService');

const {
  EPHEMERAL_REPLY,
} = require('../../utils/interactionOptions');

const EXONERACOES_LOG_CHANNEL_ID = '1510993738384539729';

/**
 * Abre o formulário de exoneração.
 */
async function handleExoneracaoButton(interaction) {
  // Verifica se o usuário possui autorização para utilizar o painel.
  if (!await canManageExoneracoes(interaction.member)) {
    return interaction.reply({
      content:
        `${emojiHelper.get('stop')} **Acesso Negado:** ` +
        'Você não possui autorização para registrar exonerações.',
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
    .setPlaceholder(
      'Descreva o motivo administrativo da exoneração...'
    )
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(officerInput),
    new ActionRowBuilder().addComponents(motivoInput)
  );

  return interaction.showModal(modal);
}

/**
 * Processa o envio do formulário de exoneração.
 */
async function handleExoneracaoModalSubmit(interaction) {
  await interaction.deferReply(EPHEMERAL_REPLY);

  // Verifica novamente a permissão antes de concluir a exoneração.
  if (!await canManageExoneracoes(interaction.member)) {
    return interaction.editReply({
      content:
        `${emojiHelper.get('stop')} **Acesso Negado:** ` +
        'Você não possui autorização para registrar exonerações.',
    });
  }

  const officerInputVal = interaction.fields
    .getTextInputValue('exoneracao_discord_id')
    .trim();

  const motivo = interaction.fields
    .getTextInputValue('exoneracao_motivo')
    .trim();

  // Extrai apenas os números da menção ou ID informado.
  const targetUserId = officerInputVal.replace(/\D/g, '');

  if (!targetUserId) {
    return interaction.editReply({
      content:
        `${emojiHelper.get('stop')} ` +
        'Discord ID ou menção do oficial inválida.',
    });
  }

  try {
    const targetMember = await interaction.guild.members
      .fetch(targetUserId)
      .catch(() => null);

    if (!targetMember) {
      return interaction.editReply({
        content:
          `${emojiHelper.get('stop')} ` +
          'Não foi possível encontrar esse oficial no servidor Discord.',
      });
    }

    const nickname = targetMember.nickname || '';
    const badgeMatch = nickname.match(/\[(\d+)\]/);
    const citizenId = badgeMatch ? badgeMatch[1] : 'N/A';

    /*
     * 1. Cria o registro de exoneração no banco de dados.
     */
    const exoneracao = await Exoneracao.create({
      guildId: interaction.guildId,
      messageId: `PENDING_${Date.now()}`,
      userId: targetUserId,
      citizenId,
      motivo,
      status: 'approved',
      resolvedBy: interaction.user.id,
      resolvedAt: new Date(),
    });

    /*
     * 2. Coleta os cargos policiais que devem ser removidos.
     */
    const rolesToRemove = new Set();

    // Cargos do GuildConfig legado.
    const guildConfig = await configService.getOrLoadConfig(
      interaction.guildId
    );

    if (guildConfig?.roles) {
      const legacyRoleKeys = [
        'lspdGeral',
        'comandoAdmin',
        'ticketStaff',
        'policial',
        'recrutaCadete',
        'caboRole',
        'administrativo',
        'ministrador',
      ];

      for (const key of legacyRoleKeys) {
        const roleId = guildConfig.roles[key];

        if (roleId) {
          rolesToRemove.add(roleId);
        }
      }
    }

    // Cargos de todas as corporações cadastradas.
    const corporations = await corporationService.listAll(
      interaction.guildId
    );

    for (const corporation of corporations) {
      if (corporation.roles) {
        const corporationRoleKeys = [
          'geral',
          'comando',
          'staff',
          'ministrador',
          'administrativo',
        ];

        for (const key of corporationRoleKeys) {
          const roleId = corporation.roles[key];

          if (roleId) {
            rolesToRemove.add(roleId);
          }
        }
      }

      // Patentes normais da corporação.
      if (corporation.ranks) {
        for (const rank of corporation.ranks) {
          if (rank.roleId) {
            rolesToRemove.add(rank.roleId);
          }
        }
      }

      // Patentes exclusivas da corporação.
      if (corporation.exclusiveRanks) {
        for (const exclusiveRank of corporation.exclusiveRanks) {
          if (exclusiveRank.roleId) {
            rolesToRemove.add(exclusiveRank.roleId);
          }
        }
      }
    }

    /*
     * Remove apenas os cargos policiais que o membro realmente possui.
     */
    const memberRoleIds = [...targetMember.roles.cache.keys()];

    const rolesToStrip = memberRoleIds.filter((roleId) =>
      rolesToRemove.has(roleId)
    );

    if (rolesToStrip.length > 0) {
      try {
        await targetMember.roles.remove(
          rolesToStrip,
          `Exoneração registrada por ${interaction.user.tag}`
        );
      } catch (error) {
        logger.error(
          `Erro ao remover cargos de ${targetMember.user.tag}:`,
          error
        );

        return interaction.editReply({
          content:
            `${emojiHelper.get('stop')} A exoneração foi registrada, ` +
            'mas não foi possível remover todos os cargos do oficial. ' +
            'Verifique as permissões e a hierarquia do cargo do bot.',
        });
      }
    }

    /*
     * Adiciona o cargo de cidadão, caso esteja configurado.
     */
    const cidadaoRoleId = await configService.getRole(
      interaction.guildId,
      'cidadao'
    );

    if (cidadaoRoleId) {
      const cidadaoRole = interaction.guild.roles.cache.get(
        cidadaoRoleId
      );

      if (cidadaoRole) {
        await targetMember.roles
          .add(
            cidadaoRole,
            `Exoneração registrada por ${interaction.user.tag}`
          )
          .catch((error) => {
            logger.error(
              `Erro ao adicionar o cargo de cidadão em ${targetMember.user.tag}:`,
              error
            );
          });
      }
    }

    /*
     * 3. Envia o registro para o canal de exonerações.
     */
    const avatarUrl = targetMember.user.displayAvatarURL({
      extension: 'png',
      size: 256,
    });

    const payload = componentFactory.createExoneracaoCardPayload(
      exoneracao,
      avatarUrl || null
    );

    const targetChannel =
      interaction.guild.channels.cache.get(
        EXONERACOES_LOG_CHANNEL_ID
      ) ||
      await interaction.guild.channels
        .fetch(EXONERACOES_LOG_CHANNEL_ID)
        .catch(() => null) ||
      interaction.channel;

    if (!targetChannel || !targetChannel.isTextBased()) {
      logger.error(
        'Canal de exonerações não encontrado ou não aceita mensagens.'
      );

      return interaction.editReply({
        content:
          `${emojiHelper.get('stop')} A exoneração foi processada, ` +
          'mas não foi possível enviar o registro para o canal de logs.',
      });
    }

    const logMessage = await targetChannel.send(payload);

    exoneracao.messageId = logMessage.id;
    await exoneracao.save();

    return interaction.editReply({
      content:
        `${emojiHelper.get('check')} Exoneração do oficial ` +
        `<@${targetUserId}> registrada com sucesso no canal ` +
        `<#${targetChannel.id}>. Os cargos policiais foram removidos.`,
    });
  } catch (error) {
    logger.error('Erro ao registrar exoneração:', error);

    return interaction.editReply({
      content:
        `${emojiHelper.get('stop')} Ocorreu um erro ao processar ` +
        'a exoneração. Verifique os registros do bot.',
    });
  }
}

module.exports = {
  handleExoneracaoButton,
  handleExoneracaoModalSubmit,
};