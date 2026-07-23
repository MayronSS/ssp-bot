const { EmbedBuilder } = require('discord.js');
const Ponto = require('../../database/models/Ponto');
const resolver = require('../../utils/resolver');
const env = require('../../config/env');
const logger = require('../../utils/logger');
const embedsConfig = require('../../config/embeds');
const { createBaseEmbed, createSuccessEmbed, createErrorEmbed, createWarningEmbed } = require('../../utils/createEmbed');
const componentFactory = require('../../utils/componentFactory');
const emojiHelper = require('../../utils/emojiHelper');

const COR_LSPD = embedsConfig.design.colors.primary;
const SUCCESS_GREEN = embedsConfig.design.colors.success;
const DANGER_RED = embedsConfig.design.colors.danger;
const NEUTRAL_DARK = embedsConfig.design.colors.dark;
const LOGO_LSPD = embedsConfig.design.logo;

/**
 * Resolve o canal de log de ponto baseado no corpSlug.
 * Se o canal específico da corporação existir, usa ele; senão, fallback para o unificado.
 */
async function resolvePontoLogChannel(guild, corpSlug) {
  const corpLogKeys = {
    pmesp: { key: 'pontoLogsPmesp', fallbackName: '📄・log-ponto-pmesp' },
    pcesp: { key: 'pontoLogsPcesp', fallbackName: '📄・log-ponto-pcesp' },
  };

  const corpEntry = corpLogKeys[corpSlug];
  if (corpEntry) {
    const corpChannel = await resolver.resolveChannel(guild, corpEntry.key, corpEntry.fallbackName, { autoCreate: false });
    if (corpChannel) return corpChannel;
  }

  // Fallback: canal unificado
  return resolver.resolveChannel(guild, 'pontoLogs', '📄・log-ponto', { autoCreate: false });
}

/**
 * Formata duração em milissegundos para string legível (HHh MMm).
 */
