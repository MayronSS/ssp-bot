const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const InternalRequest = require('../../database/models/InternalRequest');
const componentFactory = require('../../utils/componentFactory');
const emojiHelper = require('../../utils/emojiHelper');
const logger = require('../../utils/logger');
const logService = require('../../services/logService');
const { canSetupPanels } = require('../../services/permissionService');
const { EPHEMERAL_REPLY } = require('../../utils/interactionOptions');

const ALTO_COMANDO_LOG_CHANNEL_ID = '1510989745076043786';

async function handleEnviarSolicitacaoButton(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('solicitacao_interna_modal')
    .setTitle('SSP — Solicitação Interna');

  const assuntoInput = new TextInputBuilder()
    .setCustomId('solicitacao_assunto')
    .setLabel('Assunto / Tópico:')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Ex: Solicitação de viaturas, Verba para fardamento...')
    .setRequired(true);

  const descricaoInput = new TextInputBuilder()
    .setCustomId('solicitacao_descricao')
    .setLabel('Descrição detalhada / Justificativa:')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Descreva os detalhes da sua solicitação...')
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(assuntoInput),
    new ActionRowBuilder().addComponents(descricaoInput)
  );

  await interaction.showModal(modal);
}

async function handleSolicitacaoModalSubmit(interaction) {
  await interaction.deferReply(EPHEMERAL_REPLY);

  const assunto = interaction.fields.getTextInputValue('solicitacao_assunto').trim();
  const descricao = interaction.fields.getTextInputValue('solicitacao_descricao').trim();

  // Captura automática de batalhão a partir dos cargos
  const affiliation = logService.resolveMemberAffiliation(interaction.member);
  const batalhao = affiliation.battalion || affiliation.corporation || 'Geral';

  try {
    const request = await InternalRequest.create({
      guildId: interaction.guildId,
      messageId: 'PENDING_' + Date.now(),
      userId: interaction.user.id,
      batalhao,
      assunto,
      descricao,
      status: 'pending',
    });

    const avatarUrl = interaction.user.displayAvatarURL({ extension: 'png', size: 256 }) || null;
    const payload = componentFactory.createSolicitacaoCardPayload(request, avatarUrl);
    
    // Tentar enviar no canal do Alto Comando
    const targetChannel = interaction.guild.channels.cache.get(ALTO_COMANDO_LOG_CHANNEL_ID) ||
      await interaction.guild.channels.fetch(ALTO_COMANDO_LOG_CHANNEL_ID).catch(() => null) ||
      interaction.channel;

    const cardMessage = await targetChannel.send(payload);

    request.messageId = cardMessage.id;
    await request.save();

    await interaction.editReply({
      content: `${emojiHelper.get('check')} Sua solicitação foi registrada e enviada para o canal de análise do Alto Comando com sucesso!`,
    });
  } catch (error) {
    logger.error('Erro ao criar solicitação interna:', error);
    await interaction.editReply({
      content: `${emojiHelper.get('stop')} Ocorreu um erro ao salvar o registro no banco de dados.`,
    });
  }
}

async function handleSolicitacaoDecide(interaction) {
  const [action, requestId] = interaction.customId.split(':');
  const isApprove = action === 'solicitacao_interna_aprovar';

  // Verificar se o membro é do Alto Comando (canSetupPanels ou ROLE_COMMAND)
  if (!await canSetupPanels(interaction.member)) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} **Acesso Negado:** Apenas membros do Alto Comando podem aprovar ou recusar solicitações internas.`,
      ...EPHEMERAL_REPLY,
    });
  }

  try {
    const request = await InternalRequest.findById(requestId);
    if (!request) {
      return interaction.reply({
        content: `${emojiHelper.get('stop')} Solicitação não encontrada no banco de dados.`,
        ...EPHEMERAL_REPLY,
      });
    }

    request.status = isApprove ? 'approved' : 'rejected';
    request.resolvedBy = interaction.user.username;
    request.resolvedAt = new Date();

    await request.save();

    // Obter avatar do solicitante para atualizar o embed
    const requester = await interaction.guild.members.fetch(request.userId).catch(() => null);
    const avatarUrl = requester?.user.displayAvatarURL({ extension: 'png', size: 256 }) || null;

    // Atualizar mensagem
    const payload = componentFactory.createSolicitacaoCardPayload(request, avatarUrl);
    await interaction.update(payload);
  } catch (error) {
    logger.error('Erro ao resolver solicitação interna:', error);
    await interaction.reply({
      content: `${emojiHelper.get('stop')} Não foi possível atualizar o status da solicitação.`,
      ...EPHEMERAL_REPLY,
    });
  }
}

module.exports = {
  handleEnviarSolicitacaoButton,
  handleSolicitacaoModalSubmit,
  handleSolicitacaoDecide,
};
