const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { canSetupPanels } = require('../services/permissionService');
const { createErrorEmbed, createSuccessEmbed, createBaseEmbed } = require('../utils/createEmbed');
const logger = require('../utils/logger');
const { EPHEMERAL_REPLY } = require('../utils/interactionOptions');
const corporationsConfig = require('../config/corporations');
const corporationService = require('../services/corporationService');
const settings = require('../config/settings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reset-servidor')
    .setDescription('Deleta canais e/ou cargos criados pelo bot')
    .addStringOption((option) =>
      option
        .setName('escopo')
        .setDescription('O que deseja deletar?')
        .setRequired(true)
        .addChoices(
          { name: 'Canais — Deleta categorias e canais do bot', value: 'canais' },
          { name: 'Cargos — Deleta patentes, separadores e cargos do sistema', value: 'cargos' },
          { name: 'Tudo — Deleta canais + cargos', value: 'tudo' }
        )
    ),

  async execute(interaction) {
    if (!await canSetupPanels(interaction.member)) {
      return interaction.reply({
        embeds: [createErrorEmbed('Sem Permissão', 'Você não possui autorização para executar este comando.')],
        ...EPHEMERAL_REPLY,
      });
    }

    const escopo = interaction.options.getString('escopo');
    const scopeLabels = { canais: 'Canais', cargos: 'Cargos', tudo: 'Canais + Cargos' };

    const confirmEmbed = createBaseEmbed({
      title: '🗑️ Confirmar Reset do Servidor',
      color: settings.colors.danger,
      description: [
        `**Escopo:** ${scopeLabels[escopo]}`,
        '',
        '⚠️ **Esta ação é irreversível!**',
        '',
        escopo === 'canais' || escopo === 'tudo'
          ? '• Todas as categorias e canais criados pelo bot serão deletados'
          : '',
        escopo === 'cargos' || escopo === 'tudo'
          ? '• Todas as patentes, separadores e cargos do sistema serão deletados'
          : '',
        '',
        'Deseja continuar?',
      ].filter(Boolean).join('\n'),
      timestamp: true,
    });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('reset_confirmar')
        .setLabel('Sim, deletar tudo')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🗑️'),
      new ButtonBuilder()
        .setCustomId('reset_cancelar')
        .setLabel('Cancelar')
        .setStyle(ButtonStyle.Secondary),
    );

    const reply = await interaction.reply({
      embeds: [confirmEmbed],
      components: [row],
      ...EPHEMERAL_REPLY,
    });

    try {
      const confirmation = await reply.awaitMessageComponent({
        filter: (i) => i.user.id === interaction.user.id,
        time: 30_000,
      });

      if (confirmation.customId === 'reset_cancelar') {
        return confirmation.update({
          embeds: [createErrorEmbed('Cancelado', 'O reset foi cancelado.')],
          components: [],
        });
      }

      await confirmation.update({
        embeds: [createBaseEmbed({
          title: '⏳ Processando Reset...',
          color: settings.colors.warning,
          description: 'Deletando recursos do servidor. Isso pode levar alguns segundos...',
        })],
        components: [],
      });

      const results = { deletedChannels: 0, deletedRoles: 0, errors: [] };
      const guild = interaction.guild;
      const guildId = guild.id;

      // Atualizar cache
      await guild.channels.fetch();
      await guild.roles.fetch();

      if (escopo === 'canais' || escopo === 'tudo') {
        await deleteChannels(guild, results);
      }

      if (escopo === 'cargos' || escopo === 'tudo') {
        await deleteRoles(guild, results);
      }

      // Limpar banco de dados
      await cleanDatabase(guildId, escopo);

      // Resposta final
      let summary = `🗑️ **Reset concluído!**\n\n`;

      if (escopo === 'canais' || escopo === 'tudo') {
        summary += `📁 **Canais deletados:** ${results.deletedChannels}\n`;
      }
      if (escopo === 'cargos' || escopo === 'tudo') {
        summary += `🏷️ **Cargos deletados:** ${results.deletedRoles}\n`;
      }
      if (results.errors.length > 0) {
        summary += `\n❌ **Erros (${results.errors.length}):**\n${results.errors.slice(0, 10).map(e => `• ${e}`).join('\n')}`;
        if (results.errors.length > 10) summary += `\n• ... e mais ${results.errors.length - 10}`;
      }

      try {
        await interaction.editReply({
          embeds: [createSuccessEmbed('Reset do Servidor', summary)],
          components: [],
        });
      } catch (replyErr) {
        // Enviar por DM para o usuário se o canal foi deletado
        await interaction.user.send({
          embeds: [createSuccessEmbed('Reset do Servidor', `${summary}\n\n*(Nota: Esta mensagem foi enviada via DM porque o canal onde o comando foi executado foi deletado durante o reset)*`)],
        }).catch(() => {
          logger.warn(`Não foi possível enviar DM de reset para ${interaction.user.tag}`);
        });
      }

    } catch (err) {
      if (err.code === 'InteractionCollectorError') {
        try {
          return await interaction.editReply({
            embeds: [createErrorEmbed('Tempo Expirado', 'Você não confirmou a tempo. Reset cancelado.')],
            components: [],
          });
        } catch (e) {}
        return;
      }
      logger.error('Erro no reset:', err);
      try {
        await interaction.editReply({
          embeds: [createErrorEmbed('Erro', `Ocorreu um erro: ${err.message}`)],
          components: [],
        });
      } catch (e) {
        await interaction.user.send({
          embeds: [createErrorEmbed('Erro no Reset', `Ocorreu um erro ao resetar o servidor: ${err.message}\n\n*(Nota: Esta DM foi enviada porque o canal original foi deletado)*`)],
        }).catch(() => {});
      }
    }
  },
};