function formatDuration(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m`;
}

function formatDurationWithSeconds(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
}

function toDiscordTimestamp(date, style = 'F') {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

/**
 * Busca a mensagem do painel de controle no canal.
 */
function componentHasCustomId(component, acceptedCustomIds) {
  if (!component) {
    return false;
  }

  if (component.customId && acceptedCustomIds.has(component.customId)) {
    return true;
  }

  const children = component.components ?? [];
  return children.some((child) => componentHasCustomId(child, acceptedCustomIds));
}

function componentHasCustomIdPrefix(component, prefixes) {
  if (!component) return false;
  if (component.customId && prefixes.some(p => component.customId.startsWith(p))) return true;
  const children = component.components ?? [];
  return children.some((child) => componentHasCustomIdPrefix(child, prefixes));
}

async function findPanelMessage(channel) {
  try {
    const acceptedPrefixes = [
      'registrar_entrada_lspd',
      'registrar_saida_lspd',
      'atualizar_status_lspd',
      'ver_ranking_lspd',
      'ponto_bater',
      'ponto_encerrar',
      'ponto_atualizar',
      'ponto_ranking',
    ];

    const messages = await channel.messages.fetch({ limit: 50 });
    return messages.find(
      (m) =>
        m.author.id === channel.client.user.id &&
        m.components.length > 0 &&
        m.components.some((component) => {
          // Aceitar tanto IDs exatos quanto com sufixo :slug
          const acceptedCustomIds = new Set(acceptedPrefixes);
          return componentHasCustomId(component, acceptedCustomIds) ||
                 componentHasCustomIdPrefix(component, acceptedPrefixes);
        })
    );
  } catch (error) {
    logger.error('Erro ao buscar mensagem do painel de ponto:', error);
    return null;
  }
}

/**
 * Busca a mensagem de status (baixa) no canal.
 */
function componentHasText(component, acceptedTexts) {
  if (!component) {
    return false;
  }

  const content = component.content || component.data?.content || '';
  if (typeof content === 'string' && acceptedTexts.some((text) => content.includes(text))) {
    return true;
  }

  const children = component.components ?? component.data?.components ?? [];
  return children.some((child) => componentHasText(child, acceptedTexts));
}

/**
 * Busca a mensagem de status (baixa) no canal.
 */
async function findStatusMessage(channel) {
  try {
    const messages = await channel.messages.fetch({ limit: 50 });
    return messages.find((m) => {
      if (m.author.id !== channel.client.user.id) {
        return false;
      }

      const oldEmbedTitle = m.embeds?.[0]?.title || '';
      if (oldEmbedTitle.includes('Registro de Baixa')) {
        return true;
      }

      return (m.components || []).some((component) =>
        componentHasText(component, ['Registro de Baixa', 'Em Serviço'])
      );
    });
  } catch (error) {
    logger.error('Erro ao buscar mensagem de status de ponto:', error);
    return null;
  }
}

/**
 * Constrói o embed do Painel de Ponto Principal.
 */
async function buildMainPontoEmbed(guild) {
  return new EmbedBuilder()
    .setColor('#2b2d31')
    .setTitle(`${emojiHelper.get('clock')} Sistema de Bater Ponto`)
    .setDescription('> Clique em **Bater Ponto** para iniciar seu expediente.\n> Clique em **Encerrar Ponto** para finalizar sua patrulha.');
}

/**
 * Constrói o embed de Status de Policiais em Serviço.
 */
async function getActivePontoRows() {
  const ativos = await Ponto.find({ status: 'aberto' }).sort({ entrada: 1 });

  return ativos.map((ponto) => {
    const durationMs = Date.now() - ponto.entrada.getTime();

    return {
      id: ponto._id.toString(),
      userId: ponto.userId,
      username: ponto.username,
      entradaTimestamp: toDiscordTimestamp(ponto.entrada, 'f'),
      durationStr: formatDurationWithSeconds(durationMs),
    };
  });
}

/**
 * Constrói o embed legado de Status de Policiais em Serviço.
 * Mantido para compatibilidade, mas o painel atual usa Components V2.
 */
async function buildStatusPontoEmbed(guild) {
  const ativos = await getActivePontoRows();

  const embedStatus = new EmbedBuilder()
    .setColor(NEUTRAL_DARK)
    .setTitle(`${emojiHelper.get('clipboard')} Registro de Baixa (Em Serviço)`)
    .setTimestamp();

  if (ativos.length === 0) {
    embedStatus.setDescription('*Nenhum oficial em patrulhamento no momento.*');
  } else {
    const lines = ativos.map((ponto) =>
      `${emojiHelper.get('user')} <@${ponto.userId}> — Em patrulha há **${ponto.durationStr}**`
    );
    embedStatus.setDescription(lines.join('\n'));
  }

  return embedStatus;
}

async function buildStatusPontoPayload(guild, corporation) {
  const corpSlug = corporation ? corporation.slug : null;
  const filter = { status: 'aberto' };
  if (corpSlug) filter.corporationSlug = corpSlug;
  const ativos = await Ponto.find(filter).sort({ entrada: 1 });

  const corporationsConfig = require('../../config/corporations');

  const rows = [];
  for (const ponto of ativos) {
    const durationMs = Date.now() - ponto.entrada.getTime();

    // Resolver batalhão do membro
    let battalionSlug = ponto.battalionSlug || null;
    if (!battalionSlug) {
      try {
        const member = await guild.members.fetch(ponto.userId).catch(() => null);
        if (member) {
          const roleNames = [...member.roles.cache.values()].map(r => r.name.toLowerCase());
          for (const tag of corporationsConfig.tags) {
            if (roleNames.some(r => r === tag.tagRole.toLowerCase())) {
              battalionSlug = tag.slug;
              break;
            }
          }
        }
      } catch (e) { /* ignore */ }
    }

    rows.push({
      id: ponto._id.toString(),
      userId: ponto.userId,
      username: ponto.username,
      corporationSlug: ponto.corporationSlug || 'pmesp',
      battalionSlug,
      entradaTimestamp: toDiscordTimestamp(ponto.entrada, 'f'),
      durationStr: formatDurationWithSeconds(durationMs),
    });
  }

  return componentFactory.createPontoStatusPayload(rows);
}

/**
 * Constrói os embeds do Painel de Ponto (Principal + Status).
 */
async function buildPontoEmbeds(guild) {
  const embedPainel = await buildMainPontoEmbed(guild);
  const embedStatus = await buildStatusPontoEmbed(guild);
  return [embedPainel, embedStatus];
}

function buildPontoButtons(corporation) {
  return componentFactory.createPontoPanelButtons(corporation);
}

function buildPontoPanelPayload(corporation) {
  return componentFactory.createPontoPanelPayload(corporation);
}

/**
 * Atualiza o painel de ponto existente em um canal.
 */
async function updatePontoPanel(guild, channel) {
  let panelMessage = await findPanelMessage(channel);
  let statusMessage = await findStatusMessage(channel);

  const statusPayload = await buildStatusPontoPayload(guild);
  const panelPayload = buildPontoPanelPayload();

  if (panelMessage) {
    try {
      await panelMessage.edit({ ...panelPayload, embeds: [] });
    } catch (err) {
      logger.error('Erro ao editar mensagem de painel de ponto. Recriando painel:', err);
      await panelMessage.delete().catch(() => {});
      panelMessage = await channel.send(panelPayload).catch((sendErr) => {
        logger.error('Erro ao reenviar mensagem de painel de ponto:', sendErr);
      });
    }
  } else {
    panelMessage = await channel.send(panelPayload).catch((err) => {
      logger.error('Erro ao enviar mensagem de painel de ponto:', err);
    });
  }

  if (statusMessage) {
    await statusMessage.edit({ ...statusPayload, content: null, embeds: [], files: [] }).catch((err) => {
      logger.error('Erro ao editar mensagem de status de ponto:', err);
    });
  } else {
    await channel.send(statusPayload).catch((err) => {
      logger.error('Erro ao enviar mensagem de status de ponto:', err);
    });
  }
}

function buildPontoLogPayload({ type, user, member, ponto, guild, now, durationMs = null, durationText = null, actionNote = null }) {
  const isEntrada = type === 'entrada';
  const entrada = ponto.entrada instanceof Date ? ponto.entrada : new Date(ponto.entrada);
  const saida = now instanceof Date ? now : new Date(now);

  // Resolver batalhão a partir dos cargos do membro
  let battalionSlug = null;
  if (member && member.roles && member.roles.cache) {
    const corporationsConfig = require('../../config/corporations');
    const roleNames = [...member.roles.cache.values()].map(r => r.name.toLowerCase());
    for (const tag of corporationsConfig.tags) {
      if (roleNames.some(r => r === tag.tagRole.toLowerCase())) {
        battalionSlug = tag.slug;
        break;
      }
    }
  }

  return componentFactory.createPontoLogPayload({
    type,
    userMention: `<@${user.id}>`,
    userId: user.id,
    displayName: member.displayName || user.username,
    corporationSlug: ponto.corporationSlug || 'pmesp',
    battalionSlug,
    entradaTimestamp: toDiscordTimestamp(entrada, 'F'),
    saidaTimestamp: isEntrada ? null : toDiscordTimestamp(saida, 'F'),
    durationText: durationText || (durationMs === null ? 'Em andamento' : formatDurationWithSeconds(durationMs)),
    registroId: ponto._id ? ponto._id.toString() : 'Gerado pelo sistema',
    guildName: guild.name,
    actionNote,
  });
}

async function updateConfiguredPontoPanel(guild) {
  const panelChannel = await resolver.resolveChannel(guild, 'pontoPanel', '📄・painel-ponto', { autoCreate: true });
  if (!panelChannel) return null;

  await updatePontoPanel(guild, panelChannel);
  return panelChannel;
}

async function resolvePontoIdentity(guild, ponto, explicitUser = null) {
  const member = await guild.members.fetch(ponto.userId).catch(() => null);
  const user = explicitUser || member?.user || await guild.client.users.fetch(ponto.userId).catch(() => null);

  return {
    user: user || { id: ponto.userId, username: ponto.username || 'Oficial' },
    member: member || { displayName: ponto.username || user?.username || 'Oficial' },
  };
}

async function sendPontoClosureLog({ guild, ponto, user, member, actorUser, now, durationMs, saveHours, reason }) {
  const logChannel = await resolvePontoLogChannel(guild, ponto.corporationSlug || 'pmesp');
  if (!logChannel) return;

  const actionParts = [
    saveHours ? 'Horas contabilizadas' : 'Horas descartadas',
    `por <@${actorUser.id}>`,
    reason ? `Motivo: ${reason}` : null,
  ].filter(Boolean);

  const logPayload = buildPontoLogPayload({
    type: 'saida',
    user,
    member,
    ponto,
    guild,
    now,
    durationMs,
    durationText: saveHours
      ? formatDurationWithSeconds(durationMs)
      : `${formatDurationWithSeconds(durationMs)} (nao contabilizado)`,
    actionNote: actionParts.join(' - '),
  });

  await logChannel.send(logPayload).catch(() => {});
}

async function closePontoDocument({ guild, ponto, actorUser, saveHours, reason, now, explicitUser = null }) {
  const { user, member } = await resolvePontoIdentity(guild, ponto, explicitUser);
  const durationMs = Math.max(0, now.getTime() - new Date(ponto.entrada).getTime());

  ponto.saida = now;
  ponto.status = 'fechado';
  ponto.durationMs = saveHours ? durationMs : 0;
  ponto.username = member.displayName || user.username || ponto.username;
  await ponto.save();

  await sendPontoClosureLog({
    guild,
    ponto,
    user,
    member,
    actorUser,
    now,
    durationMs,
    saveHours,
    reason,
  });

  return {
    ponto,
    user,
    member,
    durationMs,
    savedDurationMs: ponto.durationMs,
  };
}

async function encerrarPontoUsuario({ guild, targetUser, actorUser, saveHours, reason = null }) {
  const ativos = await Ponto.find({ userId: targetUser.id, status: 'aberto' }).sort({ entrada: 1 });
  if (!ativos.length) {
    return {
      closedCount: 0,
      totalDurationMs: 0,
      savedDurationMs: 0,
      entries: [],
    };
  }

  const now = new Date();
  const entries = [];

  for (const ponto of ativos) {
    const result = await closePontoDocument({
      guild,
      ponto,
      actorUser,
      saveHours,
      reason,
      now,
      explicitUser: targetUser,
    });
    entries.push(result);
  }

  await updateConfiguredPontoPanel(guild);

  return {
    closedCount: entries.length,
    totalDurationMs: entries.reduce((total, entry) => total + entry.durationMs, 0),
    savedDurationMs: entries.reduce((total, entry) => total + entry.savedDurationMs, 0),
    entries,
  };
}

async function encerrarTodosPontos({ guild, actorUser, saveHours, reason = null }) {
  const ativos = await Ponto.find({ status: 'aberto' }).sort({ entrada: 1 });
  if (!ativos.length) {
    return {
      closedCount: 0,
      totalDurationMs: 0,
      savedDurationMs: 0,
      entries: [],
    };
  }

  const now = new Date();
  const entries = [];

  for (const ponto of ativos) {
    const result = await closePontoDocument({
      guild,
      ponto,
      actorUser,
      saveHours,
      reason,
      now,
    });
    entries.push(result);
  }

  await updateConfiguredPontoPanel(guild);

  return {
    closedCount: entries.length,
    totalDurationMs: entries.reduce((total, entry) => total + entry.durationMs, 0),
    savedDurationMs: entries.reduce((total, entry) => total + entry.savedDurationMs, 0),
    entries,
  };
}

/**
 * Registra a entrada do oficial (Iniciar Patrulha).
 */
async function registrarEntrada(interaction) {
  const { guild, member, user } = interaction;

  // Verificar se já tem ponto ativo
  const ativo = await Ponto.findOne({ userId: user.id, status: 'aberto' });
  if (ativo) {
    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor('#e74c3c')
          .setDescription(`❌ Você já se encontra em patrulhamento. Encerre seu turno atual antes de registrar outro.`)
      ],
      files: []
    });
  }

  const now = new Date();
  const pontoCriado = await Ponto.create({
    corporationSlug: interaction._corpSlug || 'pmesp',
    userId: user.id,
    username: member.displayName || user.username,
    entrada: now,
    status: 'aberto',
  });

  // Re-renderizar o painel
  await updatePontoPanel(guild, interaction.channel);

  // Enviar log administrativo (canal separado por corporação)
  const logChannel = await resolvePontoLogChannel(guild, interaction._corpSlug || 'pmesp');
  if (logChannel) {
    const logPayload = buildPontoLogPayload({
      type: 'entrada',
      user,
      member,
      ponto: pontoCriado,
      guild,
      now,
    });

    await logChannel.send(logPayload).catch(() => {});
  }


  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor('#2ecc71')
        .setDescription(`${emojiHelper.get('check')} Ponto iniciado com sucesso!`)
    ],
    files: []
  });
}

/**
 * Registra a saída do oficial (Finalizar Patrulha).
 */
async function registrarSaida(interaction) {
  const { guild, member, user } = interaction;

  // Buscar ponto ativo
  const ativo = await Ponto.findOne({ userId: user.id, status: 'aberto' });
  if (!ativo) {
    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor('#e74c3c')
          .setDescription(`❌ Nenhum registro de turno em aberto foi localizado para sua credencial.`)
      ],
      files: []
    });
  }

  const now = new Date();
  const durationMs = now.getTime() - ativo.entrada.getTime();

  ativo.saida = now;
  ativo.status = 'fechado';
  ativo.durationMs = durationMs;
  await ativo.save();

  // Re-renderizar o painel
  await updatePontoPanel(guild, interaction.channel);

  // Enviar log administrativo (canal separado por corporação)
  const logChannel = await resolvePontoLogChannel(guild, interaction._corpSlug || 'pmesp');
  if (logChannel) {
    const logPayload = buildPontoLogPayload({
      type: 'saida',
      user,
      member,
      ponto: ativo,
      guild,
      now,
      durationMs,
    });

    await logChannel.send(logPayload).catch(() => {});
  }


  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const timeStr = `\`${hours}h\` \`${minutes}m\` \`${seconds}s\``;

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor('#2ecc71')
        .setDescription(`${emojiHelper.get('check')} Ponto encerrado! Você ficou ${timeStr} ativo.`)
    ],
    files: []
  });
}

