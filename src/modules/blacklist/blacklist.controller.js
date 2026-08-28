const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const Blacklist = require('../../database/models/Blacklist');
const componentFactory = require('../../utils/componentFactory');
const emojiHelper = require('../../utils/emojiHelper');
const logger = require('../../utils/logger');
const { canApplyWarnings } = require('../../services/permissionService');
const { EPHEMERAL_REPLY } = require('../../utils/interactionOptions');

async function handleConsultarBlacklistButton(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('blacklist_consultar_modal')
    .setTitle('SSP — Consulta Blacklist');

  const input = new TextInputBuilder()
    .setCustomId('blacklist_search_query')
    .setLabel('Discord ID ou Menção:')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Ex: @JohnDoe ou 1510854551593549944')
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

async function handleConsultarModalSubmit(interaction) {
  await interaction.deferReply(EPHEMERAL_REPLY);
  const query = interaction.fields.getTextInputValue('blacklist_search_query').trim();

  try {
    const cleanQuery = query.replace(/\D/g, '');
    const searchConditions = [
      { passaporte: query }
    ];
    if (cleanQuery) {
      searchConditions.push({ discordId: cleanQuery });
    }

    // Buscar por passaporte OU discordId
    const entry = await Blacklist.findOne({
      guildId: interaction.guildId,
      $or: searchConditions
    });

    if (entry) {
      const passVal = entry.passaporte === entry.discordId ? 'Não informado' : entry.passaporte;
      return interaction.editReply({
        content: `🚨 **Cidadão Encontrado na Blacklist!**\n\n` +
          `> **Nome RP:** ${entry.nomeRp}\n` +
          `> **Citizen ID:** \`${passVal}\`\n` +
          `> **Discord:** ${entry.discordId ? `<@${entry.discordId}>` : 'Não vinculado'}\n` +
          `> **Registrado por:** ${entry.addedBy}\n` +
          `> **Data:** <t:${Math.floor(entry.createdAt.getTime() / 1000)}:f>\n` +
          `> **Motivo:** ${entry.motivo}`,
      });
    } else {
      return interaction.editReply({
        content: `${emojiHelper.get('check')} **Nenhum registro encontrado.** O Discord/Citizen ID \`${query}\` está liberado e não consta na blacklist.`,
      });
    }
  } catch (error) {
    logger.error('Erro ao consultar blacklist:', error);
    await interaction.editReply({
      content: `${emojiHelper.get('stop')} Ocorreu um erro ao consultar o banco de dados.`,
    });
  }
}

async function handleAdicionarBlacklistButton(interaction) {
  if (!await canApplyWarnings(interaction.member)) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} **Acesso Negado:** Apenas oficiais superiores autorizados podem registrar pessoas na Blacklist.`,
      ...EPHEMERAL_REPLY,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId('blacklist_adicionar_modal')
    .setTitle('SSP — Registrar em Blacklist');

  const discordInput = new TextInputBuilder()
    .setCustomId('blacklist_discord')
    .setLabel('Discord ID ou Menção do Infrator:')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Ex: @JohnDoe ou 1510854551593549944')
    .setRequired(true);

  const nomeRpInput = new TextInputBuilder()
    .setCustomId('blacklist_nome_rp')
    .setLabel('Nome RP:')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Ex: John Doe')
    .setRequired(true);

  const motivoInput = new TextInputBuilder()
    .setCustomId('blacklist_motivo')
    .setLabel('Motivo / Justificativa:')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Descreva os motivos que levaram a inclusão na blacklist...')
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(discordInput),
    new ActionRowBuilder().addComponents(nomeRpInput),
    new ActionRowBuilder().addComponents(motivoInput)
  );

  await interaction.showModal(modal);
}

async function handleAdicionarModalSubmit(interaction) {
  await interaction.deferReply(EPHEMERAL_REPLY);

  const discordInput = interaction.fields.getTextInputValue('blacklist_discord').trim();
  const nomeRp = interaction.fields.getTextInputValue('blacklist_nome_rp').trim();
  const motivo = interaction.fields.getTextInputValue('blacklist_motivo').trim();

  const discordId = discordInput.replace(/\D/g, '');
  if (!discordId) {
    return interaction.editReply({
      content: `${emojiHelper.get('stop')} **Erro:** Discord ID ou Menção do infrator é inválida.`,
    });
  }

  // Usamos o Discord ID como passaporte para garantir unicidade no índice sem Citizen ID
  const passaporte = discordId;

  try {
    const existing = await Blacklist.findOne({
      guildId: interaction.guildId,
      $or: [
        { discordId },
        { passaporte }
      ]
    });

    if (existing) {
      return interaction.editReply({
        content: `${emojiHelper.get('stop')} Este usuário já está registrado na Blacklist por **${existing.addedBy}**.`,
      });
    }

    const entry = await Blacklist.create({
      guildId: interaction.guildId,
      passaporte,
      discordId,
      nomeRp,
      motivo,
      addedBy: interaction.user.username,
    });

    const payload = componentFactory.createBlacklistEntryPayload(entry);
    await interaction.channel.send(payload);

    await interaction.editReply({
      content: `${emojiHelper.get('check')} O infrator <@${discordId}> foi adicionado à Blacklist com sucesso e o log foi publicado!`,
    });
  } catch (error) {
    logger.error('Erro ao adicionar na blacklist:', error);
    await interaction.editReply({
      content: `${emojiHelper.get('stop')} Ocorreu um erro ao salvar o registro no banco de dados.`,
    });
  }
}

module.exports = {
  handleConsultarBlacklistButton,
  handleConsultarModalSubmit,
  handleAdicionarBlacklistButton,
  handleAdicionarModalSubmit,
};
