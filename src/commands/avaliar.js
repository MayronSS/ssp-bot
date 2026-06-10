const { SlashCommandBuilder } = require('discord.js');
const { canEvaluate } = require('../services/permissionService');
const logService = require('../services/logService');
const { createErrorEmbed, createSuccessEmbed } = require('../utils/createEmbed');
const { EPHEMERAL_REPLY } = require('../utils/interactionOptions');
const Member = require('../database/models/Member');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('avaliar')
    .setDescription('Avalia o desempenho de um oficial da corporação.')
    .addUserOption((option) =>
      option
        .setName('oficial')
        .setDescription('O oficial a ser avaliado')
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName('nota')
        .setDescription('Nota da avaliação (1 a 5 estrelas)')
        .setRequired(true)
        .addChoices(
          { name: '⭐ (1)', value: 1 },
          { name: '⭐⭐ (2)', value: 2 },
          { name: '⭐⭐⭐ (3)', value: 3 },
          { name: '⭐⭐⭐⭐ (4)', value: 4 },
          { name: '⭐⭐⭐⭐⭐ (5)', value: 5 }
        )
    )
    .addStringOption((option) =>
      option
        .setName('motivo')
        .setDescription('O motivo ou feedback da avaliação')
        .setRequired(true)
    ),

  async execute(interaction) {
    // 1. Verificar permissão (Cabo ou acima)
    if (!await canEvaluate(interaction.member)) {
      return interaction.reply({
        embeds: [createErrorEmbed('Sem Permissão', 'Apenas oficiais Cabo ou acima possuem autorização para avaliar.')],
        ...EPHEMERAL_REPLY,
      });
    }

    const targetUser = interaction.options.getUser('oficial');
    const nota = interaction.options.getInteger('nota');
    const motivo = interaction.options.getString('motivo');

    // 2. Validações
    if (targetUser.bot) {
      return interaction.reply({
        embeds: [createErrorEmbed('Erro de Validação', 'Você não pode avaliar um bot.')],
        ...EPHEMERAL_REPLY,
      });
    }

    await interaction.deferReply(EPHEMERAL_REPLY);

    try {
      // 3. Atualizar estatísticas do avaliador no MongoDB
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

      // 4. Atualizar estatísticas do avaliado no MongoDB
      let targetDb = await Member.findOne({ discordUserId: targetUser.id });
      if (!targetDb) {
        targetDb = await Member.create({
          discordUserId: targetUser.id,
          username: targetUser.username,
          avatarUrl: targetUser.displayAvatarURL({ dynamic: true }) || null
        });
      }
      targetDb.avaliacoesRecebidas = (targetDb.avaliacoesRecebidas || 0) + 1;
      await targetDb.save();

      // 5. Enviar log para o Discord (#log-membros / memberLogs)
      await logService.logEvaluationCreated(interaction.client, {
        evaluatorId: interaction.user.id,
        targetId: targetUser.id,
        rating: nota,
        comment: motivo
      });

      // 6. Responder com sucesso
      const successEmbed = createSuccessEmbed(
        'Avaliação Registrada',
        `A avaliação do oficial <@${targetUser.id}> foi concluída com sucesso!\n\n` +
        `**Nota:** ${'⭐'.repeat(nota)} (${nota}/5)\n` +
        `**Feedback:** ${motivo}\n\n` +
        `*Esta métrica foi atualizada no banco de dados e aparecerá no Painel Web.*`
      );

      await interaction.editReply({ embeds: [successEmbed] });

    } catch (error) {
      logger.error('Erro ao registrar avaliação:', error);
      await interaction.editReply({
        embeds: [createErrorEmbed('Erro Interno', `Não foi possível salvar a avaliação: ${error.message}`)]
      });
    }
  }
};
