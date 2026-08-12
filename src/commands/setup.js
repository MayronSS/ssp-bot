const { SlashCommandBuilder } = require('discord.js');
const { canSetupPanels } = require('../services/permissionService');
const logService = require('../services/logService');
const { createErrorEmbed, createSuccessEmbed } = require('../utils/createEmbed');
const logger = require('../utils/logger');
const resolver = require('../utils/resolver');
const componentFactory = require('../utils/componentFactory');
const { EPHEMERAL_REPLY } = require('../utils/interactionOptions');
const corporationService = require('../services/corporationService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configura os painéis dos módulos (unificado ou por corporação)')
    .addStringOption((option) =>
      option
        .setName('modulo')
        .setDescription('Qual módulo deseja configurar?')
        .setRequired(true)
        .addChoices(
          { name: 'Tickets', value: 'tickets' },
          { name: 'Edital', value: 'edital' },
          { name: 'Ponto', value: 'ponto' },
          { name: 'Ausência', value: 'ausencia' },
          { name: 'Advertência (Painel)', value: 'warning' },
          { name: 'Avaliação (Painel)', value: 'avaliacao' },
          { name: 'Academia (Painel)', value: 'academia' },
          { name: 'Sugestões', value: 'sugestoes' },
          { name: 'Blacklist', value: 'blacklist' },
          { name: 'Solicitações Internas', value: 'solicitacoes' },
          { name: 'Exonerações', value: 'exoneracoes' },
          { name: 'Transferências', value: 'transferencias' },
          { name: 'Hierarquia', value: 'hierarchy' },
          { name: 'Todos', value: 'todos' }
        )
    )
    .addStringOption((option) =>
      option
        .setName('corporacao')
        .setDescription('Corporação (opcional — se omitido, usa painel unificado)')
        .setRequired(false)
        .addChoices(
          { name: 'Unificado (SSP)', value: 'unificado' },
          { name: 'PMESP - Polícia Militar', value: 'pmesp' },
          { name: 'PCESP - Polícia Civil', value: 'pcesp' }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply(EPHEMERAL_REPLY);

    // Verificar permissão
    if (!await canSetupPanels(interaction.member)) {
      return interaction.editReply({
        embeds: [createErrorEmbed('Sem Permissão', 'Você não possui autorização para executar este comando.')],
      });
    }

    const modulo = interaction.options.getString('modulo');
    const corpSlug = interaction.options.getString('corporacao') || 'unificado';
    const isUnified = corpSlug === 'unificado';
    const results = [];

    // Se modo unificado, não precisa de corporação específica
    let corporation = null;
    if (!isUnified) {
      corporation = await corporationService.getBySlug(interaction.guildId, corpSlug);
      if (!corporation) {
        return interaction.editReply({
          embeds: [createErrorEmbed('Corporação Não Encontrada', `A corporação "${corpSlug}" não foi encontrada. Execute \`/setup-patentes\` primeiro.`)],
        });
      }
    }

    try {
      const emojiHelper = require('../utils/emojiHelper');
      await emojiHelper.init(interaction.guild);

      if (modulo === 'tickets' || modulo === 'todos') {
        const result = await setupTickets(interaction, corporation, isUnified);
        results.push(result);
      }

      if (modulo === 'edital' || modulo === 'todos') {
        const result = await setupEdital(interaction, corporation, isUnified);
        results.push(result);
      }

      if (modulo === 'ponto' || modulo === 'todos') {
        const result = await setupPonto(interaction, corporation, isUnified);
        results.push(result);
      }

      if (modulo === 'ausencia' || modulo === 'todos') {
        const result = await setupAusencia(interaction, corporation, isUnified);
        results.push(result);
      }

      if (modulo === 'warning' || modulo === 'todos') {
        const result = await setupWarning(interaction, corporation, isUnified);
        results.push(result);
      }

      if (modulo === 'avaliacao' || modulo === 'todos') {
        const result = await setupAvaliacao(interaction, corporation, isUnified);
        results.push(result);
      }

      if (modulo === 'academia' || modulo === 'todos') {
        const result = await setupAcademia(interaction, corporation, isUnified);
        results.push(result);
      }

      if (modulo === 'sugestoes' || modulo === 'todos') {
        const result = await setupSugestoes(interaction, corporation, isUnified);
        results.push(result);
      }

      if (modulo === 'blacklist' || modulo === 'todos') {
        const result = await setupBlacklist(interaction, corporation, isUnified);
        results.push(result);
      }

      if (modulo === 'solicitacoes' || modulo === 'todos') {
        const result = await setupSolicitacoes(interaction, corporation, isUnified);
        results.push(result);
      }

      if (modulo === 'exoneracoes' || modulo === 'todos') {
        const result = await setupExoneracoes(interaction, corporation, isUnified);
        results.push(result);
      }

      if (modulo === 'transferencias' || modulo === 'todos') {
        const result = await setupTransferencias(interaction, corporation, isUnified);
        results.push(result);
      }

      if (modulo === 'hierarchy' || modulo === 'todos') {
        const result = await setupHierarchy(interaction, corporation, isUnified);
        results.push(result);
      }

      const modeLabel = isUnified ? '🏛️ SSP (Unificado)' : `${corporation.emoji} ${corporation.shortName}`;
      const summary = `**Modo:** ${modeLabel}\n\n${results.join('\n')}`;
      await interaction.editReply({
        embeds: [createSuccessEmbed('Setup Concluído', summary)],
      });

      // Log administrativo
      await logService.logSetupExecuted(interaction.client, {
        userId: interaction.user.id,
        module: `${modulo}:${corpSlug}`,
      });
    } catch (error) {
      logger.error('Erro no setup:', error);
      await interaction.editReply({
        embeds: [createErrorEmbed('Erro no Setup', `Ocorreu um erro durante a configuração: ${error.message}`)],
      });
    }
  },
};

