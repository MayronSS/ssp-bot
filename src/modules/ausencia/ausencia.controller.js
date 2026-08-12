const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
} = require('discord.js');
const ausenciaService = require('./ausencia.service');
const { canRequestAbsence, canManagePonto } = require('../../services/permissionService');
const emojiHelper = require('../../utils/emojiHelper');
const { EPHEMERAL_REPLY } = require('../../utils/interactionOptions');
const logger = require('../../utils/logger');

/**
 * Handle: ausencia_solicitar (Button)
 * Abre o modal de solicitação de ausência se tiver permissão.
 */
async function handleSolicitarButton(interaction, corpSlug) {
  interaction._corpSlug = corpSlug || 'pmesp';
  const { member } = interaction;

  // Verificar se o usuário pode registrar ausência
  const autorizado = await canRequestAbsence(member);
  if (!autorizado) {
    return interaction.reply({
      content: `${emojiHelper.get('error') || '❌'} **Acesso Negado:** Você não possui permissão para registrar ausências.`,
      ...EPHEMERAL_REPLY,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId('modal_solicitar_ausencia')
    .setTitle('SSP | Solicitação de Ausência');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('aus_data_inicio')
        .setLabel('Data de Início (DD/MM/AAAA)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('Ex: 28/05/2026')
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('aus_data_fim')
        .setLabel('Data de Fim (DD/MM/AAAA)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('Ex: 05/06/2026')
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('aus_motivo')
        .setLabel('Motivo do Afastamento')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setPlaceholder('Explique detalhadamente o motivo da sua ausência...')
    )
  );

  await interaction.showModal(modal);
}

/**
 * Handle: modal_solicitar_ausencia (ModalSubmit)
 * Valida os dados de data e inicia o processo de registro de ausência.
 */
async function handleModalSubmit(interaction) {
  await interaction.deferReply(EPHEMERAL_REPLY);

  const dataInicio = interaction.fields.getTextInputValue('aus_data_inicio');
  const dataFim = interaction.fields.getTextInputValue('aus_data_fim');
  const motivo = interaction.fields.getTextInputValue('aus_motivo');

  // Auto-detectar corporação pelos cargos do membro
  const corporationService = require('../../services/corporationService');
  const corpDoc = await corporationService.getByMemberRoles(interaction.member);
  const corporationSlug = corpDoc ? corpDoc.slug : 'pmesp';
  const corpLabel = corpDoc ? corpDoc.shortName : 'PMESP';

  // Nome puxado automaticamente pelo apelido/displayName do Discord
  const nomeRp = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;

  // Validação simples de datas DD/MM/AAAA
  const dateRegex = /^\d{2}\/\d{2}\/\d{4}$/;
  if (!dateRegex.test(dataInicio) || !dateRegex.test(dataFim)) {
    return interaction.editReply({
      content: `${emojiHelper.get('error') || '❌'} **Erro de Formatação:** As datas devem seguir estritamente o formato \`DD/MM/AAAA\`.`,
    });
  }

  try {
    const ausencia = await ausenciaService.registrarSolicitacao(interaction, {
      corporacao: corpLabel,
      corporationSlug,
      nomeRp,
      motivo,
      dataInicio,
      dataFim,
    });

    await interaction.editReply({
      content: `${emojiHelper.get('success') || '✅'} **Solicitação de Ausência enviada com sucesso!**\n` +
               `> Corporação detectada: **${corpLabel}**\n` +
               `> Sua solicitação de licença entre **${dataInicio}** e **${dataFim}** (${ausencia.duracaoDias} dia(s)) foi enviada para análise do Comando.`,
    });
  } catch (error) {
    logger.error('Erro ao processar modal de ausência:', error);
    await interaction.editReply({
      content: `${emojiHelper.get('error') || '❌'} Ocorreu um erro ao processar sua solicitação.`,
    });
  }
}

/**
 * Handle: ausencia_aprovar_<id> (Button)
 * Aprova a ausência.
 */
async function handleApproveButton(interaction) {
  const { member } = interaction;

  // Apenas membros autorizados (Comando/Staff) podem aprovar/reprovar
  const autorizado = await canManagePonto(member);
  if (!autorizado) {
    return interaction.reply({
      content: `${emojiHelper.get('error') || '❌'} **Sem Permissão:** Apenas membros do Comando podem decidir sobre ausências.`,
      ...EPHEMERAL_REPLY,
    });
  }

  await interaction.deferReply(EPHEMERAL_REPLY);
  const ausenciaId = interaction.customId.split('_')[2];

  try {
    await ausenciaService.aprovarAusencia(interaction, ausenciaId);
    await interaction.editReply({
      content: `${emojiHelper.get('success') || '✅'} Solicitação de ausência aprovada com sucesso!`,
    });
  } catch (error) {
    logger.error(`Erro ao aprovar ausência ${ausenciaId}:`, error);
    await interaction.editReply({
      content: `${emojiHelper.get('error') || '❌'} Erro: ${error.message}`,
    });
  }
}

/**
 * Handle: ausencia_reprovar_<id> (Button)
 * Abre o modal solicitando a justificativa da reprovação.
 */
async function handleRejectButton(interaction) {
  const { member } = interaction;

  const autorizado = await canManagePonto(member);
  if (!autorizado) {
    return interaction.reply({
      content: `${emojiHelper.get('error') || '❌'} **Sem Permissão:** Apenas membros do Comando podem decidir sobre ausências.`,
      ...EPHEMERAL_REPLY,
    });
  }

  const ausenciaId = interaction.customId.split('_')[2];

  const modal = new ModalBuilder()
    .setCustomId(`modal_reprovar_ausencia_${ausenciaId}`)
    .setTitle('Reprovar Ausência');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('aus_motivo_rejeicao')
        .setLabel('Motivo da Reprovação')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setPlaceholder('Informe o motivo pelo qual esta ausência foi negada...')
    )
  );

  await interaction.showModal(modal);
}

/**
 * Handle: modal_reprovar_ausencia_<id> (ModalSubmit)
 * Finaliza a reprovação no banco e atualiza o log.
 */
async function handleRejectModalSubmit(interaction) {
  await interaction.deferReply(EPHEMERAL_REPLY);

  const ausenciaId = interaction.customId.split('_')[3];
  const motivo = interaction.fields.getTextInputValue('aus_motivo_rejeicao');

  try {
    await ausenciaService.reprovarAusencia(interaction, ausenciaId, motivo);
    await interaction.editReply({
      content: `${emojiHelper.get('success') || '✅'} Solicitação de ausência reprovada com sucesso.`,
    });
  } catch (error) {
    logger.error(`Erro ao reprovar ausência ${ausenciaId}:`, error);
    await interaction.editReply({
      content: `${emojiHelper.get('error') || '❌'} Erro: ${error.message}`,
    });
  }
}

module.exports = {
  handleSolicitarButton,
  handleModalSubmit,
  handleApproveButton,
  handleRejectButton,
  handleRejectModalSubmit,
};
