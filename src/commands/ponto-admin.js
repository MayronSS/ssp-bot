const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const pontoService = require('../modules/ponto/ponto.service');
const { canManagePonto } = require('../services/permissionService');
const { EPHEMERAL_REPLY } = require('../utils/interactionOptions');
const logger = require('../utils/logger');

const COLORS = {
  success: 0x2ecc71,
  warning: 0xffab00,
  danger: 0xe74c3c,
};

function isSaveMode(interaction) {
  return interaction.options.getString('modo', true) === 'salvar';
}

function sanitizeReason(reason) {
  const text = String(reason || '').trim();
  return text ? text.slice(0, 300) : null;
}

function buildResultEmbed({ title, targetUser, result, saveHours, reason, all = false }) {
  const hasClosed = result.closedCount > 0;
  const modeLabel = saveHours ? 'Salvar horas' : 'Nao salvar horas';

  const embed = new EmbedBuilder()
    .setColor(hasClosed ? COLORS.success : COLORS.warning)
    .setTitle(title)
    .setTimestamp();

  if (!hasClosed) {
    embed.setDescription(all
      ? 'Nenhum ponto aberto foi encontrado.'
      : `Nenhum ponto aberto foi encontrado para <@${targetUser.id}>.`);
    return embed;
  }

  const description = [
    all ? 'Encerramento geral concluido.' : `Ponto encerrado para <@${targetUser.id}>.`,
    `Modo: **${modeLabel}**`,
    `Registros fechados: **${result.closedCount}**`,
    `Tempo real: **${pontoService.formatDurationWithSeconds(result.totalDurationMs)}**`,
    `Horas contabilizadas: **${pontoService.formatDurationWithSeconds(result.savedDurationMs)}**`,
    reason ? `Motivo: ${reason}` : null,
  ].filter(Boolean).join('\n');

  embed.setDescription(description);

  if (all) {
    const preview = result.entries.slice(0, 10).map((entry, index) =>
      `${index + 1}. <@${entry.user.id}> - ${pontoService.formatDurationWithSeconds(entry.durationMs)}`
    ).join('\n');

    if (preview) {
      embed.addFields({
        name: result.entries.length > 10 ? 'Primeiros registros' : 'Registros',
        value: result.entries.length > 10
          ? `${preview}\n... e mais ${result.entries.length - 10}`
          : preview,
        inline: false,
      });
    }
  }

  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ponto-admin')
    .setDescription('Gerencia pontos abertos da LSPD')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('encerrar')
        .setDescription('Encerra o ponto aberto de um oficial')
        .addUserOption((option) =>
          option
            .setName('usuario')
            .setDescription('Oficial que tera o ponto encerrado')
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName('modo')
            .setDescription('Define se as horas serao contabilizadas')
            .setRequired(true)
            .addChoices(
              { name: 'Salvar horas', value: 'salvar' },
              { name: 'Nao salvar horas', value: 'descartar' }
            )
        )
        .addStringOption((option) =>
          option
            .setName('motivo')
            .setDescription('Motivo opcional para o log administrativo')
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('encerrar-todos')
        .setDescription('Encerra todos os pontos abertos')
        .addStringOption((option) =>
          option
            .setName('modo')
            .setDescription('Define se as horas serao contabilizadas')
            .setRequired(true)
            .addChoices(
              { name: 'Salvar horas', value: 'salvar' },
              { name: 'Nao salvar horas', value: 'descartar' }
            )
        )
        .addStringOption((option) =>
          option
            .setName('motivo')
            .setDescription('Motivo opcional para o log administrativo')
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    if (!await canManagePonto(interaction.member)) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.danger)
            .setTitle('Sem permissao')
            .setDescription('Voce nao possui autorizacao para gerenciar pontos.'),
        ],
        ...EPHEMERAL_REPLY,
      });
    }

    await interaction.deferReply(EPHEMERAL_REPLY);

    const subcommand = interaction.options.getSubcommand();
    const saveHours = isSaveMode(interaction);
    const reason = sanitizeReason(interaction.options.getString('motivo'));

    try {
      if (subcommand === 'encerrar') {
        const targetUser = interaction.options.getUser('usuario', true);
        const result = await pontoService.encerrarPontoUsuario({
          guild: interaction.guild,
          targetUser,
          actorUser: interaction.user,
          saveHours,
          reason,
        });

        return interaction.editReply({
          embeds: [buildResultEmbed({
            title: 'Ponto encerrado',
            targetUser,
            result,
            saveHours,
            reason,
          })],
          allowedMentions: { users: [], roles: [] },
        });
      }

      const result = await pontoService.encerrarTodosPontos({
        guild: interaction.guild,
        actorUser: interaction.user,
        saveHours,
        reason,
      });

      return interaction.editReply({
        embeds: [buildResultEmbed({
          title: 'Pontos encerrados',
          result,
          saveHours,
          reason,
          all: true,
        })],
        allowedMentions: { users: [], roles: [] },
      });
    } catch (error) {
      logger.error('Erro ao executar comando administrativo de ponto:', error);
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.danger)
            .setTitle('Erro ao encerrar ponto')
            .setDescription('Nao foi possivel concluir a operacao agora.'),
        ],
      });
    }
  },
};