/**
 * Status updater.
 */
async function atualizarStatus(interaction) {
  const { guild } = interaction;
  await updatePontoPanel(guild, interaction.channel);
  await interaction.editReply({
    content: `${emojiHelper.get('check')} Central COPOM de status de patrulhamento atualizada com sucesso!`,
  });
}

/**
 * Exibe o ranking TOP 10 de oficiais com mais tempo de serviço.
 */
async function verRanking(interaction) {
  try {
    const corpSlug = interaction._corpSlug || 'pmesp';
    const corpLabel = corpSlug === 'pcesp' ? 'PCESP' : 'PMESP';

    const rankingData = await Ponto.aggregate([
      { $match: { status: 'fechado', corporationSlug: corpSlug } },
      {
        $group: {
          _id: '$userId',
          username: { $first: '$username' },
          totalDuration: { $sum: '$durationMs' },
        },
      },
      { $sort: { totalDuration: -1 } },
      { $limit: 10 },
    ]);

    if (rankingData.length === 0) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(NEUTRAL_DARK)
            .setTitle(`${emojiHelper.get('trophy')} Ranking de Patrulha — ${corpLabel}`)
            .setDescription('Nenhum registro de patrulha fechado foi encontrado ainda.')
            .setFooter({ text: 'SSP • Sistema de Bate-Ponto' })
            .setTimestamp(),
        ],
        files: [],
      });
    }

    const rankingLines = rankingData.map((data, index) => {
      const position = index + 1;
      const medal = position === 1 ? '1º' : position === 2 ? '2º' : position === 3 ? '3º' : `${position}º`;
      const formattedDuration = formatDuration(data.totalDuration);

      return `**${medal}** ${emojiHelper.get('user')} <@${data._id}>\n> Total em serviço: **${formattedDuration}**`;
    });

    const embed = new EmbedBuilder()
      .setColor(NEUTRAL_DARK)
      .setTitle(`${emojiHelper.get('trophy')} Ranking de Patrulha — ${corpLabel}`)
      .setDescription(rankingLines.join('\n\n'))
      .setFooter({ text: 'SSP • Ranking atualizado em tempo real' })
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed],
      files: [],
    });
  } catch (error) {
    logger.error('Erro ao gerar ranking:', error);
    await interaction.editReply({
      content: '❌ Ocorreu um erro ao processar a solicitação do ranking.',
    });
  }
}

