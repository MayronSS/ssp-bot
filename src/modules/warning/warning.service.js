const DisciplinaryWarning = require('../../database/models/DisciplinaryWarning');
const disciplinaryService = require('../../services/disciplinaryService');
const resolver = require('../../utils/resolver');
const componentFactory = require('../../utils/componentFactory');
const logger = require('../../utils/logger');
const configService = require('../../services/configService');

/**
 * Aplica uma advertência direta (sem denúncia) a um policial.
 *
 * @param {Guild} guild - Servidor do Discord.
 * @param {string} userId - ID do Discord do oficial.
 * @param {string} level - Nível da advertência ('verbal', 'adv1', 'adv2', 'adv3').
 * @param {string} duration - Duração da advertência ('d7', 'd15', 'd30', 'd60', 'permanent').
 * @param {string} reason - Motivo/Justificativa da punição.
 * @param {string} appliedBy - ID do Discord do moderador que aplicou.
 */
async function applyDirectWarning(guild, userId, level, duration, reason, appliedBy) {
  const penalty = disciplinaryService.PENALTIES[level];
  if (!penalty) throw new Error('Nível de advertência inválido.');

  const resolvedDuration = disciplinaryService.resolveDuration(duration);
  const durationDays = resolvedDuration.days;
  const durationPermanent = Boolean(resolvedDuration.permanent);

  const roleId = await disciplinaryService.getPenaltyRoleId(guild.id, level);
  if (!roleId) throw new Error(`Cargo da penalidade ${penalty.label} não configurado.`);

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) throw new Error('Oficial não encontrado no servidor.');

  const expiresAt = durationPermanent ? null : new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
  const caseNumber = `DIR-${Date.now().toString().slice(-8)}`;

  let roleAdded = false;
  let warning = null;

  try {
    // 1. Adicionar cargo ao membro
    await member.roles.add(roleId, `Advertência Direta ${caseNumber}: ${penalty.label} - Motivo: ${reason}`);
    roleAdded = true;

    // 2. Gravar no Banco de Dados
    warning = await DisciplinaryWarning.create({
      guildId: guild.id,
      userId,
      roleId,
      penalty: level,
      caseId: null, // Opcional, pois é advertência direta
      caseNumber,
      appliedBy,
      expiresAt,
      permanent: durationPermanent,
      status: 'active',
      reason
    });

    // 3. Enviar Log de auditoria
    const logChannelId = await configService.getChannel(guild.id, 'disciplinaryWarnings');
    if (logChannelId) {
      const logChannel = guild.channels.cache.get(logChannelId)
        || await guild.channels.fetch(logChannelId).catch(() => null);

      if (logChannel?.isTextBased()) {
        const payloadData = {
          caseNumber,
          userId,
          userTag: member.user.username,
          penaltyLabel: penalty.label,
          durationLabel: resolvedDuration.label,
          expiresAt,
          appliedBy,
          reason,
          avatarURL: member.user.displayAvatarURL({ forceStatic: true }),
        };
        await logChannel.send(componentFactory.createDirectWarningLogPayload(payloadData)).catch((err) => {
          logger.warn(`Falha ao enviar log de advertência direta no canal: ${err.message}`);
        });
      }
    }

    // 4. Enviar notificação em DM
    try {
      const dmPayload = componentFactory.createDirectWarningDmPayload({
        caseNumber,
        userId,
        penaltyLabel: penalty.label,
        durationLabel: resolvedDuration.label,
        expiresAt,
        appliedBy,
        reason,
      });
      await member.send(dmPayload);
    } catch (dmError) {
      logger.warn(`Não foi possível enviar DM para o policial advertido (${userId}): ${dmError.message}`);
    }

    logger.success(`Advertência direta ${caseNumber} aplicada por <@${appliedBy}> em <@${userId}>`);
    return warning;
  } catch (error) {
    if (warning?._id) {
      await DisciplinaryWarning.deleteOne({ _id: warning._id }).catch(() => null);
    }
    if (roleAdded) {
      await member.roles.remove(roleId, `Rollback da aplicação de advertência direta ${caseNumber}`).catch(() => null);
    }
    throw error;
  }
}

module.exports = {
  applyDirectWarning,
};