/**
 * Resolve o canal de uma corporação pelo channelKey.
 * Em modo unificado, tenta resolver pelo nome fallback diretamente.
 * Primeiro tenta pelo ID salvo no banco, depois pelo nome fallback.
 */
async function resolveCorpChannel(guild, corporation, channelKey, nameFallback) {
  if (corporation) {
    // Caso especial solicitado pelo usuário: hierarquia da polícia civil (PCESP) no canal 1510857782025257121
    if (corporation.slug === 'pcesp' && channelKey === 'hierarchy') {
      const targetChannelId = '1510857782025257121';
      const chan = guild.channels.cache.get(targetChannelId) || await guild.channels.fetch(targetChannelId).catch(() => null);
      if (chan) return chan;
    }

    // Tentar pelo ID da corporação
    const channelId = corporation.channels ? corporation.channels[channelKey] : null;
    if (channelId) {
      const chan = guild.channels.cache.get(channelId);
      if (chan) return chan;
    }
  }

  // Fallback: resolver pelo nome
  return resolver.resolveChannel(guild, channelKey, nameFallback, { autoCreate: true });
}

async function clearBotMessages(targetChannel, botId, label) {
  try {
    const messages = await targetChannel.messages.fetch({ limit: 50 });
    const botMessages = messages.filter(m => m.author.id === botId);
    for (const message of botMessages.values()) {
      await message.delete().catch(() => {});
    }
  } catch (err) {
    logger.error(`Erro ao limpar canal de ${label}:`, err);
  }
}

/**
 * Envia o painel de tickets no canal resolvido.
 * Em modo unificado, envia painel com select de corporação.
 */
async function setupTickets(interaction, corporation, isUnified) {
  const targetChannel = await resolveCorpChannel(
    interaction.guild, corporation, 'ticketsPanel', '📄・painel-tickets'
  );

  if (!targetChannel) {
    throw new Error('Não foi possível resolver o canal do Painel de Tickets.');
  }

  await clearBotMessages(targetChannel, interaction.client.user.id, 'tickets');

  if (isUnified) {
    await targetChannel.send(componentFactory.createUnifiedTicketPanelPayload());
  } else {
    await targetChannel.send(componentFactory.createTicketPanelPayload(corporation));
  }

  const label = isUnified ? 'SSP' : corporation.shortName;
  logger.success(`Painel de Tickets (${label}) enviado em #${targetChannel.name}`);
  return `✅ **Tickets:** Painel enviado em <#${targetChannel.id}>`;
}

/**
 * Envia o painel do edital no canal resolvido.
 * Em modo unificado, envia painel com select de corporação.
 */
async function setupEdital(interaction, corporation, isUnified) {
  const targetChannel = await resolveCorpChannel(
    interaction.guild, corporation, 'editalPanel', '📄・painel-edital'
  );

  if (!targetChannel) {
    throw new Error('Não foi possível resolver o canal do Painel do Edital.');
  }

  await clearBotMessages(targetChannel, interaction.client.user.id, 'edital');

  if (isUnified) {
    await targetChannel.send(componentFactory.createUnifiedEditalPanelPayload());
  } else {
    await targetChannel.send(componentFactory.createEditalPanelPayload(corporation));
  }

  const label = isUnified ? 'SSP' : corporation.shortName;
  logger.success(`Painel do Edital (${label}) enviado em #${targetChannel.name}`);
  return `✅ **Edital:** Painel enviado em <#${targetChannel.id}>`;
}

/**
 * Envia o painel de ponto no canal resolvido.
 * Em modo unificado, envia painel sem corporação (auto-detecção no runtime).
 */