/**
 * Lógica unificada de Bater Ponto (Toggle).
 */
async function togglePonto(interaction) {
  const { user } = interaction;
  const ativo = await Ponto.findOne({ userId: user.id, status: 'aberto' });
  if (ativo) {
    await registrarSaida(interaction);
  } else {
    await registrarEntrada(interaction);
  }
}

async function registrarEntradaAPI({ guild, userId, username, corporationSlug, battalionSlug }) {
  // 1. Verificar se o usuário existe no Discord
  const member = await guild.members.fetch(userId).catch(() => null);
  const user = member?.user || await guild.client.users.fetch(userId).catch(() => null);

  if (!user) {
    return { success: false, code: 'user_not_found', message: "Usuário do Discord não encontrado." };
  }

  // 2. Verificar se já tem ponto ativo
  const ativo = await Ponto.findOne({ userId, status: 'aberto' });
  if (ativo) {
    return { success: true, code: 'already_open', message: "O oficial já possui um ponto em aberto." };
  }

  const now = new Date();
  const pontoCriado = await Ponto.create({
    corporationSlug: corporationSlug || 'pmesp',
    battalionSlug: battalionSlug || null,
    userId,
    username: member?.displayName || user.username || username,
    entrada: now,
    status: 'aberto',
  });

  // 3. Atualizar o painel de ponto configurado
  await updateConfiguredPontoPanel(guild);

  // 4. Enviar log administrativo
  const logChannel = await resolvePontoLogChannel(guild, corporationSlug || 'pmesp');
  if (logChannel) {
    const logPayload = buildPontoLogPayload({
      type: 'entrada',
      user,
      member: member || { displayName: username },
      ponto: pontoCriado,
      guild,
      now,
    });

    await logChannel.send(logPayload).catch((err) => {
      logger.error('[API] Erro ao enviar log de entrada:', err);
    });
  }

  return { success: true, code: 'success', message: "Ponto iniciado com sucesso no jogo." };
}

