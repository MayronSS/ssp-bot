const LspdAusencia = require('../../database/models/LspdAusencia');
const resolver = require('../../utils/resolver');
const logger = require('../../utils/logger');
const componentFactory = require('../../utils/componentFactory');
const emojiHelper = require('../../utils/emojiHelper');

/**
 * Resolve o canal de log de ausência baseado no corpSlug.
 * Se o canal específico da corporação existir, usa ele; senão, fallback para o unificado.
 */
async function resolveAusenciaLogChannel(guild, corpSlug) {
  const corpLogKeys = {
    pmesp: { key: 'ausenciaLogsPmesp', fallbackName: '📄・log-ausencia-pmesp' },
    pcesp: { key: 'ausenciaLogsPcesp', fallbackName: '📄・log-ausencia-pcesp' },
  };

  const corpEntry = corpLogKeys[corpSlug];
  if (corpEntry) {
    const corpChannel = await resolver.resolveChannel(guild, corpEntry.key, corpEntry.fallbackName, { autoCreate: false });
    if (corpChannel) return corpChannel;
  }

  // Fallback: canal unificado
  return resolver.resolveChannel(guild, 'ausenciaLogs', '📄・log-ausencias', { autoCreate: false });
}

/**
 * Envia o painel de avaliação de ausência no canal de logs.
 */
async function enviarAvaliacaoAusencia(guild, ausencia) {
  const corpSlug = ausencia.corporationSlug || 'pmesp';
  const logChannel = await resolveAusenciaLogChannel(guild, corpSlug);
  if (!logChannel) {
    logger.error('Canal de logs de ausência não encontrado e não pôde ser criado.');
    return null;
  }

  const member = await guild.members.fetch(ausencia.userId).catch(() => null);
  const displayName = member?.displayName || ausencia.username;
  const avatarURL = member?.user?.displayAvatarURL({ dynamic: true, size: 512 }) || null;

  const payload = componentFactory.createAusenciaEvaluationPayload({
    id: ausencia._id.toString(),
    userId: ausencia.userId,
    displayName,
    avatarURL,
    corporacao: ausencia.corporacao || 'PMESP',
    dataInicio: ausencia.dataInicio,
    dataFim: ausencia.dataFim,
    duracaoDias: ausencia.duracaoDias,
    motivo: ausencia.motivo,
  });

  const msg = await logChannel.send(payload);
  return msg;
}

/**
 * Registra a solicitação de ausência no banco de dados e envia para análise.
 */
async function registrarSolicitacao(interaction, { corporacao, corporationSlug, nomeRp, motivo, dataInicio, dataFim }) {
  const { guild, user, member } = interaction;
  const displayName = member?.displayName || user.username;

  // Tentar calcular a duração em dias
  let duracaoDias = 1;
  try {
    const parseDate = (str) => {
      const parts = str.split('/');
      if (parts.length === 3) {
        return new Date(parts[2], parts[1] - 1, parts[0]);
      }
      return new Date(str);
    };

    const dInicio = parseDate(dataInicio);
    const dFim = parseDate(dataFim);
    const diffTime = Math.abs(dFim - dInicio);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // inclusivo
    if (!isNaN(diffDays)) {
      duracaoDias = diffDays;
    }
  } catch (err) {
    logger.warn('Erro ao calcular a duração da ausência em dias:', err);
  }

  // Criar o registro no banco
  const ausencia = await LspdAusencia.create({
    guildId: guild.id,
    corporationSlug: corporationSlug || 'pmesp',
    userId: user.id,
    username: user.username,
    nomeRp,
    corporacao: corporacao || 'PMESP',
    passaporte: '-',
    motivo,
    dataInicio,
    dataFim,
    duracaoDias,
    status: 'pendente',
  });

  // Enviar a mensagem para o canal de avaliação
  const logMessage = await enviarAvaliacaoAusencia(guild, ausencia);
  if (logMessage) {
    ausencia.logMessageId = logMessage.id;
    await ausencia.save();
  }

  return ausencia;
}

/**
 * Aprova uma solicitação de ausência.
 */