async function setupPonto(interaction, corporation, isUnified) {
  const targetChannel = await resolveCorpChannel(
    interaction.guild, corporation, 'pontoPanel', '📄・painel-ponto'
  );

  if (!targetChannel) {
    throw new Error('Não foi possível resolver o canal do Painel de Ponto.');
  }

  const pontoService = require('../modules/ponto/ponto.service');

  await clearBotMessages(targetChannel, interaction.client.user.id, 'ponto');

  // Em modo unificado, envia sem corporação (null) → botões sem sufixo
  const panelCorp = isUnified ? null : corporation;
  const panelPayload = pontoService.buildPontoPanelPayload(panelCorp);
  const statusPayload = await pontoService.buildStatusPontoPayload(interaction.guild, panelCorp);

  await targetChannel.send(panelPayload);
  await targetChannel.send(statusPayload);

  const label = isUnified ? 'SSP' : corporation.shortName;
  logger.success(`Painel de Ponto (${label}) enviado em #${targetChannel.name}`);
  return `✅ **Bate Ponto:** Painel enviado em <#${targetChannel.id}>`;
}

/**
 * Envia o painel de ausência no canal resolvido.
 * Em modo unificado, envia sem corporação (auto-detecção no runtime).
 */
async function setupAusencia(interaction, corporation, isUnified) {
  const targetChannel = await resolveCorpChannel(
    interaction.guild, corporation, 'ausenciaPanel', '📄・painel-ausencia'
  );

  if (!targetChannel) {
    throw new Error('Não foi possível resolver o canal do Painel de Ausência.');
  }

  await clearBotMessages(targetChannel, interaction.client.user.id, 'ausência');

  const panelCorp = isUnified ? null : corporation;
  await targetChannel.send(componentFactory.createAusenciaPanelPayload(panelCorp));

  const label = isUnified ? 'SSP' : corporation.shortName;
  logger.success(`Painel de Ausência (${label}) enviado em #${targetChannel.name}`);
  return `✅ **Ausência:** Painel enviado em <#${targetChannel.id}>`;
}

/**
 * Envia o painel de advertência no canal resolvido.
 * Em modo unificado, envia sem corporação (auto-detecção no runtime).
 */
async function setupWarning(interaction, corporation, isUnified) {
  const targetChannel = await resolveCorpChannel(
    interaction.guild, corporation, 'warningPanel', '📄・painel-advertencias'
  );

  if (!targetChannel) {
    throw new Error('Não foi possível resolver o canal do Painel de Advertência.');
  }

  await clearBotMessages(targetChannel, interaction.client.user.id, 'advertência');

  const panelCorp = isUnified ? null : corporation;
  await targetChannel.send(componentFactory.createWarningPanelPayload(panelCorp));

  const label = isUnified ? 'SSP' : corporation.shortName;
  logger.success(`Painel de Advertência (${label}) enviado em #${targetChannel.name}`);
  return `✅ **Advertência:** Painel enviado em <#${targetChannel.id}>`;
}

/**
 * Envia o painel de avaliação no canal resolvido.
 * Em modo unificado, envia sem corporação (auto-detecção no runtime).
 */
async function setupAvaliacao(interaction, corporation, isUnified) {
  const targetChannel = await resolveCorpChannel(
    interaction.guild, corporation, 'avaliacaoPanel', '📄・painel-avaliacao'
  );

  if (!targetChannel) {
    throw new Error('Não foi possível resolver o canal do Painel de Avaliação.');
  }

  await clearBotMessages(targetChannel, interaction.client.user.id, 'avaliação');

  const panelCorp = isUnified ? null : corporation;
  const payload = componentFactory.createAvaliacaoPanelPayload(panelCorp);
  await targetChannel.send(payload);

  const label = isUnified ? 'SSP' : corporation.shortName;
  logger.success(`Painel de Avaliação (${label}) enviado em #${targetChannel.name}`);
  return `✅ **Avaliação:** Painel enviado em <#${targetChannel.id}>`;
}

/**
 * Envia o painel da Academia no canal resolvido.
 * Em modo unificado, envia sem corporação (auto-detecção no runtime).
 */
async function setupAcademia(interaction, corporation, isUnified) {
  const targetChannel = await resolveCorpChannel(
    interaction.guild, corporation, 'academiaPanel', '📄・painel-academia'
  );

  if (!targetChannel) {
    throw new Error('Não foi possível resolver o canal do Painel da Academia.');
  }

  await clearBotMessages(targetChannel, interaction.client.user.id, 'academia');

  const panelCorp = isUnified ? null : corporation;
  await targetChannel.send(componentFactory.createAcademiaPanelPayload(panelCorp));

  const label = isUnified ? 'SSP' : corporation.shortName;
  logger.success(`Painel da Academia (${label}) enviado em #${targetChannel.name}`);
  return `✅ **Academia:** Painel enviado em <#${targetChannel.id}>`;
}

