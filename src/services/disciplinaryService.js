const CorregedoriaCase = require('../database/models/CorregedoriaCase');
const DisciplinaryWarning = require('../database/models/DisciplinaryWarning');
const configService = require('./configService');
const env = require('../config/env');
const logger = require('../utils/logger');
const componentFactory = require('../utils/componentFactory');

const PENALTIES = {
  verbal: {
    label: 'Advertência verbal',
    shortLabel: 'Verbal',
    roleKey: 'advVerbal',
    fallbackRoleId: '1508503597565087985',
    defaultDays: Number(env.ADV_VERBAL_DAYS || 1),
  },
  adv1: {
    label: 'ADV 1',
    shortLabel: 'ADV 1',
    roleKey: 'adv1',
    fallbackRoleId: '1508503623502528542',
    defaultDays: Number(env.ADV_1_DAYS || 7),
  },
  adv2: {
    label: 'ADV 2',
    shortLabel: 'ADV 2',
    roleKey: 'adv2',
    fallbackRoleId: '1508503641789698182',
    defaultDays: Number(env.ADV_2_DAYS || 14),
  },
  adv3: {
    label: 'ADV 3',
    shortLabel: 'ADV 3',
    roleKey: 'adv3',
    fallbackRoleId: '1508503655920435330',
    defaultDays: Number(env.ADV_3_DAYS || 30),
  },
  arquivar: {
    label: 'Arquivar sem advertência',
    shortLabel: 'Arquivar',
    defaultDays: 0,
  },
};

const VOTE_ORDER = ['verbal', 'adv1', 'adv2', 'adv3', 'arquivar'];
const DURATION_OPTIONS = {
  d7: { label: '7 dias', days: 7 },
  d15: { label: '15 dias', days: 15 },
  d30: { label: '30 dias', days: 30 },
  d60: { label: '60 dias', days: 60 },
  permanent: { label: 'Permanente', days: null, permanent: true },
};
const DURATION_ORDER = ['d7', 'd15', 'd30', 'd60', 'permanent'];

function getPenalty(option) {
  return PENALTIES[option] || null;
}

function getDurationOption(option) {
  return DURATION_OPTIONS[option] || null;
}

