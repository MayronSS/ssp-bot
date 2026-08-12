const {
  AuditLogEvent,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
} = require('discord.js');
const env = require('../config/env');
const logger = require('../utils/logger');
const resolver = require('../utils/resolver');
const emojiHelper = require('../utils/emojiHelper');

const AUDIT_LOOKUP_MS = 20000;
const DEFAULT_ACCENT = 0x111625;
const HANDLED_AUDIT_TYPES = new Set([
  AuditLogEvent.MessageDelete,
  AuditLogEvent.MessageBulkDelete,
  AuditLogEvent.ChannelCreate,
  AuditLogEvent.ChannelUpdate,
  AuditLogEvent.ChannelDelete,
  AuditLogEvent.ChannelOverwriteCreate,
  AuditLogEvent.ChannelOverwriteUpdate,
  AuditLogEvent.ChannelOverwriteDelete,
  AuditLogEvent.RoleCreate,
  AuditLogEvent.RoleUpdate,
  AuditLogEvent.RoleDelete,
  AuditLogEvent.MemberRoleUpdate,
  AuditLogEvent.MemberUpdate,
  AuditLogEvent.MemberBanAdd,
  AuditLogEvent.MemberBanRemove,
  AuditLogEvent.InviteCreate,
  AuditLogEvent.InviteDelete,
  AuditLogEvent.WebhookCreate,
  AuditLogEvent.WebhookUpdate,
  AuditLogEvent.WebhookDelete,
  AuditLogEvent.EmojiCreate,
  AuditLogEvent.EmojiUpdate,
  AuditLogEvent.EmojiDelete,
  AuditLogEvent.StickerCreate,
  AuditLogEvent.StickerUpdate,
  AuditLogEvent.StickerDelete,
  AuditLogEvent.ThreadCreate,
  AuditLogEvent.ThreadUpdate,
  AuditLogEvent.ThreadDelete,
  AuditLogEvent.GuildUpdate,
  AuditLogEvent.MemberMove,
]);

function truncate(value, max = 900) {
  const text = String(value ?? '');
  return text.length <= max ? text : `${text.slice(0, max - 16)}... [cortado]`;
}

function code(value, fallback = 'N/A') {
  const text = value === undefined || value === null || value === '' ? fallback : String(value);
  return `\`${text.replace(/`/g, "'")}\``;
}

function bool(value) {
  return value ? 'Sim' : 'Nao';
}

function ts(date = new Date(), style = 'f') {
  const time = new Date(date).getTime();
  if (!Number.isFinite(time)) return 'N/A';
  return `<t:${Math.floor(time / 1000)}:${style}>`;
}

function icon(key, fallback) {
  return emojiHelper.get(key) || fallback;
}

function channelLabel(channel) {
  if (!channel) return 'N/A';
  if (channel.id && channel.guild) return `<#${channel.id}> ${code(channel.name || channel.id)}`;
  return code(channel.name || channel.id || 'N/A');
}

function userLabel(user) {
  if (!user) return 'N/A';
  const tag = user.tag || user.username || user.id;
  return `<@${user.id}> ${code(tag)} (${code(user.id)})`;
}

function roleLabel(roleOrId, guild = null) {
  const id = typeof roleOrId === 'string' ? roleOrId : roleOrId?.id;
  if (!id) return 'N/A';
  const role = guild?.roles?.cache?.get(id);
  return role ? `<@&${id}> ${code(role.name)}` : `<@&${id}>`;
}

function channelTypeName(type) {
  const found = Object.entries(ChannelType).find(([, value]) => value === type);
  return found ? found[0] : String(type ?? 'N/A');
}

function auditTypeName(type) {
  const found = Object.entries(AuditLogEvent).find(([, value]) => value === type);
  return found ? found[0] : String(type ?? 'N/A');
}