async function setupSugestoes(interaction, corporation, isUnified) {
  const targetChannel = await resolveCorpChannel(
    interaction.guild, corporation, 'sugestoes', '💡・sugestões'
  );

  if (!targetChannel) {
    throw new Error('Não foi possível resolver o canal do Painel de Sugestões.');
  }

  await clearBotMessages(targetChannel, interaction.client.user.id, 'sugestões');

  const panelCorp = isUnified ? null : corporation;
  await targetChannel.send(componentFactory.createSugestoesPanelPayload(panelCorp));

  const label = isUnified ? 'SSP' : corporation.shortName;
  logger.success(`Painel de Sugestões (${label}) enviado em #${targetChannel.name}`);
  return `✅ **Sugestões:** Painel enviado em <#${targetChannel.id}>`;
}

async function setupBlacklist(interaction, corporation, isUnified) {
  const targetChannel = await resolveCorpChannel(
    interaction.guild, corporation, 'blacklist', '🚫・blacklist'
  );

  if (!targetChannel) {
    throw new Error('Não foi possível resolver o canal do Painel de Blacklist.');
  }

  await clearBotMessages(targetChannel, interaction.client.user.id, 'blacklist');

  const panelCorp = isUnified ? null : corporation;
  await targetChannel.send(componentFactory.createBlacklistPanelPayload(panelCorp));

  const label = isUnified ? 'SSP' : corporation.shortName;
  logger.success(`Painel de Blacklist (${label}) enviado em #${targetChannel.name}`);
  return `✅ **Blacklist:** Painel enviado em <#${targetChannel.id}>`;
}

async function setupSolicitacoes(interaction, corporation, isUnified) {
  const targetChannel = await resolveCorpChannel(
    interaction.guild, corporation, 'solicitacoesInternas', 'solicitações-internas'
  );

  if (!targetChannel) {
    throw new Error('Não foi possível resolver o canal de Solicitações Internas.');
  }

  await clearBotMessages(targetChannel, interaction.client.user.id, 'solicitações internas');

  const panelCorp = isUnified ? null : corporation;
  await targetChannel.send(componentFactory.createSolicitacoesPanelPayload(panelCorp));

  const label = isUnified ? 'SSP' : corporation.shortName;
  logger.success(`Painel de Solicitações Internas (${label}) enviado em #${targetChannel.name}`);
  return `✅ **Solicitações Internas:** Painel enviado em <#${targetChannel.id}>`;
}

async function setupExoneracoes(interaction, corporation, isUnified) {
  const targetChannel = await resolveCorpChannel(
    interaction.guild, corporation, 'exoneracoes', '📄・exonerações'
  );

  if (!targetChannel) {
    throw new Error('Não foi possível resolver o canal do Painel de Exonerações.');
  }

  await clearBotMessages(targetChannel, interaction.client.user.id, 'exonerações');

  const panelCorp = isUnified ? null : corporation;
  await targetChannel.send(componentFactory.createExoneracoesPanelPayload(panelCorp));

  const label = isUnified ? 'SSP' : corporation.shortName;
  logger.success(`Painel de Exonerações (${label}) enviado em #${targetChannel.name}`);
  return `✅ **Exonerações:** Painel enviado em <#${targetChannel.id}>`;
}

async function setupTransferencias(interaction, corporation, isUnified) {
  const targetChannel = await resolveCorpChannel(
    interaction.guild, corporation, 'transferencias', '📄・transferências'
  );

  if (!targetChannel) {
    throw new Error('Não foi possível resolver o canal do Painel de Transferências.');
  }

  await clearBotMessages(targetChannel, interaction.client.user.id, 'transferências');

  const panelCorp = isUnified ? null : corporation;
  await targetChannel.send(componentFactory.createTransferenciasPanelPayload(panelCorp));

  const label = isUnified ? 'SSP' : corporation.shortName;
  logger.success(`Painel de Transferências (${label}) enviado em #${targetChannel.name}`);
  return `✅ **Transferências:** Painel enviado em <#${targetChannel.id}>`;
}

async function setupHierarchy(interaction, corporation, isUnified) {
  const targetChannel = await resolveCorpChannel(
    interaction.guild, corporation, 'hierarchy', '📋・hierarquia'
  );

  if (!targetChannel) {
    throw new Error('Não foi possível resolver o canal de Hierarquia.');
  }

  // Importar o serviço e rodar a atualização
  const hierarchyService = require('../services/hierarchyService');
  await hierarchyService.updateHierarchy(interaction.guild);

  const label = isUnified ? 'SSP' : corporation.shortName;
  logger.success(`Hierarquia (${label}) atualizada em #${targetChannel.name}`);
  return `✅ **Hierarquia:** Atualizada no canal <#${targetChannel.id}>`;
}