function safeDefaultDays(option) {
  const value = Number(getPenalty(option)?.defaultDays);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function createCaseNumber() {
  return `COR-${Date.now().toString().slice(-8)}-${Math.floor(Math.random() * 900 + 100)}`;
}

function valuesFromVotes(votes) {
  if (!votes) return [];
  if (votes instanceof Map || typeof votes.values === 'function') return [...votes.values()];
  return Object.values(votes);
}

function entriesFromMapLike(mapLike) {
  if (!mapLike) return [];
  if (mapLike instanceof Map || typeof mapLike.entries === 'function') return [...mapLike.entries()];
  return Object.entries(mapLike);
}

function getVoteCounts(votes) {
  const counts = Object.fromEntries(VOTE_ORDER.map((option) => [option, 0]));

  for (const option of valuesFromVotes(votes)) {
    if (Object.prototype.hasOwnProperty.call(counts, option)) {
      counts[option] += 1;
    }
  }

  return counts;
}

function getDurationVoteCounts(votes) {
  const counts = Object.fromEntries(DURATION_ORDER.map((option) => [option, 0]));

  for (const option of valuesFromVotes(votes)) {
    if (Object.prototype.hasOwnProperty.call(counts, option)) {
      counts[option] += 1;
    }
  }

  return counts;
}

function getTodayCounts(votes, voteTimestamps, order) {
  const counts = Object.fromEntries(order.map((option) => [option, 0]));
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  for (const [voterId, votedAt] of entriesFromMapLike(voteTimestamps)) {
    const date = votedAt instanceof Date ? votedAt : new Date(votedAt);
    if (Number.isNaN(date.getTime()) || date < startOfDay) continue;

    const option = typeof votes?.get === 'function' ? votes.get(voterId) : votes?.[voterId];
    if (Object.prototype.hasOwnProperty.call(counts, option)) {
      counts[option] += 1;
    }
  }

  return counts;
}

function getTodayVoteCounts(votes, voteTimestamps) {
  return getTodayCounts(votes, voteTimestamps, VOTE_ORDER);
}

function getTodayDurationVoteCounts(votes, voteTimestamps) {
  return getTodayCounts(votes, voteTimestamps, DURATION_ORDER);
}

function sumCounts(counts) {
  return Object.values(counts || {}).reduce((total, value) => total + Number(value || 0), 0);
}

function getWinnerFromCounts(counts, order) {
  let winner = null;
  let winnerCount = 0;

  for (const option of order) {
    if (counts[option] > winnerCount) {
      winner = option;
      winnerCount = counts[option];
    }
  }

  return winnerCount > 0 ? winner : null;
}

function getWinningOption(votes) {
  return getWinnerFromCounts(getVoteCounts(votes), VOTE_ORDER);
}

function getWinningDuration(votes) {
  return getWinnerFromCounts(getDurationVoteCounts(votes), DURATION_ORDER);
}

function caseToPayloadData(caseDoc) {
  const doc = caseDoc.toObject ? caseDoc.toObject() : caseDoc;
  const voteCounts = getVoteCounts(caseDoc.votes || doc.votes);
  const todayVoteCounts = getTodayVoteCounts(caseDoc.votes || doc.votes, caseDoc.voteTimestamps || doc.voteTimestamps);
  const durationVoteCounts = getDurationVoteCounts(caseDoc.durationVotes || doc.durationVotes);
  const todayDurationVoteCounts = getTodayDurationVoteCounts(
    caseDoc.durationVotes || doc.durationVotes,
    caseDoc.durationVoteTimestamps || doc.durationVoteTimestamps
  );
  const winningOption = getWinningOption(caseDoc.votes || doc.votes);
  const winningDuration = getWinningDuration(caseDoc.durationVotes || doc.durationVotes);
  const selectedPenalty = doc.selectedPenalty || winningOption;
  const winningLabel = winningOption ? getPenalty(winningOption)?.shortLabel : 'Sem votos';
  const winningDurationLabel = winningDuration ? getDurationOption(winningDuration)?.label : 'Sem votos';

  return {
    ...doc,
    accusedMention: `<@${doc.accusedUserId}>`,
    createdByMention: `<@${doc.createdBy}>`,
    appliedByMention: doc.appliedBy ? `<@${doc.appliedBy}>` : '',
    ticketChannelMention: doc.ticketChannelId ? `<#${doc.ticketChannelId}>` : doc.ticketChannelName || 'Canal não informado',
    rankLabel: doc.rankRoleId ? `<@&${doc.rankRoleId}>` : doc.rankLabel || 'Não informado',
    voteCounts,
    todayVoteCounts,
    durationVoteCounts,
    todayDurationVoteCounts,
    caseVoteTotal: sumCounts(voteCounts),
    todayVoteTotal: sumCounts(todayVoteCounts),
    durationVoteTotal: sumCounts(durationVoteCounts),
    todayDurationVoteTotal: sumCounts(todayDurationVoteCounts),
    winningOption,
    winningLabel,
    winningDuration,
    winningDurationLabel,
    selectedPenaltyLabel: selectedPenalty ? getPenalty(selectedPenalty)?.label : '',
  };
}

async function getCaseVotingChannel(guild, channelId) {
  if (!channelId) return null;
  return guild.channels.cache.get(channelId) || guild.channels.fetch(channelId).catch(() => null);
}

async function getCaseResultChannel(guild) {
  const configuredId = await configService.getChannel(guild.id, 'corregedoriaResults')
    || await configService.getChannel(guild.id, 'disciplinaryWarnings');
  if (!configuredId) return null;
  return guild.channels.cache.get(configuredId) || guild.channels.fetch(configuredId).catch(() => null);
}

async function getPenaltyRoleId(guildId, option) {
  const penalty = getPenalty(option);
  if (!penalty?.roleKey) return null;

  return await configService.getRole(guildId, penalty.roleKey) || penalty.fallbackRoleId;
}

async function createCase(guild, data, files = []) {
  const targetChannel = await getCaseVotingChannel(guild, data.ticketChannelId);
  if (!targetChannel?.isTextBased?.()) {
    throw new Error('Canal da denuncia nao encontrado ou nao e textual.');
  }

  const caseDoc = await CorregedoriaCase.create({
    ...data,
    guildId: guild.id,
    caseNumber: createCaseNumber(),
    caseChannelId: targetChannel.id,
    status: 'voting',
  });

  let message;
  try {
    message = await targetChannel.send({
      ...componentFactory.createCorregedoriaCasePayload(caseToPayloadData(caseDoc)),
      files,
    });
  } catch (error) {
    await CorregedoriaCase.deleteOne({ _id: caseDoc._id }).catch(() => null);
    throw error;
  }

  caseDoc.caseMessageId = message.id;
  await caseDoc.save();

  return { caseDoc, message };
}

async function findCaseByMessage(messageId) {
  return CorregedoriaCase.findOne({ caseMessageId: messageId });
}

async function registerVote(messageId, voterId, option) {
  if (!getPenalty(option)) {
    throw new Error('Opção de voto inválida.');
  }

  const caseDoc = await findCaseByMessage(messageId);
  if (!caseDoc) throw new Error('Caso de corregedoria não encontrado.');
  if (caseDoc.status !== 'voting') throw new Error('A votação deste caso já foi encerrada.');

  caseDoc.votes.set(String(voterId), option);
  caseDoc.voteTimestamps.set(String(voterId), new Date());
  await caseDoc.save();
  return caseDoc;
}

async function registerDurationVote(messageId, voterId, option) {
  if (!getDurationOption(option)) {
    throw new Error('Opcao de duracao invalida.');
  }

  const caseDoc = await findCaseByMessage(messageId);
  if (!caseDoc) throw new Error('Caso de corregedoria nao encontrado.');
  if (caseDoc.status !== 'voting') throw new Error('A votacao deste caso ja foi encerrada.');

  if (!caseDoc.durationVotes) caseDoc.durationVotes = new Map();
  if (!caseDoc.durationVoteTimestamps) caseDoc.durationVoteTimestamps = new Map();
  caseDoc.durationVotes.set(String(voterId), option);
  caseDoc.durationVoteTimestamps.set(String(voterId), new Date());
  await caseDoc.save();
  return caseDoc;
}

async function archiveCase(messageId, appliedBy) {
  const caseDoc = await findCaseByMessage(messageId);
  if (!caseDoc) throw new Error('Caso de corregedoria não encontrado.');
  if (caseDoc.status !== 'voting') throw new Error('Este caso já foi finalizado.');

  caseDoc.status = 'archived';
  caseDoc.selectedPenalty = 'arquivar';
  caseDoc.appliedBy = appliedBy;
  caseDoc.durationDays = null;
  caseDoc.durationPermanent = false;
  caseDoc.expiresAt = null;
  await caseDoc.save();
  return caseDoc;
}

function resolveDuration(duration) {
  const configured = getDurationOption(duration);
  if (configured) return configured;

  const durationDays = Number(duration);
  if (!Number.isFinite(durationDays) || durationDays <= 0 || durationDays > 365) {
    throw new Error('Informe uma duracao entre 1 e 365 dias ou permanente.');
  }

  return { label: `${durationDays} dias`, days: durationDays, permanent: false };
}

async function applyPenalty(messageId, guild, option, duration, appliedBy) {
  const penalty = getPenalty(option);
  if (!penalty) throw new Error('Penalidade inválida.');
  if (option === 'arquivar') return { caseDoc: await archiveCase(messageId, appliedBy), warning: null };

  const caseDoc = await findCaseByMessage(messageId);
  if (!caseDoc) throw new Error('Caso de corregedoria não encontrado.');
  if (caseDoc.status !== 'voting') throw new Error('Este caso já foi finalizado.');

  const resolvedDuration = resolveDuration(duration);
  const durationDays = resolvedDuration.days;
  const durationPermanent = Boolean(resolvedDuration.permanent);

  const roleId = await getPenaltyRoleId(guild.id, option);
  if (!roleId) throw new Error(`Cargo da penalidade ${penalty.label} não configurado.`);

  const member = await guild.members.fetch(caseDoc.accusedUserId).catch(() => null);
  if (!member) throw new Error('Oficial denunciado não encontrado no servidor.');

  const expiresAt = durationPermanent ? null : new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
  let roleAdded = false;
  let warning = null;

  try {
    await member.roles.add(roleId, `Corregedoria ${caseDoc.caseNumber}: ${penalty.label}`);
    roleAdded = true;

    warning = await DisciplinaryWarning.create({
      guildId: guild.id,
      userId: caseDoc.accusedUserId,
      roleId,
      penalty: option,
      caseId: caseDoc._id,
      caseNumber: caseDoc.caseNumber,
      appliedBy,
      expiresAt,
      permanent: durationPermanent,
      reason: caseDoc.reason || caseDoc.description || 'Punição aplicada via Corregedoria'
    });

    caseDoc.status = 'applied';
    caseDoc.selectedPenalty = option;
    caseDoc.durationDays = durationPermanent ? null : durationDays;
    caseDoc.durationPermanent = durationPermanent;
    caseDoc.expiresAt = expiresAt;
    caseDoc.appliedBy = appliedBy;
    await caseDoc.save();
  } catch (error) {
    if (warning?._id) {
      await DisciplinaryWarning.deleteOne({ _id: warning._id }).catch(() => null);
    }
    if (roleAdded) {
      await member.roles.remove(roleId, `Rollback da aplicação da advertência ${caseDoc.caseNumber}`).catch(() => null);
    }
    throw error;
  }

  return { caseDoc, warning };
}

async function updateCaseMessage(caseDoc, client) {
  const guild = client.guilds.cache.get(caseDoc.guildId) || await client.guilds.fetch(caseDoc.guildId).catch(() => null);
  if (!guild) return;

  const channel = guild.channels.cache.get(caseDoc.caseChannelId) || await guild.channels.fetch(caseDoc.caseChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;

  const message = await channel.messages.fetch(caseDoc.caseMessageId).catch(() => null);
  if (!message) return;

  await message.edit(componentFactory.createCorregedoriaCasePayload(caseToPayloadData(caseDoc))).catch((error) => {
    logger.warn(`Não foi possível atualizar o caso ${caseDoc.caseNumber}: ${error.message}`);
  });
}

async function sendCaseResult(caseDoc, client) {
  try {
    const guild = client.guilds.cache.get(caseDoc.guildId) || await client.guilds.fetch(caseDoc.guildId).catch(() => null);
    if (!guild) return null;

    const channel = await getCaseResultChannel(guild);
    if (!channel?.isTextBased?.()) {
      logger.warn(`Canal de resultado da corregedoria nao configurado para o caso ${caseDoc.caseNumber}.`);
      return null;
    }

    const payload = componentFactory.createCorregedoriaCasePayload(caseToPayloadData(caseDoc));

    if (caseDoc.resultMessageId && caseDoc.resultChannelId) {
      const existingChannel = guild.channels.cache.get(caseDoc.resultChannelId)
        || await guild.channels.fetch(caseDoc.resultChannelId).catch(() => null);
      const existingMessage = await existingChannel?.messages?.fetch(caseDoc.resultMessageId).catch(() => null);
      if (existingMessage) {
        await existingMessage.edit(payload);
        return existingMessage;
      }
    }

    const message = await channel.send(payload);
    caseDoc.resultChannelId = channel.id;
    caseDoc.resultMessageId = message.id;
    caseDoc.resultSentAt = new Date();
    await caseDoc.save();

    return message;
  } catch (error) {
    logger.warn(`Nao foi possivel enviar resultado da corregedoria ${caseDoc.caseNumber}: ${error.message}`);
    return null;
  }
}

async function removeWarning(warning, client) {
  const guild = client.guilds.cache.get(warning.guildId) || await client.guilds.fetch(warning.guildId).catch(() => null);
  if (!guild) {
    warning.status = 'removed';
    warning.removedAt = new Date();
    warning.removalNote = 'Servidor não encontrado durante a expiração.';
    await warning.save();
    return;
  }

  const member = await guild.members.fetch(warning.userId).catch(() => null);
  if (member && member.roles.cache.has(warning.roleId)) {
    const removed = await member.roles.remove(warning.roleId, `Advertência expirada (${warning.caseNumber})`).then(() => true).catch((error) => {
      logger.warn(`Não foi possível remover advertência ${warning.caseNumber} de ${warning.userId}: ${error.message}`);
      warning.removalNote = `Falha ao remover cargo: ${error.message}`;
      return false;
    });

    if (!removed) {
      await warning.save();
      return;
    }
  }

  warning.status = 'removed';
  warning.removedAt = new Date();
  warning.removalNote = member ? 'Cargo removido por expiração automática.' : 'Membro não encontrado durante a expiração.';
  await warning.save();
}

let schedulerStarted = false;

function startWarningExpiryScheduler(client) {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const sweep = async () => {
    const expired = await DisciplinaryWarning.find({
      status: 'active',
      expiresAt: { $ne: null, $lte: new Date() },
    }).limit(25).catch((error) => {
      logger.warn(`Falha ao buscar advertências expiradas: ${error.message}`);
      return [];
    });

    for (const warning of expired) {
      await removeWarning(warning, client).catch((error) => {
        logger.warn(`Falha ao expirar advertência ${warning.caseNumber}: ${error.message}`);
      });
    }
  };

  sweep();
  setInterval(sweep, 60 * 1000);
  logger.info('Agendador de expiração de advertências iniciado.');
}

module.exports = {
  PENALTIES,
  VOTE_ORDER,
  DURATION_OPTIONS,
  DURATION_ORDER,
  safeDefaultDays,
  caseToPayloadData,
  getWinningOption,
  getWinningDuration,
  createCase,
  findCaseByMessage,
  registerVote,
  registerDurationVote,
  applyPenalty,
  updateCaseMessage,
  sendCaseResult,
  startWarningExpiryScheduler,
  resolveDuration,
  getPenaltyRoleId,
};