/**
 * Deleta canais e categorias criados pelo bot.
 */
async function deleteChannels(guild, results) {
  // Coletar nomes de categorias que o bot cria (novos e antigos)
  const categoryNames = new Set();

  // Categorias SSP unificadas (padrão atual)
  for (const group of Object.values(corporationsConfig.sharedChannelTemplate)) {
    categoryNames.add(group.category.toLowerCase());
  }

  // Padrões antigos que precisam ser limpos
  for (const corpConfig of corporationsConfig.corporations) {
    // Padrão antigo separado por corp
    categoryNames.add(`📄・tickets ${corpConfig.shortName}`.toLowerCase());
    categoryNames.add(`📄・operacional ${corpConfig.shortName}`.toLowerCase());
    categoryNames.add(`📄・corregedoria ${corpConfig.shortName}`.toLowerCase());
    categoryNames.add(`📄・logs ${corpConfig.shortName}`.toLowerCase());
    categoryNames.add(`📄・atendimento ${corpConfig.shortName}`.toLowerCase());
    // Sem emoji
    categoryNames.add(`tickets ${corpConfig.shortName}`.toLowerCase());
    categoryNames.add(`operacional ${corpConfig.shortName}`.toLowerCase());
    categoryNames.add(`corregedoria ${corpConfig.shortName}`.toLowerCase());
    categoryNames.add(`logs ${corpConfig.shortName}`.toLowerCase());
  }

  // Buscar categorias e seus canais filhos
  for (const channel of guild.channels.cache.values()) {
    if (channel.type === 2) continue; // Ignorar canais de voz
    if (channel.type === 4) { // Categoria
      if (categoryNames.has(channel.name.toLowerCase())) {
        // Deletar todos os filhos primeiro
        const children = guild.channels.cache.filter(c => c.parentId === channel.id);
        for (const child of children.values()) {
          try {
            await child.delete('Reset do servidor pelo bot');
            results.deletedChannels++;
          } catch (err) {
            results.errors.push(`Canal ${child.name}: ${err.message}`);
          }
        }

        // Deletar a categoria
        try {
          await channel.delete('Reset do servidor pelo bot');
          results.deletedChannels++;
        } catch (err) {
          results.errors.push(`Categoria ${channel.name}: ${err.message}`);
        }
      }
    }
  }
}

/**
 * Deleta cargos criados pelo bot.
 */
async function deleteRoles(guild, results) {
  const roleNamesToDelete = new Set();

  // Separadores
  for (const sep of corporationsConfig.separatorRoles) {
    roleNamesToDelete.add(sep.name.toLowerCase());
  }

  // Cargos compartilhados
  for (const shared of corporationsConfig.sharedRoles) {
    roleNamesToDelete.add(shared.name.toLowerCase());
  }

  // Cargos por corporação
  for (const corpConfig of corporationsConfig.corporations) {
    // Sistema
    for (const roleName of Object.values(corpConfig.systemRoles)) {
      roleNamesToDelete.add(roleName.toLowerCase());
    }
    // Patentes
    for (const rank of corpConfig.ranks) {
      const roleEmoji = (rank.emoji && !rank.emoji.includes(':')) ? rank.emoji : '👮';
      roleNamesToDelete.add(`${roleEmoji} ┃ ${rank.name}`.toLowerCase());
    }
  }

  // Tags
  for (const tag of corporationsConfig.tags) {
    roleNamesToDelete.add(tag.tagRole.toLowerCase());
    if (tag.exclusiveRanks) {
      for (const excl of tag.exclusiveRanks) {
        roleNamesToDelete.add(excl.roleName.toLowerCase());
      }
    }
  }

  // Padrão antigo (com 🔵/🔴)
  roleNamesToDelete.add('🔵 ┃ pmesp');
  roleNamesToDelete.add('🔴 ┃ pcesp');
  roleNamesToDelete.add('───────── 🔵 pmesp ─────────');
  roleNamesToDelete.add('───────── 🔴 pcesp ─────────');

  // Deletar os cargos
  for (const role of guild.roles.cache.values()) {
    if (role.managed || role.id === guild.id) continue; // Ignorar @everyone e bots

    const normalized = role.name.toLowerCase().trim();
    if (roleNamesToDelete.has(normalized)) {
      try {
        await role.delete('Reset do servidor pelo bot');
        results.deletedRoles++;
      } catch (err) {
        results.errors.push(`Cargo ${role.name}: ${err.message}`);
      }
    }
  }
}

/**
 * Limpa dados do banco.
 */
async function cleanDatabase(guildId, escopo) {
  try {
    const Corporation = require('../database/models/Corporation');

    if (escopo === 'canais' || escopo === 'tudo') {
      await Corporation.updateMany(
        { guildId },
        { $set: { channels: {} } }
      );

      try {
        const GuildConfig = require('../database/models/GuildConfig');
        await GuildConfig.updateOne(
          { guildId },
          { $set: { channels: {} } }
        );
      } catch (e) { /* ignore */ }
    }

    if (escopo === 'cargos' || escopo === 'tudo') {
      await Corporation.updateMany(
        { guildId },
        {
          $set: {
            roles: {},
            'ranks.$[].roleId': null,
          },
        }
      );

      try {
        const GuildConfig = require('../database/models/GuildConfig');
        await GuildConfig.updateOne(
          { guildId },
          { $set: { roles: {} } }
        );
      } catch (e) { /* ignore */ }
    }

    corporationService.invalidateCache(guildId);
    logger.info(`[Reset] Banco de dados limpo (escopo: ${escopo}) para guild ${guildId}`);
  } catch (err) {
    logger.error('[Reset] Erro ao limpar banco:', err);
  }
}
