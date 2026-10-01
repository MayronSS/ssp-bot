const {
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
} = require('discord.js');
const logger = require('../utils/logger');
const resolver = require('../utils/resolver');
const emojiHelper = require('../utils/emojiHelper');

const SENSITIVE_PERMISSIONS = [
  ['Admin', PermissionFlagsBits.Administrator],
  ['Gerenciar servidor', PermissionFlagsBits.ManageGuild],
  ['Gerenciar cargos', PermissionFlagsBits.ManageRoles],
  ['Gerenciar canais', PermissionFlagsBits.ManageChannels],
  ['Banir', PermissionFlagsBits.BanMembers],
  ['Expulsar', PermissionFlagsBits.KickMembers],
  ['Moderar', PermissionFlagsBits.ModerateMembers],
  ['Gerenciar mensagens', PermissionFlagsBits.ManageMessages],
  ['Mencionar todos', PermissionFlagsBits.MentionEveryone],
  ['Webhooks', PermissionFlagsBits.ManageWebhooks],
];

const PUBLIC_FLAG_LABELS = {
  ActiveDeveloper: 'Active Developer',
  BugHunterLevel1: 'Bug Hunter I',
  BugHunterLevel2: 'Bug Hunter II',
  CertifiedModerator: 'Certified Moderator',
  HypeSquadOnlineHouse1: 'House Bravery',
  HypeSquadOnlineHouse2: 'House Brilliance',
  HypeSquadOnlineHouse3: 'House Balance',
  Hypesquad: 'HypeSquad Events',
  Partner: 'Partner',
  PremiumEarlySupporter: 'Early Supporter',
  Staff: 'Discord Staff',
  TeamPseudoUser: 'Team User',
  VerifiedBot: 'Verified Bot',
  VerifiedDeveloper: 'Verified Developer',
};

function truncate(value, max = 900) {
  const text = String(value || '');
  return text.length <= max ? text : `${text.slice(0, max - 16)}... [cortado]`;
}

function safeCode(value, fallback = 'N/A') {
  const text = value === undefined || value === null || value === '' ? fallback : String(value);
  return `\`${text.replace(/`/g, "'")}\``;
}