async function registrarSaidaAPI({ guild, userId, corporationSlug }) {
  // 1. Verificar se o usuário existe no Discord
  const member = await guild.members.fetch(userId).catch(() => null);
  const user = member?.user || await guild.client.users.fetch(userId).catch(() => null);

  // 2. Buscar ponto ativo
  const ativo = await Ponto.findOne({ userId, status: 'aberto' });
  if (!ativo) {
    return { success: true, code: 'already_closed', message: "Nenhum ponto em aberto localizado para este oficial." };
  }

  const now = new Date();
  const durationMs = now.getTime() - ativo.entrada.getTime();

  ativo.saida = now;
  ativo.status = 'fechado';
  ativo.durationMs = durationMs;
  if (member?.displayName || user?.username) {
    ativo.username = member?.displayName || user.username;
  }
  await ativo.save();

  // 3. Atualizar o painel de ponto configurado
  await updateConfiguredPontoPanel(guild);

  // 4. Enviar log administrativo
  const logChannel = await resolvePontoLogChannel(guild, corporationSlug || ativo.corporationSlug || 'pmesp');
  if (logChannel) {
    const logPayload = buildPontoLogPayload({
      type: 'saida',
      user: user || { id: userId, username: ativo.username },
      member: member || { displayName: ativo.username },
      ponto: ativo,
      guild,
      now,
      durationMs,
    });

    await logChannel.send(logPayload).catch((err) => {
      logger.error('[API] Erro ao enviar log de saída:', err);
    });
  }

  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const timeStr = `${hours}h ${minutes}m ${seconds}s`;

  return { success: true, code: 'success', message: `Ponto encerrado no jogo! Ativo por ${timeStr}.`, durationMs };
}

module.exports = {
  buildMainPontoEmbed,
  buildStatusPontoEmbed,
  buildStatusPontoPayload,
  buildPontoEmbeds,
  buildPontoButtons,
  buildPontoPanelPayload,
  registrarEntrada,
  registrarSaida,
  atualizarStatus,
  verRanking,
  togglePonto,
  encerrarPontoUsuario,
  encerrarTodosPontos,
  formatDurationWithSeconds,
  registrarEntradaAPI,
  registrarSaidaAPI,
  updateConfiguredPontoPanel,
};