function stringifyValue(value) {
  if (value === undefined || value === null || value === '') return 'N/A';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(stringifyValue).join(', ');
  if (value.id && value.name) return `${value.name} (${value.id})`;
  if (value.id) return String(value.id);

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function permissionsText(permissions, max = 12) {
  const list = permissions?.toArray?.() || [];
  if (!list.length) return 'Nenhuma';
  const visible = list.slice(0, max).join(', ');
  return list.length > max ? `${visible} e mais ${list.length - max}` : visible;
}

function contentPreview(content, fallback = 'Sem conteudo de texto visivel.') {
  const text = String(content || '').trim();
  if (!text) return fallback;
  return truncate(text.replace(/```/g, "'''"), 850);
}

function attachmentPreview(attachments) {
  const list = attachments?.map?.((attachment) => attachment.url || attachment.name || attachment.id) || [];
  if (!list.length) return 'Nenhum';
  return list.slice(0, 5).join('\n');
}

function isOwnBotUser(user, client) {
  return user?.id && client?.user?.id && user.id === client.user.id;
}

function shouldIgnoreMessage(message) {
  if (!message?.guild) return true;
  if (isOwnBotUser(message.author, message.client)) return true;
  return false;
}

async function resolveAuditChannel(guild) {
  return resolver.resolveChannel(guild, 'adminLogs', '📄・log-gerais', { autoCreate: false });
}

async function fetchAuditEntry(guild, type, targetId = null, matcher = null) {
  if (!guild || !type) return null;

  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 5 });
    const now = Date.now();
    return logs.entries.find((entry) => {
      if (now - entry.createdTimestamp > AUDIT_LOOKUP_MS) return false;
      const entryTargetId = entry.targetId || entry.target?.id;
      if (targetId && entryTargetId && entryTargetId !== targetId) return false;
      if (matcher && !matcher(entry)) return false;
      return true;
    }) || null;
  } catch (error) {
    logger.debug(`Audit log indisponivel (${type}): ${error.message}`);
    return null;
  }
}

function actorLine(entry) {
  if (!entry?.executor) return 'Executor: `nao identificado`';
  return `Executor: ${userLabel(entry.executor)}`;
}

async function sendAuditLog(guild, payload) {
  try {
    const channel = await resolveAuditChannel(guild);
    if (!channel) return;

    const headerText = [
      `${payload.icon || icon('clipboard', '[LOG]')} **${payload.title}**`,
      payload.subject ? `> ${payload.subject}` : null,
      payload.actor ? actorLine(payload.actor) : null,
      `Horario: ${ts(new Date(), 'f')}`,
    ].filter(Boolean).join('\n');

    const container = new ContainerBuilder()
      .setAccentColor(payload.accentColor || DEFAULT_ACCENT);

    if (payload.thumbnailUrl) {
      const header = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText))
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(payload.thumbnailUrl)
            .setDescription(payload.thumbnailDescription || payload.title)
        );

      container.addSectionComponents(header);
    } else {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));
    }

    for (const section of payload.sections || []) {
      if (!section) continue;
      container
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(truncate(section)));
    }

    await channel.send({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { users: [], roles: [] },
    });
  } catch (error) {
    logger.error(`Erro ao enviar log de auditoria (${payload?.title || 'evento'}):`, error);
  }
}

function diffLine(label, before, after) {
  const oldValue = stringifyValue(before);
  const newValue = stringifyValue(after);
  if (oldValue === newValue) return null;
  return `**${label}:** ${code(oldValue)} -> ${code(newValue)}`;
}

function compactDiff(lines) {
  const clean = lines.filter(Boolean);
  return clean.length ? clean.join('\n') : 'Sem diferenca detalhada visivel.';
}

function overwriteKey(overwrite, guild) {
  const id = overwrite?.id;
  if (!id) return 'N/A';
  if (guild?.roles?.cache?.has(id)) return roleLabel(id, guild);
  return `<@${id}>`;
}

function overwriteSummary(oldChannel, newChannel) {
  const oldMap = oldChannel?.permissionOverwrites?.cache || new Map();
  const newMap = newChannel?.permissionOverwrites?.cache || new Map();
  const ids = [...new Set([...oldMap.keys(), ...newMap.keys()])];
  const lines = [];

  for (const id of ids) {
    const before = oldMap.get(id);
    const after = newMap.get(id);
    if (!before && after) {
      lines.push(`+ ${overwriteKey(after, newChannel.guild)} criado`);
      continue;
    }
    if (before && !after) {
      lines.push(`- ${overwriteKey(before, oldChannel.guild)} removido`);
      continue;
    }
    if (!before || !after) continue;

    const beforeAllow = before.allow.toArray().sort().join(', ');
    const afterAllow = after.allow.toArray().sort().join(', ');
    const beforeDeny = before.deny.toArray().sort().join(', ');
    const afterDeny = after.deny.toArray().sort().join(', ');

    if (beforeAllow !== afterAllow || beforeDeny !== afterDeny) {
      lines.push(`~ ${overwriteKey(after, newChannel.guild)} alterado`);
    }
  }

  if (!lines.length) return null;
  const visible = lines.slice(0, 8).join('\n');
  return lines.length > 8 ? `${visible}\n... e mais ${lines.length - 8}` : visible;
}

function channelDetails(channel) {
  return [
    `Canal: ${channelLabel(channel)}`,
    `ID: ${code(channel?.id)}`,
    `Tipo: ${code(channelTypeName(channel?.type))}`,
    `Categoria: ${channel?.parent ? channelLabel(channel.parent) : 'N/A'}`,
    channel?.topic ? `Topico: ${truncate(channel.topic, 250)}` : null,
  ].filter(Boolean).join('\n');
}

async function handleMessageUpdate(oldMessage, newMessage) {
  if (shouldIgnoreMessage(newMessage)) return;
  if ((oldMessage.content || '') === (newMessage.content || '') && oldMessage.attachments?.size === newMessage.attachments?.size) return;

  await sendAuditLog(newMessage.guild, {
    title: 'Mensagem Editada',
    icon: icon('refresh', '[EDIT]'),
    subject: `${userLabel(newMessage.author)} editou uma mensagem em ${channelLabel(newMessage.channel)}`,
    thumbnailUrl: newMessage.author?.displayAvatarURL?.({ extension: 'png', size: 256, forceStatic: false }),
    sections: [
      [
        `Autor: ${userLabel(newMessage.author)}`,
        `Canal: ${channelLabel(newMessage.channel)}`,
        `Mensagem: ${newMessage.url || code(newMessage.id)}`,
      ].join('\n'),
      `**Antes**\n${contentPreview(oldMessage.content, oldMessage.partial ? 'Conteudo antigo indisponivel.' : 'Sem conteudo.')}`,
      `**Depois**\n${contentPreview(newMessage.content)}`,
    ],
  });
}

async function handleMessageDelete(message) {
  if (shouldIgnoreMessage(message)) return;
  const entry = await fetchAuditEntry(
    message.guild,
    AuditLogEvent.MessageDelete,
    message.author?.id,
    (log) => !log.extra?.channel?.id || log.extra.channel.id === message.channel?.id
  );

  await sendAuditLog(message.guild, {
    title: 'Mensagem Excluida',
    icon: icon('stop', '[DEL]'),
    subject: `Mensagem removida em ${channelLabel(message.channel)}`,
    actor: entry,
    thumbnailUrl: message.author?.displayAvatarURL?.({ extension: 'png', size: 256, forceStatic: false }),
    sections: [
      [
        `Autor: ${message.author ? userLabel(message.author) : '`nao identificado/cache indisponivel`'}`,
        `Canal: ${channelLabel(message.channel)}`,
        `ID da mensagem: ${code(message.id)}`,
      ].join('\n'),
      `**Conteudo**\n${contentPreview(message.content, message.partial ? 'Conteudo indisponivel: mensagem nao estava em cache.' : 'Sem conteudo.')}`,
      `**Anexos**\n${attachmentPreview(message.attachments)}`,
    ],
  });
}

async function handleMessageDeleteBulk(messages, channel) {
  const guild = channel?.guild;
  if (!guild) return;

  const entry = await fetchAuditEntry(guild, AuditLogEvent.MessageBulkDelete, null, (log) =>
    !log.extra?.channel?.id || log.extra.channel.id === channel.id
  );
  const authors = [...new Set(messages.map((message) => message.author?.id).filter(Boolean))]
    .slice(0, 10)
    .map((id) => `<@${id}>`)
    .join(', ') || 'Nao identificado';

  await sendAuditLog(guild, {
    title: 'Mensagens Excluidas em Massa',
    icon: icon('stop', '[BULK]'),
    subject: `${messages.size} mensagens removidas em ${channelLabel(channel)}`,
    actor: entry,
    sections: [
      `Canal: ${channelLabel(channel)}\nQuantidade: ${code(messages.size)}\nAutores no cache: ${authors}`,
    ],
  });
}

async function handleChannelCreate(channel) {
  if (!channel?.guild) return;
  const entry = await fetchAuditEntry(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
  await sendAuditLog(channel.guild, {
    title: 'Canal Criado',
    icon: icon('clipboard', '[CANAL]'),
    subject: `${channelLabel(channel)} foi criado.`,
    actor: entry,
    sections: [channelDetails(channel)],
  });
}

async function handleChannelDelete(channel) {
  if (!channel?.guild) return;
  const entry = await fetchAuditEntry(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
  await sendAuditLog(channel.guild, {
    title: 'Canal Excluido',
    icon: icon('stop', '[CANAL]'),
    subject: `${code(channel.name || channel.id)} foi excluido.`,
    actor: entry,
    sections: [channelDetails(channel)],
  });
}

async function handleChannelUpdate(oldChannel, newChannel) {
  if (!newChannel?.guild) return;
  const entry = await fetchAuditEntry(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);
  const permissionDiff = overwriteSummary(oldChannel, newChannel);

  await sendAuditLog(newChannel.guild, {
    title: 'Canal Atualizado',
    icon: icon('refresh', '[CANAL]'),
    subject: `${channelLabel(newChannel)} foi alterado.`,
    actor: entry,
    sections: [
      compactDiff([
        diffLine('Nome', oldChannel.name, newChannel.name),
        diffLine('Tipo', channelTypeName(oldChannel.type), channelTypeName(newChannel.type)),
        diffLine('Categoria', oldChannel.parent?.name, newChannel.parent?.name),
        diffLine('Topico', oldChannel.topic, newChannel.topic),
        diffLine('NSFW', bool(oldChannel.nsfw), bool(newChannel.nsfw)),
        diffLine('Slowmode', oldChannel.rateLimitPerUser, newChannel.rateLimitPerUser),
        diffLine('Bitrate', oldChannel.bitrate, newChannel.bitrate),
        diffLine('Limite de usuarios', oldChannel.userLimit, newChannel.userLimit),
      ]),
      permissionDiff ? `**Permissoes do canal**\n${permissionDiff}` : null,
    ].filter(Boolean),
  });
}

async function handleRoleCreate(role) {
  const entry = await fetchAuditEntry(role.guild, AuditLogEvent.RoleCreate, role.id);
  await sendAuditLog(role.guild, {
    title: 'Cargo Criado',
    icon: icon('clipboard', '[CARGO]'),
    subject: `${roleLabel(role, role.guild)} foi criado.`,
    actor: entry,
    sections: [
      `Cargo: ${roleLabel(role, role.guild)}\nID: ${code(role.id)}\nCor: ${code(role.hexColor)}\nPermissoes: ${permissionsText(role.permissions)}`,
    ],
  });
}

async function handleRoleDelete(role) {
  const entry = await fetchAuditEntry(role.guild, AuditLogEvent.RoleDelete, role.id);
  await sendAuditLog(role.guild, {
    title: 'Cargo Excluido',
    icon: icon('stop', '[CARGO]'),
    subject: `${code(role.name)} foi excluido.`,
    actor: entry,
    sections: [
      `Cargo: ${code(role.name)}\nID: ${code(role.id)}\nCor: ${code(role.hexColor)}\nPermissoes: ${permissionsText(role.permissions)}`,
    ],
  });
}

async function handleRoleUpdate(oldRole, newRole) {
  const entry = await fetchAuditEntry(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
  await sendAuditLog(newRole.guild, {
    title: 'Cargo Atualizado',
    icon: icon('refresh', '[CARGO]'),
    subject: `${roleLabel(newRole, newRole.guild)} foi alterado.`,
    actor: entry,
    sections: [
      compactDiff([
        diffLine('Nome', oldRole.name, newRole.name),
        diffLine('Cor', oldRole.hexColor, newRole.hexColor),
        diffLine('Posicao', oldRole.position, newRole.position),
        diffLine('Separado na lista', bool(oldRole.hoist), bool(newRole.hoist)),
        diffLine('Mencionavel', bool(oldRole.mentionable), bool(newRole.mentionable)),
        diffLine('Permissoes', permissionsText(oldRole.permissions, 50), permissionsText(newRole.permissions, 50)),
      ]),
    ],
  });
}

async function handleGuildMemberUpdate(oldMember, newMember) {
  const addedRoles = newMember.roles.cache.filter((role) => !oldMember.roles.cache.has(role.id));
  const removedRoles = oldMember.roles.cache.filter((role) => !newMember.roles.cache.has(role.id));
  const roleChanged = addedRoles.size || removedRoles.size;
  const changes = compactDiff([
    diffLine('Apelido', oldMember.nickname, newMember.nickname),
    diffLine('Timeout ate', oldMember.communicationDisabledUntil?.toISOString(), newMember.communicationDisabledUntil?.toISOString()),
    diffLine('Boost desde', oldMember.premiumSince?.toISOString(), newMember.premiumSince?.toISOString()),
    diffLine('Screening pendente', bool(oldMember.pending), bool(newMember.pending)),
  ]);

  if (!roleChanged && changes === 'Sem diferenca detalhada visivel.') return;

  const entry = await fetchAuditEntry(
    newMember.guild,
    roleChanged ? AuditLogEvent.MemberRoleUpdate : AuditLogEvent.MemberUpdate,
    newMember.id
  );
  const roleLines = [
    addedRoles.size ? `**Cargos adicionados:** ${addedRoles.map((role) => roleLabel(role, newMember.guild)).join(', ')}` : null,
    removedRoles.size ? `**Cargos removidos:** ${removedRoles.map((role) => roleLabel(role, newMember.guild)).join(', ')}` : null,
  ].filter(Boolean).join('\n');

  await sendAuditLog(newMember.guild, {
    title: 'Membro Atualizado',
    icon: icon('user', '[MEMBRO]'),
    subject: `${userLabel(newMember.user)} foi alterado.`,
    actor: entry,
    thumbnailUrl: newMember.user?.displayAvatarURL?.({ extension: 'png', size: 256, forceStatic: false }),
    sections: [
      roleLines || null,
      changes !== 'Sem diferenca detalhada visivel.' ? changes : null,
    ].filter(Boolean),
  });
}

async function handleGuildBanAdd(ban) {
  const entry = await fetchAuditEntry(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
  await sendAuditLog(ban.guild, {
    title: 'Membro Banido',
    icon: icon('stop', '[BAN]'),
    subject: `${userLabel(ban.user)} foi banido.`,
    actor: entry,
    thumbnailUrl: ban.user?.displayAvatarURL?.({ extension: 'png', size: 256, forceStatic: false }),
    sections: [`Motivo: ${entry?.reason || ban.reason || 'Nao informado'}`],
  });
}

async function handleGuildBanRemove(ban) {
  const entry = await fetchAuditEntry(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);
  await sendAuditLog(ban.guild, {
    title: 'Banimento Removido',
    icon: icon('check', '[UNBAN]'),
    subject: `${userLabel(ban.user)} teve o ban removido.`,
    actor: entry,
    thumbnailUrl: ban.user?.displayAvatarURL?.({ extension: 'png', size: 256, forceStatic: false }),
    sections: [`Motivo: ${entry?.reason || 'Nao informado'}`],
  });
}

async function handleInviteCreate(invite) {
  const entry = await fetchAuditEntry(invite.guild, AuditLogEvent.InviteCreate, invite.code);
  await sendAuditLog(invite.guild, {
    title: 'Convite Criado',
    icon: icon('clipboard', '[INVITE]'),
    subject: `Convite ${code(invite.code)} criado.`,
    actor: entry,
    sections: [
      `Codigo: ${code(invite.code)}\nCanal: ${channelLabel(invite.channel)}\nCriador: ${userLabel(invite.inviter)}\nUsos maximos: ${code(invite.maxUses || 'ilimitado')}\nExpira em: ${invite.expiresAt ? ts(invite.expiresAt, 'f') : 'Nunca'}`,
    ],
  });
}

async function handleInviteDelete(invite) {
  const entry = await fetchAuditEntry(invite.guild, AuditLogEvent.InviteDelete, invite.code);
  await sendAuditLog(invite.guild, {
    title: 'Convite Excluido',
    icon: icon('stop', '[INVITE]'),
    subject: `Convite ${code(invite.code)} excluido.`,
    actor: entry,
    sections: [`Codigo: ${code(invite.code)}\nCanal: ${channelLabel(invite.channel)}\nUsos: ${code(invite.uses || 0)}`],
  });
}

async function handleWebhookUpdate(channel) {
  const entry = await fetchAuditEntry(channel.guild, AuditLogEvent.WebhookUpdate, channel.id);
  await sendAuditLog(channel.guild, {
    title: 'Webhook Atualizado',
    icon: icon('refresh', '[WEBHOOK]'),
    subject: `Webhooks alterados em ${channelLabel(channel)}.`,
    actor: entry,
    sections: [`Canal: ${channelLabel(channel)}`],
  });
}

async function handleEmojiCreate(emoji) {
  const entry = await fetchAuditEntry(emoji.guild, AuditLogEvent.EmojiCreate, emoji.id);
  await sendAuditLog(emoji.guild, {
    title: 'Emoji Criado',
    icon: icon('clipboard', '[EMOJI]'),
    subject: `${emoji} ${code(emoji.name)} criado.`,
    actor: entry,
    sections: [`Emoji: ${emoji}\nNome: ${code(emoji.name)}\nID: ${code(emoji.id)}`],
  });
}

async function handleEmojiDelete(emoji) {
  const entry = await fetchAuditEntry(emoji.guild, AuditLogEvent.EmojiDelete, emoji.id);
  await sendAuditLog(emoji.guild, {
    title: 'Emoji Excluido',
    icon: icon('stop', '[EMOJI]'),
    subject: `${code(emoji.name)} excluido.`,
    actor: entry,
    sections: [`Nome: ${code(emoji.name)}\nID: ${code(emoji.id)}`],
  });
}

async function handleEmojiUpdate(oldEmoji, newEmoji) {
  const entry = await fetchAuditEntry(newEmoji.guild, AuditLogEvent.EmojiUpdate, newEmoji.id);
  await sendAuditLog(newEmoji.guild, {
    title: 'Emoji Atualizado',
    icon: icon('refresh', '[EMOJI]'),
    subject: `${newEmoji} ${code(newEmoji.name)} alterado.`,
    actor: entry,
    sections: [compactDiff([diffLine('Nome', oldEmoji.name, newEmoji.name)])],
  });
}

async function handleStickerCreate(sticker) {
  const entry = await fetchAuditEntry(sticker.guild, AuditLogEvent.StickerCreate, sticker.id);
  await sendAuditLog(sticker.guild, {
    title: 'Sticker Criado',
    icon: icon('clipboard', '[STICKER]'),
    subject: `${code(sticker.name)} criado.`,
    actor: entry,
    sections: [`Nome: ${code(sticker.name)}\nID: ${code(sticker.id)}\nDescricao: ${sticker.description || 'N/A'}`],
  });
}

async function handleStickerDelete(sticker) {
  const entry = await fetchAuditEntry(sticker.guild, AuditLogEvent.StickerDelete, sticker.id);
  await sendAuditLog(sticker.guild, {
    title: 'Sticker Excluido',
    icon: icon('stop', '[STICKER]'),
    subject: `${code(sticker.name)} excluido.`,
    actor: entry,
    sections: [`Nome: ${code(sticker.name)}\nID: ${code(sticker.id)}`],
  });
}

async function handleStickerUpdate(oldSticker, newSticker) {
  const entry = await fetchAuditEntry(newSticker.guild, AuditLogEvent.StickerUpdate, newSticker.id);
  await sendAuditLog(newSticker.guild, {
    title: 'Sticker Atualizado',
    icon: icon('refresh', '[STICKER]'),
    subject: `${code(newSticker.name)} alterado.`,
    actor: entry,
    sections: [compactDiff([
      diffLine('Nome', oldSticker.name, newSticker.name),
      diffLine('Descricao', oldSticker.description, newSticker.description),
      diffLine('Tags', oldSticker.tags, newSticker.tags),
    ])],
  });
}

async function handleThreadCreate(thread) {
  const entry = await fetchAuditEntry(thread.guild, AuditLogEvent.ThreadCreate, thread.id);
  await sendAuditLog(thread.guild, {
    title: 'Thread Criada',
    icon: icon('clipboard', '[THREAD]'),
    subject: `${channelLabel(thread)} criada.`,
    actor: entry,
    sections: [channelDetails(thread)],
  });
}

async function handleThreadDelete(thread) {
  const entry = await fetchAuditEntry(thread.guild, AuditLogEvent.ThreadDelete, thread.id);
  await sendAuditLog(thread.guild, {
    title: 'Thread Excluida',
    icon: icon('stop', '[THREAD]'),
    subject: `${code(thread.name || thread.id)} excluida.`,
    actor: entry,
    sections: [channelDetails(thread)],
  });
}

async function handleThreadUpdate(oldThread, newThread) {
  const entry = await fetchAuditEntry(newThread.guild, AuditLogEvent.ThreadUpdate, newThread.id);
  await sendAuditLog(newThread.guild, {
    title: 'Thread Atualizada',
    icon: icon('refresh', '[THREAD]'),
    subject: `${channelLabel(newThread)} alterada.`,
    actor: entry,
    sections: [compactDiff([
      diffLine('Nome', oldThread.name, newThread.name),
      diffLine('Arquivada', bool(oldThread.archived), bool(newThread.archived)),
      diffLine('Bloqueada', bool(oldThread.locked), bool(newThread.locked)),
      diffLine('Auto archive', oldThread.autoArchiveDuration, newThread.autoArchiveDuration),
    ])],
  });
}

async function handleGuildUpdate(oldGuild, newGuild) {
  const entry = await fetchAuditEntry(newGuild, AuditLogEvent.GuildUpdate, newGuild.id);
  await sendAuditLog(newGuild, {
    title: 'Servidor Atualizado',
    icon: icon('refresh', '[SERVER]'),
    subject: `${code(newGuild.name)} teve configuracao alterada.`,
    actor: entry,
    sections: [compactDiff([
      diffLine('Nome', oldGuild.name, newGuild.name),
      diffLine('AFK timeout', oldGuild.afkTimeout, newGuild.afkTimeout),
      diffLine('Nivel de verificacao', oldGuild.verificationLevel, newGuild.verificationLevel),
      diffLine('Idioma preferido', oldGuild.preferredLocale, newGuild.preferredLocale),
      diffLine('Canal de regras', oldGuild.rulesChannelId, newGuild.rulesChannelId),
      diffLine('Canal de updates', oldGuild.publicUpdatesChannelId, newGuild.publicUpdatesChannelId),
    ])],
  });
}

async function handleVoiceStateUpdate(oldState, newState) {
  const guild = newState.guild || oldState.guild;
  const member = newState.member || oldState.member;
  if (!guild || !member || isOwnBotUser(member.user, guild.client)) return;

  const oldChannel = oldState.channel;
  const newChannel = newState.channel;
  const changes = [];

  if (!oldChannel && newChannel) changes.push(`Entrou em ${channelLabel(newChannel)}`);
  if (oldChannel && !newChannel) changes.push(`Saiu de ${channelLabel(oldChannel)}`);
  if (oldChannel && newChannel && oldChannel.id !== newChannel.id) changes.push(`Moveu de ${channelLabel(oldChannel)} para ${channelLabel(newChannel)}`);
  const stateDiff = compactDiff([
    diffLine('Mute servidor', bool(oldState.serverMute), bool(newState.serverMute)),
    diffLine('Deaf servidor', bool(oldState.serverDeaf), bool(newState.serverDeaf)),
    diffLine('Mute proprio', bool(oldState.selfMute), bool(newState.selfMute)),
    diffLine('Deaf proprio', bool(oldState.selfDeaf), bool(newState.selfDeaf)),
    diffLine('Camera', bool(oldState.selfVideo), bool(newState.selfVideo)),
    diffLine('Transmitindo', bool(oldState.streaming), bool(newState.streaming)),
  ]);

  if (!changes.length && stateDiff === 'Sem diferenca detalhada visivel.') return;

  const entry = await fetchAuditEntry(guild, AuditLogEvent.MemberMove, member.id);
  await sendAuditLog(guild, {
    title: 'Voz Atualizada',
    icon: icon('refresh', '[VOZ]'),
    subject: `${userLabel(member.user)} teve estado de voz alterado.`,
    actor: entry,
    thumbnailUrl: member.user?.displayAvatarURL?.({ extension: 'png', size: 256, forceStatic: false }),
    sections: [
      changes.join('\n') || null,
      stateDiff !== 'Sem diferenca detalhada visivel.' ? stateDiff : null,
    ].filter(Boolean),
  });
}

async function handleGuildAuditLogEntryCreate(entry, guild) {
  if (!entry || !guild || HANDLED_AUDIT_TYPES.has(entry.action)) return;

  const target = entry.target
    ? (entry.target.id ? `${code(entry.target.id)} ${entry.target.name ? code(entry.target.name) : ''}` : code(String(entry.target)))
    : 'N/A';
  const changes = entry.changes?.length
    ? entry.changes.slice(0, 8).map((change) =>
      diffLine(change.key, stringifyValue(change.old), stringifyValue(change.new))
    ).filter(Boolean).join('\n')
    : 'Sem mudancas detalhadas no audit log.';

  await sendAuditLog(guild, {
    title: 'Registro de Auditoria',
    icon: icon('clipboard', '[AUDIT]'),
    subject: `${auditTypeName(entry.action)} registrado no audit log.`,
    actor: entry,
    sections: [
      [
        `Tipo: ${code(auditTypeName(entry.action))}`,
        `Alvo: ${target}`,
        `Motivo: ${entry.reason || 'Nao informado'}`,
      ].join('\n'),
      changes || 'Sem mudancas detalhadas no audit log.',
    ],
  });
}

module.exports = {
  handleMessageUpdate,
  handleMessageDelete,
  handleMessageDeleteBulk,
  handleChannelCreate,
  handleChannelDelete,
  handleChannelUpdate,
  handleRoleCreate,
  handleRoleDelete,
  handleRoleUpdate,
  handleGuildMemberUpdate,
  handleGuildBanAdd,
  handleGuildBanRemove,
  handleInviteCreate,
  handleInviteDelete,
  handleWebhookUpdate,
  handleEmojiCreate,
  handleEmojiDelete,
  handleEmojiUpdate,
  handleStickerCreate,
  handleStickerDelete,
  handleStickerUpdate,
  handleThreadCreate,
  handleThreadDelete,
  handleThreadUpdate,
  handleGuildUpdate,
  handleVoiceStateUpdate,
  handleGuildAuditLogEntryCreate,
};