function toDiscordTimestamp(date, style = 'f') {
  const timestamp = date ? new Date(date).getTime() : NaN;
  if (!Number.isFinite(timestamp)) return 'N/A';
  return `<t:${Math.floor(timestamp / 1000)}:${style}>`;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'N/A';

  const minutes = Math.floor(ms / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function normalizeName(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function getDisplayTag(user) {
  if (!user) return 'N/A';
  if (user.discriminator && user.discriminator !== '0') {
    return `${user.username}#${user.discriminator}`;
  }
  return user.tag || user.username || 'N/A';
}

function getPublicFlags(user) {
  const rawFlags = user?.flags?.toArray?.() || [];
  if (!rawFlags.length) return 'Nenhuma';
  return rawFlags.map((flag) => PUBLIC_FLAG_LABELS[flag] || flag).join(', ');
}

function getSensitivePermissions(member) {
  if (!member?.permissions) return [];
  return SENSITIVE_PERMISSIONS
    .filter(([, bit]) => member.permissions.has(bit))
    .map(([name]) => name);
}

function getRoleSummary(member) {
  const roles = member?.roles?.cache
    ?.filter((role) => role.id !== member.guild.id)
    ?.sort((a, b) => b.position - a.position)
    ?.map((role) => `<@&${role.id}>`) || [];

  if (!roles.length) return 'Nenhum';
  const visible = roles.slice(0, 8).join(', ');
  return roles.length > 8 ? `${visible} e mais ${roles.length - 8}` : visible;
}

function collectNameKeys(member, user) {
  return [
    user?.username,
    user?.globalName,
    member?.displayName,
    member?.nickname,
  ]
    .map(normalizeName)
    .filter((value, index, list) => value.length >= 3 && list.indexOf(value) === index);
}

function isUsefulNameMatch(key) {
  return key.length >= 5 && !['police', 'lspd', 'staff', 'admin', 'oficial'].includes(key);
}

async function fetchComparableMembers(guild) {
  if (guild.members.cache.size >= Math.min(guild.memberCount || 0, 250)) {
    return guild.members.cache;
  }

  try {
    return await guild.members.fetch();
  } catch (error) {
    logger.debug(`Analise de membros usando cache local: ${error.message}`);
    return guild.members.cache;
  }
}

async function findRelatedAccounts(member, user) {
  const targetKeys = collectNameKeys(member, user);
  const targetAvatar = user?.avatar || null;
  const members = await fetchComparableMembers(member.guild);
  const matches = [];

  for (const [, other] of members) {
    if (!other?.user || other.user.id === user.id) continue;
    if (other.user.bot) continue;

    const otherKeys = collectNameKeys(other, other.user);
    const reasons = [];
    const sharedKey = targetKeys.find((key) => isUsefulNameMatch(key) && otherKeys.includes(key));
    const fuzzyKey = targetKeys.find((key) =>
      isUsefulNameMatch(key) && otherKeys.some((otherKey) =>
        isUsefulNameMatch(otherKey) && Math.abs(key.length - otherKey.length) <= 3 && (key.includes(otherKey) || otherKey.includes(key))
      )
    );

    if (targetAvatar && other.user.avatar === targetAvatar) reasons.push('mesmo avatar');
    if (sharedKey) reasons.push('nome igual');
    if (!sharedKey && fuzzyKey) reasons.push('nome parecido');

    if (reasons.length) {
      matches.push({
        id: other.user.id,
        tag: getDisplayTag(other.user),
        reasons,
      });
    }
  }

  return matches
    .sort((a, b) => b.reasons.length - a.reasons.length)
    .slice(0, 3);
}

function buildAttentionSignals({ member, user, relatedAccounts }) {
  const accountAgeDays = (Date.now() - user.createdTimestamp) / 86400000;
  const checkedNames = [user.username, user.globalName, member.displayName, member.nickname]
    .filter(Boolean)
    .join(' ');
  const signals = [];
  let score = 0;

  if (accountAgeDays < 1) {
    score += 4;
    signals.push('conta criada ha menos de 24h');
  } else if (accountAgeDays < 7) {
    score += 3;
    signals.push('conta criada ha menos de 7 dias');
  } else if (accountAgeDays < 30) {
    score += 2;
    signals.push('conta criada ha menos de 30 dias');
  }

  if (!user.avatar) {
    score += 1;
    signals.push('sem avatar personalizado');
  }

  if (member.pending) {
    score += 1;
    signals.push('screening pendente');
  }

  if (user.bot) {
    score += 2;
    signals.push('conta bot');
  }

  if (/(discord\.gg|https?:\/\/|nitro|gift|free|airdrop|steam|\.ru|\.com|@everyone|@here)/i.test(checkedNames)) {
    score += 2;
    signals.push('nome com padrao de link/promocao');
  }

  if (relatedAccounts.some((account) => account.reasons.includes('mesmo avatar'))) {
    score += 2;
    signals.push('avatar repetido no servidor');
  }

  if (relatedAccounts.some((account) => account.reasons.some((reason) => reason.includes('nome')))) {
    score += 1;
    signals.push('nome parecido no servidor');
  }

  const level = score >= 5 ? 'ALTA' : score >= 3 ? 'MEDIA' : score >= 1 ? 'BAIXA' : 'OK';
  return { level, score, signals };
}

async function buildMemberProfile(member) {
  const fetchedUser = await member.client.users.fetch(member.id, { force: true }).catch(() => member.user);
  const user = fetchedUser || member.user;
  const relatedAccounts = await findRelatedAccounts(member, user);
  const attention = buildAttentionSignals({ member, user, relatedAccounts });
  const avatarUrl = user.displayAvatarURL?.({ extension: 'png', size: 1024, forceStatic: false }) || null;
  const memberAvatarUrl = member.displayAvatarURL?.({ extension: 'png', size: 1024, forceStatic: false }) || avatarUrl;
  const accountAgeMs = Date.now() - user.createdTimestamp;
  const joinedDurationMs = member.joinedTimestamp ? Date.now() - member.joinedTimestamp : null;

  return {
    user,
    relatedAccounts,
    attention,
    avatarUrl,
    memberAvatarUrl,
    accountAgeText: formatDuration(accountAgeMs),
    joinedDurationText: joinedDurationMs === null ? 'N/A' : formatDuration(joinedDurationMs),
    sensitivePermissions: getSensitivePermissions(member),
  };
}

function buildRelatedAccountsText(relatedAccounts) {
  if (!relatedAccounts.length) return 'Nenhuma';

  return relatedAccounts.map((account, index) => {
    const reasons = account.reasons.join(', ');
    return `${index + 1}. <@${account.id}> ${safeCode(account.tag)} | ${reasons}`;
  }).join('\n');
}

function buildMemberLogPayload({ type, member, profile }) {
  const isJoin = type === 'join';
  const { user } = profile;
  const icon = isJoin ? emojiHelper.get('check') : emojiHelper.get('stop');
  const title = isJoin ? 'Entrada de Membro' : 'Saida de Membro';
  const action = isJoin ? 'entrou no servidor' : 'saiu do servidor';
  const avatarUrl = profile.memberAvatarUrl || profile.avatarUrl;
  const sensitivePermissions = profile.sensitivePermissions.length
    ? profile.sensitivePermissions.join(', ')
    : 'Nenhuma';
  const signals = profile.attention.signals.length
    ? profile.attention.signals.slice(0, 3).join(' | ')
    : 'Nenhum sinal automatico';

  const header = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent([
        `${icon} **${title}**`,
        `> <@${user.id}> ${action}.`,
        `**${member.displayName || user.username}** | ${safeCode(getDisplayTag(user))}`,
        `ID: ${safeCode(user.id)}`,
      ].join('\n'))
    )
    .setThumbnailAccessory(
      new ThumbnailBuilder()
        .setURL(avatarUrl)
        .setDescription(`Avatar de ${member.displayName || user.username}`)
    );

  const identitySection = [
    `**Usuario:** ${safeCode(user.username)} | **Global:** ${safeCode(user.globalName)}`,
    `**Conta criada:** ${toDiscordTimestamp(user.createdAt, 'f')} (${toDiscordTimestamp(user.createdAt, 'R')})`,
    `**Idade:** ${profile.accountAgeText}`,
    `**Evento:** ${toDiscordTimestamp(new Date(), 'f')}`,
    `**Entrada no servidor:** ${toDiscordTimestamp(member.joinedAt, 'f')}`,
    `**Tempo no servidor:** ${profile.joinedDurationText}`,
  ].join('\n');

  const reviewSection = [
    `**Analise:** ${profile.attention.level} | Score ${profile.attention.score}`,
    `**Sinais:** ${signals}`,
    `**Contas parecidas:** ${buildRelatedAccountsText(profile.relatedAccounts)}`,
  ].join('\n');

  const serverSection = [
    `**Cargos:** ${getRoleSummary(member)}`,
    `**Permissoes sensiveis:** ${sensitivePermissions}`,
    `**Flags publicas:** ${getPublicFlags(user)}`,
    `**Screening:** ${member.pending ? 'Pendente' : 'OK'} | **Boost:** ${member.premiumSince ? toDiscordTimestamp(member.premiumSince, 'R') : 'Nao'}`,
    `**Avatar:** ${avatarUrl ? `[abrir imagem](${avatarUrl})` : 'Nao possui'}`,
  ].join('\n');

  const container = new ContainerBuilder()
    .setAccentColor(0x111625)
    .addSectionComponents(header)
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(truncate(identitySection, 700)))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(truncate(reviewSection, 650)))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(truncate(serverSection, 700)));

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { users: [], roles: [] },
  };
}

async function resolveMemberLogChannel(guild, type) {
  const key = type === 'join' ? 'memberLogsEntrada' : 'memberLogsSaida';
  const customId = type === 'join' ? '1510854551593549944' : '1510854751955325128';

  const configService = require('./configService');
  let channelId = await configService.getChannel(guild.id, key);

  if (!channelId) {
    channelId = customId;
  }

  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (channel) return channel;

  return resolver.resolveChannel(guild, 'memberLogs', '📄・log-membros', { autoCreate: false });
}

async function sendMemberLog(member, type) {
  try {
    const channel = await resolveMemberLogChannel(member.guild, type);
    if (!channel) return;

    const profile = await buildMemberProfile(member);
    await channel.send(buildMemberLogPayload({ type, member, profile }));
  } catch (error) {
    logger.error(`Erro ao enviar log de ${type === 'join' ? 'entrada' : 'saida'} de membro:`, error);
  }
}

module.exports = {
  sendMemberLog,
};