async function aprovarAusencia(interaction, ausenciaId) {
  const { guild, user } = interaction;

  const ausencia = await LspdAusencia.findById(ausenciaId);
  if (!ausencia) {
    throw new Error('Solicitação de ausência não encontrada.');
  }

  if (ausencia.status !== 'pendente') {
    throw new Error(`Esta ausência já foi decidida. Status atual: ${ausencia.status}`);
  }

  ausencia.status = 'aprovado';
  ausencia.aprovadoPor = user.username;
  await ausencia.save();

  const member = await guild.members.fetch(ausencia.userId).catch(() => null);
  const displayName = member?.displayName || ausencia.username;
  const avatarURL = member?.user?.displayAvatarURL({ dynamic: true, size: 512 }) || null;

  // Atualizar a mensagem no canal de logs
  const logChannel = await resolveAusenciaLogChannel(guild, ausencia.corporationSlug || 'pmesp');
  if (logChannel && ausencia.logMessageId) {
    const msg = await logChannel.messages.fetch(ausencia.logMessageId).catch(() => null);
    if (msg) {
      const payload = componentFactory.createAusenciaResultPayload({
        userId: ausencia.userId,
        displayName,
        avatarURL,
        passaporte: ausencia.corporacao || 'PMESP',
        dataInicio: ausencia.dataInicio,
        dataFim: ausencia.dataFim,
        duracaoDias: ausencia.duracaoDias,
        motivo: ausencia.motivo,
        moderatorId: user.id,
      }, 'aprovado');

      await msg.edit(payload).catch((err) => logger.error('Erro ao editar mensagem de log de ausência:', err));
    }
  }

  // Notificar o policial por DM se possível
  const policialUser = await guild.client.users.fetch(ausencia.userId).catch(() => null);
  if (policialUser) {
    const dmPayload = componentFactory.createAusenciaResultPayload({
      userId: ausencia.userId,
      displayName,
      avatarURL,
      passaporte: ausencia.corporacao || 'PMESP',
      dataInicio: ausencia.dataInicio,
      dataFim: ausencia.dataFim,
      duracaoDias: ausencia.duracaoDias,
      motivo: ausencia.motivo,
      moderatorId: user.id,
    }, 'aprovado');

    await policialUser.send(dmPayload).catch(() => logger.warn(`Não foi possível enviar DM de notificação para o usuário ${ausencia.userId}`));
  }

  return ausencia;
}

/**
 * Reprova uma solicitação de ausência.
 */
async function reprovarAusencia(interaction, ausenciaId, motivo) {
  const { guild, user } = interaction;

  const ausencia = await LspdAusencia.findById(ausenciaId);
  if (!ausencia) {
    throw new Error('Solicitação de ausência não encontrada.');
  }

  if (ausencia.status !== 'pendente') {
    throw new Error(`Esta ausência já foi decidida. Status atual: ${ausencia.status}`);
  }

  ausencia.status = 'reprovado';
  ausencia.aprovadoPor = user.username; // Usado para registrar quem tomou a decisão
  ausencia.motivoReprovacao = motivo;
  await ausencia.save();

  const member = await guild.members.fetch(ausencia.userId).catch(() => null);
  const displayName = member?.displayName || ausencia.username;
  const avatarURL = member?.user?.displayAvatarURL({ dynamic: true, size: 512 }) || null;

  // Atualizar a mensagem no canal de logs
  const logChannel = await resolveAusenciaLogChannel(guild, ausencia.corporationSlug || 'pmesp');
  if (logChannel && ausencia.logMessageId) {
    const msg = await logChannel.messages.fetch(ausencia.logMessageId).catch(() => null);
    if (msg) {
      const payload = componentFactory.createAusenciaResultPayload({
        userId: ausencia.userId,
        displayName,
        avatarURL,
        passaporte: ausencia.corporacao || 'PMESP',
        dataInicio: ausencia.dataInicio,
        dataFim: ausencia.dataFim,
        duracaoDias: ausencia.duracaoDias,
        motivo: ausencia.motivo,
        moderatorId: user.id,
        motivoReprovacao: motivo,
      }, 'reprovado');

      await msg.edit(payload).catch((err) => logger.error('Erro ao editar mensagem de log de ausência:', err));
    }
  }

  // Notificar o policial por DM se possível
  const policialUser = await guild.client.users.fetch(ausencia.userId).catch(() => null);
  if (policialUser) {
    const dmPayload = componentFactory.createAusenciaResultPayload({
      userId: ausencia.userId,
      displayName,
      avatarURL,
      passaporte: ausencia.corporacao || 'PMESP',
      dataInicio: ausencia.dataInicio,
      dataFim: ausencia.dataFim,
      duracaoDias: ausencia.duracaoDias,
      motivo: ausencia.motivo,
      moderatorId: user.id,
      motivoReprovacao: motivo,
    }, 'reprovado');

    await policialUser.send(dmPayload).catch(() => logger.warn(`Não foi possível enviar DM de notificação para o usuário ${ausencia.userId}`));
  }

  return ausencia;
}

module.exports = {
  registrarSolicitacao,
  aprovarAusencia,
  reprovarAusencia,
};
