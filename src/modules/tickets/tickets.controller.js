const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const discordTranscripts = require('discord-html-transcripts');
const ticketsService = require('./tickets.service');
const { canManageTickets, canOpenRegistrationUpdate } = require('../../services/permissionService');
const configService = require('../../services/configService');
const resolver = require('../../utils/resolver');
const logger = require('../../utils/logger');
const { createSuccessEmbed } = require('../../utils/createEmbed');
const componentFactory = require('../../utils/componentFactory');
const emojiHelper = require('../../utils/emojiHelper');
const { EPHEMERAL_REPLY } = require('../../utils/interactionOptions');
const ticketAiService = require('../../services/ticketAiService');
const disciplinaryService = require('../../services/disciplinaryService');

function getTicketOwnerId(channel, ticket = null) {
  if (ticket?.userId) return ticket.userId;

  const match = channel.topic?.match(/Ticket ID:\s*(\d+)/i);
  return match ? match[1] : null;
}

function getTicketDepartmentName(channel, ticket = null) {
  if (ticket?.reason) return ticket.reason;

  const match = channel.topic?.match(/Departamento:\s*(.+)$/i);
  return match ? match[1] : 'Suporte Geral';
}

const closingTickets = new Set();
const CORR_RANK_SELECT_ID = 'corr_rank_select';
const CORR_OFFICER_SELECT_PREFIX = 'corr_officer_select:';
const CORR_CASE_MODAL_PREFIX = 'corr_case_modal:';
const CORR_MANUAL_MODAL_ID = 'corr_case_manual_modal';
const CORR_APPLY_MODAL_PREFIX = 'corr_apply_modal:';
const REGISTRO_SELECT_PREFIX = 'registro_update_select:';
const REGISTRO_NAME_MODAL_PREFIX = 'registro_update_name_modal:';
const REGISTRO_PATENTE_MODAL_PREFIX = 'registro_update_patente_modal:';
const REGISTRO_BADGE_MODAL_PREFIX = 'registro_update_badge_modal:';
const REGISTRO_OUTRO_MODAL_PREFIX = 'registro_update_outro_modal:';

function limitLabel(text, max = 90) {
  const value = String(text || '').trim();
  if (value.length <= max) return value || 'N/A';
  return `${value.slice(0, max - 3)}...`;
}

function normalizeText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isComplaintTicket(channel, ticket = null) {
  const department = getTicketDepartmentName(channel, ticket);
  const normalized = normalizeText(department);
  const compact = normalized.replace(/[^a-z0-9]/g, '');
  return (
    normalized.includes('denuncia') ||
    compact.includes('denuncia') ||
    compact.includes('denancia') ||
    normalized.includes('corregedoria') ||
    compact.includes('corregedoria') ||
    normalized.includes('assuntos internos') ||
    compact.includes('assuntosinternos')
  );
}

function getMemberDisplay(member) {
  return member?.displayName || member?.user?.globalName || member?.user?.username || 'Não informado';
}

function buildManualOfficerButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('corr_manual_officer')
      .setLabel('Informar ID manualmente')
      .setStyle(ButtonStyle.Secondary)
  );
}

function findComponentByCustomId(components, customId) {
  for (const component of components || []) {
    const componentId = component.customId || component.data?.custom_id || component.custom_id;
    if (componentId === customId) {
      return component;
    }

    const children = component.components || component.data?.components || [];
    const found = findComponentByCustomId(children, customId);
    if (found) return found;
  }

  return null;
}

function isTicketHeld(message) {
  const holdButton = findComponentByCustomId(message.components, 'ticket_espera');
  const label = holdButton?.label || holdButton?.data?.label || '';
  return label.includes('Retomar');
}

function buildTicketOpenedPayload(interaction, data) {
  return componentFactory.createTicketOpenedPayload(data);
}

async function getMemberLabel(guild, userId) {
  if (!userId) return null;

  const member = await guild.members.fetch(userId).catch(() => null);
  return member?.displayName || member?.user?.username || null;
}

function parseCustomOwnerId(customId, prefix) {
  return String(customId || '').slice(prefix.length).split(':')[0];
}

const REGISTRO_NICKNAME_PATTERN = /^\[(\d{3})\]\s*-\s*([\p{L}][\p{L}'-]{1,}(?:\s+[\p{L}][\p{L}'-]{1,})+)$/u;

function cleanRegistroNickname(value) {
  return String(value || '')
    .replace(/[`*_~|<>@#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRegistroServiceNickname(value) {
  const clean = cleanRegistroNickname(value);
  const match = clean.match(REGISTRO_NICKNAME_PATTERN);
  if (!match) return null;

  const [, badge, name] = match;
  return {
    badge,
    name: name.trim(),
    nickname: `[${badge}] - ${name.trim()}`,
  };
}

function buildRegistroServiceNickname(badge, name) {
  const cleanBadge = String(badge || '').replace(/\D/g, '');
  const cleanName = cleanRegistroNickname(name);
  if (!/^\d{3}$/.test(cleanBadge)) return null;
  if (cleanName.split(/\s+/).filter(Boolean).length < 2) return null;

  const nickname = `[${cleanBadge}] - ${cleanName}`;
  return {
    badge: cleanBadge,
    name: cleanName,
    nickname,
  };
}

async function getRegistrationResponsibleMentions(guild) {
  const configuredRoleIds = [
    await configService.getRole(guild.id, 'ticketStaff'),
    await configService.getRole(guild.id, 'comandoAdmin'),
  ].filter(Boolean).map(String);

  const roleIds = [];
  for (const roleId of [...new Set(configuredRoleIds)]) {
    const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
    if (role) roleIds.push(role.id);
  }

  return {
    mention: roleIds.length ? roleIds.map((roleId) => `<@&${roleId}>`).join(' ') : '**Responsaveis pelo registro**',
    roleIds,
  };
}

async function sendRegistrationResponsibleRequest(interaction, { ownerId, typeLabel, details }) {
  const target = await getRegistrationResponsibleMentions(interaction.guild);

  if (target.mention) {
    await interaction.channel.send({
      content: target.mention,
      allowedMentions: { roles: target.roleIds, users: ownerId ? [ownerId] : [] },
    }).catch(() => null);
  }

  await interaction.channel.send(componentFactory.createRegistrationResponsibleRequestPayload({
    mention: '',
    ownerId,
    typeLabel,
    details,
    roleIds: target.roleIds,
  }));
}

async function openTicketForDepartment(interaction, departmentKey) {
  await interaction.deferReply(EPHEMERAL_REPLY);

  const departmentName = ticketsService.nomesDepartamentos[departmentKey] || 'Suporte Geral';
  const guild = interaction.guild;

  if (departmentKey === 'perfil' && !await canOpenRegistrationUpdate(interaction.member)) {
    return interaction.editReply({
      content: `${emojiHelper.get('stop')} A atualizacao de registro e exclusiva para policiais com a tag configurada.`,
    });
  }

  const cleanUsername = interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
  const existingChannel = guild.channels.cache.find(
    c => c.name.endsWith(`ticket-${cleanUsername}`)
  );

  if (existingChannel) {
    return interaction.editReply({
      content: `${emojiHelper.get('stop')} Você já possui um atendimento ativo em andamento: ${existingChannel}`,
    });
  }

  try {
    const { channel, ticket, staffRole } = await ticketsService.createTicketChannel(guild, interaction.user, departmentKey, null, interaction._corpSlug);
    const staffMention = staffRole ? `<@&${staffRole.id}>` : '';

    await channel.send(buildTicketOpenedPayload(interaction, {
      userId: interaction.user.id,
      staffMention,
      staffRoleId: staffRole?.id,
      departmentName,
      departmentKey,
      corporationSlug: interaction._corpSlug || 'pmesp',
    }));

    if (departmentKey === 'perfil') {
      await channel.send(componentFactory.createRegistrationUpdateGuidePayload({
        userId: interaction.user.id,
        staffRoleId: staffRole?.id,
      }));
    }

    ticketAiService.sendOpeningPrompt(channel, ticket).catch((error) => {
      logger.warn(`IA nao conseguiu iniciar o ticket ${channel.id}: ${error.message}`);
    });

    await interaction.editReply({
      content: `${emojiHelper.get('check')} O seu ticket foi aberto com sucesso no departamento de **${departmentName}**!\nAcesse aqui: ${channel}`,
    });
  } catch (error) {
    logger.error('Erro ao abrir canal de ticket:', error);
    await interaction.editReply({
      content: `${emojiHelper.get('stop')} Ocorreu um erro ao tentar criar o seu canal de atendimento.`,
    });
  }
}

/**
 * Handle: selecionar_tipo_ticket (StringSelectMenu)
 * Abre o ticket baseado no departamento selecionado.
 */
async function handleSelectType(interaction, corpSlug) {
  interaction._corpSlug = corpSlug || 'pmesp';
  return openTicketForDepartment(interaction, interaction.values[0]);
}

/**
 * Handle: ticket_assumir (Button)
 * Assume o ticket por um oficial.
 */
async function handleClaim(interaction) {
  if (!await canManageTickets(interaction.member)) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Apenas oficiais autorizados podem assumir tickets.`,
      ...EPHEMERAL_REPLY,
    });
  }

  const ticket = await ticketsService.claimTicket(interaction.channel.id, interaction.user.id);
  const ownerId = getTicketOwnerId(interaction.channel, ticket);

  if (!ownerId) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Não foi possível determinar o dono deste ticket.`,
      ...EPHEMERAL_REPLY,
    });
  }

  await interaction.update({
    ...buildTicketOpenedPayload(interaction, {
      userId: ownerId,
      departmentName: getTicketDepartmentName(interaction.channel, ticket),
      claimedBy: interaction.user.id,
      claimedByLabel: interaction.user.username,
      held: isTicketHeld(interaction.message),
      corporationSlug: ticket?.corporationSlug || 'pmesp',
    }),
    content: null,
    embeds: [],
  });
}

/**
 * Handle: ticket_espera (Button)
 * Coloca o atendimento em espera congelando o chat para o cidadão.
 */
async function handleHold(interaction) {
  if (!await canManageTickets(interaction.member)) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Apenas oficiais autorizados podem colocar o ticket em espera.`,
      ...EPHEMERAL_REPLY,
    });
  }

  const ticket = await ticketsService.getTicketByChannel(interaction.channel.id);
  const ownerId = getTicketOwnerId(interaction.channel, ticket);

  if (!ownerId) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Não foi possível determinar o dono deste ticket.`,
      ...EPHEMERAL_REPLY,
    });
  }

  const nextHeld = !isTicketHeld(interaction.message);

  if (!nextHeld) {
    await interaction.channel.permissionOverwrites.edit(ownerId, { SendMessages: true });
  } else {
    await interaction.channel.permissionOverwrites.edit(ownerId, { SendMessages: false });
  }

  await interaction.update({
    ...buildTicketOpenedPayload(interaction, {
      userId: ownerId,
      departmentName: getTicketDepartmentName(interaction.channel, ticket),
      claimedBy: ticket?.claimedBy,
      claimedByLabel: await getMemberLabel(interaction.guild, ticket?.claimedBy),
      held: nextHeld,
      corporationSlug: ticket?.corporationSlug || 'pmesp',
    }),
    content: null,
    embeds: [],
  });

  await interaction.followUp({
    content: nextHeld
      ? `${emojiHelper.get('clock')} Canal colocado em espera. O cidadão não pode enviar mensagens até a retomada.`
      : `${emojiHelper.get('check')} Canal reativado. O cidadão pode voltar a enviar mensagens.`,
    ...EPHEMERAL_REPLY,
  });
}

/**
 * Handle: ticket_add_member (Button)
 * Abre o modal para adicionar uma testemunha/membro no canal.
 */
async function handleAddMemberButton(interaction) {
  if (!await canManageTickets(interaction.member)) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Apenas oficiais autorizados podem adicionar membros ao ticket.`,
      ...EPHEMERAL_REPLY,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId('modal_add_membro')
    .setTitle('Adicionar ao Processo');

  const idInput = new TextInputBuilder()
    .setCustomId('id_usuario')
    .setLabel('ID do Discord do Utilizador:')
    .setPlaceholder('Ex: 123456789012345678')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(idInput));
  await interaction.showModal(modal);
}

/**
 * Handle: modal_add_membro (ModalSubmit)
 * Executa a adição do membro no canal.
 */
async function handleAddMemberModal(interaction) {
  const userId = interaction.fields.getTextInputValue('id_usuario');

  try {
    await interaction.guild.members.fetch(userId);
    await interaction.channel.permissionOverwrites.edit(userId, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
    });
    await interaction.reply({
      embeds: [
        createSuccessEmbed('Membro Adicionado', `O cidadão/oficial <@${userId}> foi convocado para este atendimento com permissões de visualização e escrita.`)
      ]
    });
  } catch (error) {
    await interaction.reply({
      content: `${emojiHelper.get('stop')} Não foi possível encontrar um utilizador com o ID \`${userId}\` no servidor.`,
      ...EPHEMERAL_REPLY,
    });
  }
}

/**
 * Handle: ticket_ping_ (Button)
 * Menciona/Notifica o dono do ticket.
 */
async function handlePing(interaction) {
  const { canManageTickets } = require('../../services/permissionService');
  if (!await canManageTickets(interaction.member)) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} **Acesso Negado:** Apenas oficiais e staff podem notificar o usuário.`,
      ...EPHEMERAL_REPLY,
    });
  }

  const ownerId = interaction.customId.split('_')[2];
  await interaction.reply({
    content: `🔔 <@${ownerId}>, atenção no canal. Um oficial aguarda a sua resposta.`,
  });
}

async function handleRegistrationUpdateSelect(interaction) {
  const ownerId = parseCustomOwnerId(interaction.customId, REGISTRO_SELECT_PREFIX);
  if (interaction.user.id !== ownerId) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Apenas o dono deste ticket pode escolher o que sera atualizado.`,
      ...EPHEMERAL_REPLY,
    });
  }

  const option = interaction.values?.[0];
  const modal = new ModalBuilder();

  if (option === 'nome') {
    modal
      .setCustomId(`${REGISTRO_NAME_MODAL_PREFIX}${ownerId}`)
      .setTitle('Atualizar nome');

    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('nome_sobrenome')
        .setLabel('Novo apelido de servico')
        .setPlaceholder('Ex: [524] - John Smith')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(32)
    ));

    return interaction.showModal(modal);
  }

  if (option === 'patente') {
    modal
      .setCustomId(`${REGISTRO_PATENTE_MODAL_PREFIX}${ownerId}`)
      .setTitle('Atualizar patente');

    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('patente_solicitada')
        .setLabel('Qual patente deseja atualizar?')
        .setPlaceholder('Informe a patente atual e a desejada.')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(500)
    ));

    return interaction.showModal(modal);
  }

  if (option === 'badge') {
    modal
      .setCustomId(`${REGISTRO_BADGE_MODAL_PREFIX}${ownerId}`)
      .setTitle('Atualizar badge');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('badge_numero')
          .setLabel('Badge')
          .setPlaceholder('Ex: 610')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(3)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('nome_sobrenome')
          .setLabel('Nome e sobrenome')
          .setPlaceholder('Ex: John Smith')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(50)
      )
    );

    return interaction.showModal(modal);
  }

  modal
    .setCustomId(`${REGISTRO_OUTRO_MODAL_PREFIX}${ownerId}`)
    .setTitle('Outro ajuste');

  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId('detalhes')
      .setLabel('O que deseja atualizar?')
      .setPlaceholder('Descreva o ajuste necessario no seu registro.')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(700)
  ));

  return interaction.showModal(modal);
}

async function handleRegistrationNameModal(interaction) {
  await interaction.deferReply(EPHEMERAL_REPLY);

  const ownerId = parseCustomOwnerId(interaction.customId, REGISTRO_NAME_MODAL_PREFIX);
  if (interaction.user.id !== ownerId) {
    return interaction.editReply(`${emojiHelper.get('stop')} Apenas o dono deste ticket pode atualizar esse nome.`);
  }

  const parsedNickname = parseRegistroServiceNickname(interaction.fields.getTextInputValue('nome_sobrenome'));
  if (!parsedNickname) {
    return interaction.editReply(`${emojiHelper.get('stop')} Use o padrao \`[123] - Nome Sobrenome\`, com a badge contendo exatamente 3 numeros.`);
  }

  if (parsedNickname.nickname.length > 32) {
    return interaction.editReply(`${emojiHelper.get('stop')} O apelido completo deve ter no maximo 32 caracteres.`);
  }

  const member = await interaction.guild.members.fetch(ownerId).catch(() => null);
  if (!member) {
    return interaction.editReply(`${emojiHelper.get('stop')} Nao consegui encontrar seu usuario no servidor.`);
  }

  const nextNickname = parsedNickname.nickname;

  try {
    await member.setNickname(nextNickname, `Atualizacao de registro solicitada no ticket ${interaction.channel?.id || 'desconhecido'}`);

    await interaction.channel.send({
      content: `${emojiHelper.get('check')} Registro de nome atualizado para <@${ownerId}>: \`${nextNickname}\`.`,
      allowedMentions: { users: [ownerId], roles: [], repliedUser: false },
    });

    return interaction.editReply(`${emojiHelper.get('check')} Nome atualizado com sucesso para \`${nextNickname}\`.`);
  } catch (error) {
    logger.warn(`Nao foi possivel atualizar apelido de ${ownerId}: ${error.message}`);
    await sendRegistrationResponsibleRequest(interaction, {
      ownerId,
      typeLabel: 'Nome e sobrenome',
      details: `Novo apelido solicitado: ${nextNickname}. O bot nao conseguiu alterar automaticamente: ${error.message}`,
    }).catch(() => null);
    return interaction.editReply(`${emojiHelper.get('stop')} Nao consegui alterar automaticamente. Acionei um responsavel no ticket.`);
  }
}

async function handleRegistrationPatenteModal(interaction) {
  await interaction.deferReply(EPHEMERAL_REPLY);

  const ownerId = parseCustomOwnerId(interaction.customId, REGISTRO_PATENTE_MODAL_PREFIX);
  if (interaction.user.id !== ownerId) {
    return interaction.editReply(`${emojiHelper.get('stop')} Apenas o dono deste ticket pode enviar esta solicitacao.`);
  }

  const details = interaction.fields.getTextInputValue('patente_solicitada').trim();
  await sendRegistrationResponsibleRequest(interaction, {
    ownerId,
    typeLabel: 'Patente',
    details,
  });

  return interaction.editReply(`${emojiHelper.get('check')} Pedido de patente registrado. Um responsavel foi chamado no ticket.`);
}

async function handleRegistrationBadgeModal(interaction) {
  await interaction.deferReply(EPHEMERAL_REPLY);

  const ownerId = parseCustomOwnerId(interaction.customId, REGISTRO_BADGE_MODAL_PREFIX);
  if (interaction.user.id !== ownerId) {
    return interaction.editReply(`${emojiHelper.get('stop')} Apenas o dono deste ticket pode enviar esta solicitacao.`);
  }

  const parsedNickname = buildRegistroServiceNickname(
    interaction.fields.getTextInputValue('badge_numero'),
    interaction.fields.getTextInputValue('nome_sobrenome')
  );

  if (!parsedNickname) {
    return interaction.editReply(`${emojiHelper.get('stop')} Informe apenas 3 numeros para a badge. Exemplo: \`610\`.`);
  }

  if (parsedNickname.nickname.length > 32) {
    return interaction.editReply(`${emojiHelper.get('stop')} O apelido completo deve ter no maximo 32 caracteres.`);
  }

  const member = await interaction.guild.members.fetch(ownerId).catch(() => null);
  if (!member) {
    return interaction.editReply(`${emojiHelper.get('stop')} Nao consegui encontrar seu usuario no servidor.`);
  }

  const nextNickname = parsedNickname.nickname;

  try {
    await member.setNickname(nextNickname, `Atualizacao de badge solicitada no ticket ${interaction.channel?.id || 'desconhecido'}`);

    await interaction.channel.send({
      content: `${emojiHelper.get('check')} Registro de badge atualizado para <@${ownerId}>: \`${nextNickname}\`.`,
      allowedMentions: { users: [ownerId], roles: [], repliedUser: false },
    });

    return interaction.editReply(`${emojiHelper.get('check')} Badge atualizada com sucesso para \`${nextNickname}\`.`);
  } catch (error) {
    logger.warn(`Nao foi possivel atualizar badge/apelido de ${ownerId}: ${error.message}`);
    await sendRegistrationResponsibleRequest(interaction, {
      ownerId,
      typeLabel: 'Badge',
      details: `Novo apelido solicitado: ${nextNickname}. O bot nao conseguiu alterar automaticamente: ${error.message}`,
    }).catch(() => null);
    return interaction.editReply(`${emojiHelper.get('stop')} Nao consegui alterar automaticamente. Acionei um responsavel no ticket.`);
  }
}

async function handleRegistrationOutroModal(interaction) {
  await interaction.deferReply(EPHEMERAL_REPLY);

  const ownerId = parseCustomOwnerId(interaction.customId, REGISTRO_OUTRO_MODAL_PREFIX);
  if (interaction.user.id !== ownerId) {
    return interaction.editReply(`${emojiHelper.get('stop')} Apenas o dono deste ticket pode enviar esta solicitacao.`);
  }

  const details = interaction.fields.getTextInputValue('detalhes').trim();
  await sendRegistrationResponsibleRequest(interaction, {
    ownerId,
    typeLabel: 'Outro ajuste',
    details,
  });

  return interaction.editReply(`${emojiHelper.get('check')} Pedido registrado. Um responsavel foi chamado no ticket.`);
}

/**
 * Handle: ticket_call (Button)
 * Cria uma sala de rádio (voz) temporária vinculada ao ticket.
 */
async function handleRadioCall(interaction) {
  if (!await canManageTickets(interaction.member)) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Apenas oficiais criam frequências de rádio.`,
      ...EPHEMERAL_REPLY,
    });
  }

  await interaction.deferReply();

  const guild = interaction.guild;
  const ticketName = interaction.channel.name.replace(/.*ticket-/, '');
  const nameVoiceChannel = `📞・ rádio-${ticketName}`;
  const legacyVoiceChannel = `📞 rádio-${ticketName}`;

  const callExistente = guild.channels.cache.find(
    c => [nameVoiceChannel, legacyVoiceChannel].includes(c.name) && c.type === ChannelType.GuildVoice
  );

  if (callExistente) {
    return interaction.editReply({
      ...componentFactory.createTicketRadioPayload({ channel: callExistente, alreadyOpen: true }),
      content: null,
      embeds: [],
    });
  }

  try {
    const parentId = interaction.channel.parentId;
    const parentOverwrites = interaction.channel.permissionOverwrites.cache.map(p => ({
      id: p.id,
      allow: p.allow.toArray(),
      deny: p.deny.toArray(),
    }));

    const canalVoz = await guild.channels.create({
      name: nameVoiceChannel,
      type: ChannelType.GuildVoice,
      parent: parentId || null,
      permissionOverwrites: parentOverwrites,
    });

    await interaction.editReply({
      ...componentFactory.createTicketRadioPayload({ channel: canalVoz }),
      content: null,
      embeds: [],
    });
  } catch (error) {
    logger.error('Erro ao criar canal de rádio:', error);
    await interaction.editReply({
      content: `${emojiHelper.get('stop')} Não foi possível criar a frequência de rádio.`,
    });
  }
}

async function handleCorregedoriaStart(interaction) {
  if (!await canManageTickets(interaction.member)) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Apenas oficiais autorizados podem encaminhar denúncias à corregedoria.`,
      ...EPHEMERAL_REPLY,
    });
  }

  const ticket = await ticketsService.getAnyTicketByChannel(interaction.channel.id);
  if (!isComplaintTicket(interaction.channel, ticket)) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Este fluxo é destinado a tickets de denúncia/corregedoria.`,
      ...EPHEMERAL_REPLY,
    });
  }

  const corporationSlug = ticket?.corporationSlug || 'pmesp';
  const corporationService = require('../../services/corporationService');
  const ranks = await corporationService.getRanks(interaction.guildId, corporationSlug);
  const validRanks = ranks.filter(r => r.roleId && r.roleId.trim() !== '');

  const selectOptions = validRanks.slice(0, 25).map(r => {
    const option = {
      label: r.name,
      value: r.roleId,
    };
    if (r.emoji) {
      option.emoji = r.emoji;
    }
    return option;
  });

  let rankSelectComponent;
  if (selectOptions.length > 0) {
    rankSelectComponent = new StringSelectMenuBuilder()
      .setCustomId(CORR_RANK_SELECT_ID)
      .setPlaceholder('Selecione a patente do oficial...')
      .addOptions(selectOptions);
  } else {
    rankSelectComponent = new RoleSelectMenuBuilder()
      .setCustomId(CORR_RANK_SELECT_ID)
      .setPlaceholder('Selecione a patente/cargo do oficial denunciado')
      .setMinValues(1)
      .setMaxValues(1);
  }

  return interaction.reply({
    content: `${emojiHelper.get('clipboard')} Selecione a patente do oficial denunciado (${corporationSlug.toUpperCase()}). Depois disso eu mostro os membros dessa patente para você escolher.`,
    components: [
      new ActionRowBuilder().addComponents(rankSelectComponent),
      buildManualOfficerButton(),
    ],
    ...EPHEMERAL_REPLY,
  });
}

async function handleCorregedoriaRankSelect(interaction) {
  if (!await canManageTickets(interaction.member)) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Apenas oficiais autorizados podem usar este fluxo.`,
      ...EPHEMERAL_REPLY,
    });
  }

  const roleId = interaction.values?.[0];
  const role = interaction.guild.roles.cache.get(roleId) || await interaction.guild.roles.fetch(roleId).catch(() => null);
  if (!role) {
    return interaction.update({
      content: `${emojiHelper.get('stop')} Não consegui encontrar essa patente/cargo.`,
      components: [buildManualOfficerButton()],
    });
  }

  const members = await interaction.guild.members.fetch().catch(() => null);
  const candidates = [...(members || interaction.guild.members.cache).values()]
    .filter((member) => !member.user.bot && member.roles.cache.has(role.id))
    .sort((a, b) => getMemberDisplay(a).localeCompare(getMemberDisplay(b), 'pt-BR'))
    .slice(0, 25);

  if (!candidates.length) {
    return interaction.update({
      content: `${emojiHelper.get('stop')} Não encontrei membros com a patente/cargo **${role.name}**. Você ainda pode informar o ID manualmente.`,
      components: [buildManualOfficerButton()],
    });
  }

  const officerSelect = new StringSelectMenuBuilder()
    .setCustomId(`${CORR_OFFICER_SELECT_PREFIX}${role.id}`)
    .setPlaceholder('Selecione o oficial denunciado')
    .addOptions(candidates.map((member) => ({
      label: limitLabel(getMemberDisplay(member), 90),
      description: limitLabel(`@${member.user.username} | ${member.id}`, 100),
      value: member.id,
    })));

  return interaction.update({
    content: `${emojiHelper.get('idcard')} Patente selecionada: **${role.name}**. Agora selecione o oficial denunciado.`,
    components: [
      new ActionRowBuilder().addComponents(officerSelect),
      buildManualOfficerButton(),
    ],
  });
}

async function handleCorregedoriaOfficerSelect(interaction) {
  if (!await canManageTickets(interaction.member)) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Apenas oficiais autorizados podem usar este fluxo.`,
      ...EPHEMERAL_REPLY,
    });
  }

  const roleId = interaction.customId.slice(CORR_OFFICER_SELECT_PREFIX.length);
  const accusedUserId = interaction.values?.[0];
  const member = await interaction.guild.members.fetch(accusedUserId).catch(() => null);

  if (!member) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Não consegui encontrar esse oficial no servidor.`,
      ...EPHEMERAL_REPLY,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId(`${CORR_CASE_MODAL_PREFIX}${roleId}:${accusedUserId}`)
    .setTitle('Encaminhar à Corregedoria');

  const rpIdInput = new TextInputBuilder()
    .setCustomId('oficial_rp_id')
    .setLabel('Citizen ID, nome e sobrenome')
    .setPlaceholder('Ex: [524] - John Smith')
    .setValue(getMemberDisplay(member).slice(0, 80))
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(80);

  const summaryInput = new TextInputBuilder()
    .setCustomId('resumo')
    .setLabel('Resumo para avaliação da corregedoria')
    .setPlaceholder('Descreva o motivo administrativo da denúncia.')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(900);

  modal.addComponents(
    new ActionRowBuilder().addComponents(rpIdInput),
    new ActionRowBuilder().addComponents(summaryInput)
  );

  return interaction.showModal(modal);
}

async function handleCorregedoriaManualButton(interaction) {
  if (!await canManageTickets(interaction.member)) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Apenas oficiais autorizados podem usar este fluxo.`,
      ...EPHEMERAL_REPLY,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId(CORR_MANUAL_MODAL_ID)
    .setTitle('Encaminhar à Corregedoria');

  const discordIdInput = new TextInputBuilder()
    .setCustomId('oficial_discord_id')
    .setLabel('ID Discord do oficial')
    .setPlaceholder('Ex: 123456789012345678')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const rankRoleInput = new TextInputBuilder()
    .setCustomId('patente_role_id')
    .setLabel('ID do cargo/patente')
    .setPlaceholder('Opcional')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const rpIdInput = new TextInputBuilder()
    .setCustomId('oficial_rp_id')
    .setLabel('Citizen ID, nome e sobrenome')
    .setPlaceholder('Ex: [524] - John Smith')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(80);

  const summaryInput = new TextInputBuilder()
    .setCustomId('resumo')
    .setLabel('Resumo para avaliação da corregedoria')
    .setPlaceholder('Descreva o motivo administrativo da denúncia.')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(900);

  modal.addComponents(
    new ActionRowBuilder().addComponents(discordIdInput),
    new ActionRowBuilder().addComponents(rankRoleInput),
    new ActionRowBuilder().addComponents(rpIdInput),
    new ActionRowBuilder().addComponents(summaryInput)
  );

  return interaction.showModal(modal);
}

async function buildTicketTranscriptAttachment(channel) {
  try {
    const htmlContent = await discordTranscripts.createTranscript(channel, {
      limit: -1,
      returnType: 'string',
      minify: true,
      saveImages: true,
      useCDN: true,
    });

    if (!htmlContent) return { attachment: null, filename: '' };

    const filename = `Denuncia-${channel.name}.html`;
    return {
      attachment: new AttachmentBuilder(Buffer.from(htmlContent, 'utf8'), { name: filename }),
      filename,
    };
  } catch (error) {
    logger.warn(`Não foi possível gerar transcript para a corregedoria: ${error.message}`);
    return { attachment: null, filename: '' };
  }
}

async function restrictTicketToStaff(interaction, ticket) {
  const ownerId = getTicketOwnerId(interaction.channel, ticket);

  await interaction.channel.send({
    content: `${emojiHelper.get('check')} Denúncia encaminhada à corregedoria. A partir de agora, somente a equipe administrativa continuará a avaliação interna.`,
    allowedMentions: { users: [], roles: [], repliedUser: false },
  }).catch(() => null);

  if (ownerId) {
    await interaction.channel.permissionOverwrites.edit(ownerId, {
      ViewChannel: false,
      SendMessages: false,
    }).catch((error) => {
      logger.warn(`Não foi possível restringir o cidadão no ticket ${interaction.channel.id}: ${error.message}`);
    });
  }
}

async function moveTicketToCorregedoriaCategory(interaction) {
  const guild = interaction.guild;
  const channel = interaction.channel;
  if (!guild || !channel?.setParent) return null;

  const configuredId = await configService.getChannel(guild.id, 'corregedoriaCategory').catch(() => null)
    || '1508504446294950059';

  let category = configuredId
    ? guild.channels.cache.get(configuredId) || await guild.channels.fetch(configuredId).catch(() => null)
    : null;

  if (!category || category.type !== ChannelType.GuildCategory) {
    category = await resolver.resolveCategory(guild, 'corregedoriaCategory', 'CORREGEDORIA SSP');
  }

  if (!category || channel.parentId === category.id) return category;

  try {
    await channel.setParent(category.id, {
      lockPermissions: false,
      reason: `Denuncia encaminhada para votacao da corregedoria por ${interaction.user?.tag || interaction.user?.id || 'sistema'}`,
    });
    return category;
  } catch (error) {
    logger.warn(`Nao foi possivel mover o ticket ${channel.id} para a categoria de corregedoria: ${error.message}`);
    return null;
  }
}

async function submitCorregedoriaCase(interaction, {
  accusedUserId,
  rankRoleId = '',
  accusedRpId = '',
  summary = '',
}) {
  await interaction.deferReply(EPHEMERAL_REPLY);

  try {
    if (!await canManageTickets(interaction.member)) {
      return interaction.editReply(`${emojiHelper.get('stop')} Apenas oficiais autorizados podem encaminhar denúncias à corregedoria.`);
    }

    const ticket = await ticketsService.getAnyTicketByChannel(interaction.channel.id);
    if (!isComplaintTicket(interaction.channel, ticket)) {
      return interaction.editReply(`${emojiHelper.get('stop')} Este fluxo é destinado a tickets de denúncia/corregedoria.`);
    }

    const accusedMember = await interaction.guild.members.fetch(accusedUserId).catch(() => null);
    if (!accusedMember) {
      return interaction.editReply(`${emojiHelper.get('stop')} Não consegui encontrar o oficial denunciado no servidor.`);
    }

    const rankRole = rankRoleId
      ? interaction.guild.roles.cache.get(rankRoleId) || await interaction.guild.roles.fetch(rankRoleId).catch(() => null)
      : null;
    const ownerId = getTicketOwnerId(interaction.channel, ticket);

    const { attachment, filename } = await buildTicketTranscriptAttachment(interaction.channel);

    await restrictTicketToStaff(interaction, ticket);
    await moveTicketToCorregedoriaCategory(interaction);

    const { message } = await disciplinaryService.createCase(interaction.guild, {
      ticketChannelId: interaction.channel.id,
      ticketChannelName: interaction.channel.name,
      reporterId: ownerId || '',
      reporterLabel: ticket?.username || (ownerId ? `<@${ownerId}>` : 'Não informado'),
      accusedUserId,
      accusedLabel: getMemberDisplay(accusedMember),
      accusedRpId: accusedRpId?.trim() || 'Não informado',
      rankRoleId: rankRole?.id || '',
      rankLabel: rankRole?.name || 'Não informado',
      createdBy: interaction.user.id,
      createdByLabel: interaction.user.username,
      summary: summary?.trim() || 'Sem resumo informado.',
      transcriptFilename: filename,
    }, attachment ? [attachment] : []);

    return interaction.editReply(`${emojiHelper.get('check')} Denúncia encaminhada para votação da corregedoria: ${message.url}`);
  } catch (error) {
    logger.error('Erro ao encaminhar denúncia para corregedoria:', error);
    return interaction.editReply(`${emojiHelper.get('stop')} Não foi possível encaminhar a denúncia: ${error.message}`);
  }
}

async function handleCorregedoriaCaseModal(interaction) {
  const payload = interaction.customId.slice(CORR_CASE_MODAL_PREFIX.length);
  const [rankRoleId, accusedUserId] = payload.split(':');

  return submitCorregedoriaCase(interaction, {
    accusedUserId,
    rankRoleId,
    accusedRpId: interaction.fields.getTextInputValue('oficial_rp_id'),
    summary: interaction.fields.getTextInputValue('resumo'),
  });
}

async function handleCorregedoriaManualModal(interaction) {
  return submitCorregedoriaCase(interaction, {
    accusedUserId: interaction.fields.getTextInputValue('oficial_discord_id').replace(/\D/g, ''),
    rankRoleId: interaction.fields.getTextInputValue('patente_role_id').replace(/\D/g, ''),
    accusedRpId: interaction.fields.getTextInputValue('oficial_rp_id'),
    summary: interaction.fields.getTextInputValue('resumo'),
  });
}

async function handleCorregedoriaVote(interaction) {
  if (!await canManageTickets(interaction.member)) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Apenas a equipe autorizada pode votar nos casos de corregedoria.`,
      ...EPHEMERAL_REPLY,
    });
  }

  const option = interaction.customId.replace('corr_vote_', '');
  const caseDoc = await disciplinaryService.registerVote(interaction.message.id, interaction.user.id, option);

  return interaction.update(componentFactory.createCorregedoriaCasePayload(
    disciplinaryService.caseToPayloadData(caseDoc)
  ));
}

async function handleCorregedoriaDurationVote(interaction) {
  if (!await canManageTickets(interaction.member)) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Apenas a equipe autorizada pode votar nos casos de corregedoria.`,
      ...EPHEMERAL_REPLY,
    });
  }

  const option = interaction.customId.replace('corr_duration_', '');
  const caseDoc = await disciplinaryService.registerDurationVote(interaction.message.id, interaction.user.id, option);

  return interaction.update(componentFactory.createCorregedoriaCasePayload(
    disciplinaryService.caseToPayloadData(caseDoc)
  ));
}

async function handleCorregedoriaApplyButton(interaction) {
  if (!await canManageTickets(interaction.member)) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Apenas a equipe autorizada pode aplicar o resultado.`,
      ...EPHEMERAL_REPLY,
    });
  }

  const currentCase = await disciplinaryService.findCaseByMessage(interaction.message.id);
  const winner = disciplinaryService.getWinningOption(currentCase?.votes);
  const durationWinner = disciplinaryService.getWinningDuration(currentCase?.durationVotes);
  if (!winner) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Ainda não há votos neste caso.`,
      ...EPHEMERAL_REPLY,
    });
  }

  if (winner === 'arquivar') {
    const { caseDoc } = await disciplinaryService.applyPenalty(interaction.message.id, interaction.guild, winner, 0, interaction.user.id);
    await interaction.update(componentFactory.createCorregedoriaCasePayload(
      disciplinaryService.caseToPayloadData(caseDoc)
    ));
    await disciplinaryService.sendCaseResult(caseDoc, interaction.client);
    return null;
  }

  if (!durationWinner) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Ainda nao ha votos de duracao neste caso.`,
      ...EPHEMERAL_REPLY,
    });
  }

  const { caseDoc } = await disciplinaryService.applyPenalty(
    interaction.message.id,
    interaction.guild,
    winner,
    durationWinner,
    interaction.user.id
  );

  await interaction.update(componentFactory.createCorregedoriaCasePayload(
    disciplinaryService.caseToPayloadData(caseDoc)
  ));
  await disciplinaryService.sendCaseResult(caseDoc, interaction.client);
  return null;
}

async function handleCorregedoriaApplyModal(interaction) {
  await interaction.deferReply(EPHEMERAL_REPLY);

  try {
    if (!await canManageTickets(interaction.member)) {
      return interaction.editReply(`${emojiHelper.get('stop')} Apenas a equipe autorizada pode aplicar o resultado.`);
    }

    const [, messageId, option] = interaction.customId.split(':');
    const daysText = interaction.fields.getTextInputValue('dias');
    const days = option === 'arquivar' ? 0 : Number(daysText);
    const { caseDoc } = await disciplinaryService.applyPenalty(messageId, interaction.guild, option, days, interaction.user.id);

    await disciplinaryService.updateCaseMessage(caseDoc, interaction.client);
    await disciplinaryService.sendCaseResult(caseDoc, interaction.client);

    const label = disciplinaryService.PENALTIES[option]?.label || option;
    return interaction.editReply(
      option === 'arquivar'
        ? `${emojiHelper.get('check')} Caso arquivado sem advertência aplicada.`
        : `${emojiHelper.get('check')} ${label} aplicada. O cargo será removido automaticamente após ${days} dia(s).`
    );
  } catch (error) {
    logger.error('Erro ao aplicar resultado da corregedoria:', error);
    return interaction.editReply(`${emojiHelper.get('stop')} Não foi possível aplicar o resultado: ${error.message}`);
  }
}

/**
 * Handle: ticket_close (Button)
 * Gera transcript, envia para logs e DM do usuário e remove o ticket.
 */
async function handleClose(interaction) {
  try {
    await interaction.deferUpdate();
  } catch (ackError) {
    const isConsumedInteraction = ackError?.code === 10062 || /Unknown interaction/i.test(ackError?.message || '');
    if (isConsumedInteraction) {
      logger.debug('Interacao de fechamento ignorada porque ja foi consumida por outra instancia ou expirou.');
    } else {
      logger.warn(`Nao foi possivel reconhecer a interacao de fechamento do ticket a tempo: ${ackError?.message || 'erro desconhecido'}`);
    }
    return;
  }

  if (!await canManageTickets(interaction.member)) {
    return interaction.followUp({
      content: `${emojiHelper.get('stop')} Apenas oficiais autorizados podem encerrar tickets.`,
      ...EPHEMERAL_REPLY,
    }).catch(() => null);
  }

  const guild = interaction.guild;
  const channel = interaction.channel;
  const closingKey = channel?.id;
  if (!closingKey) return;

  if (closingTickets.has(closingKey)) {
    return interaction.followUp({
      content: `${emojiHelper.get('clock')} Este atendimento já está em processo de encerramento.`,
      ...EPHEMERAL_REPLY,
    }).catch(() => null);
  }

  closingTickets.add(closingKey);

  try {
    let ticket = await ticketsService.getAnyTicketByChannel(channel.id);

    if (ticket?.status === 'closed') {
      closingTickets.delete(closingKey);
      return interaction.followUp({
        content: `${emojiHelper.get('clock')} Este atendimento ja foi finalizado.`,
        ...EPHEMERAL_REPLY,
      }).catch(() => null);
    }

    if (ticket) {
      const closingTicket = await ticketsService.beginCloseTicket(channel, interaction.user.id);
      if (!closingTicket) {
        closingTickets.delete(closingKey);
        return interaction.followUp({
          content: `${emojiHelper.get('clock')} Este atendimento ja esta em processo de encerramento.`,
          ...EPHEMERAL_REPLY,
        }).catch(() => null);
      }
      ticket = closingTicket;
    }

    await channel.send({
      ...componentFactory.createTicketClosedPayload({ closedBy: interaction.user.id }),
      content: null,
      embeds: [],
    }).catch((error) => logger.error('Erro ao enviar aviso de fechamento do ticket:', error));

  const ownerId = getTicketOwnerId(channel, ticket);

const LspdTranscript = require('../../database/models/LspdTranscript');

// 1. Gerar o HTML Transcript
  let attachment;
  let transcriptBuffer = null;
  let transcriptFilename = '';
  let htmlContent = '';
  try {
    htmlContent = await discordTranscripts.createTranscript(channel, {
      limit: -1,
      returnType: 'string',
      minify: true,
      saveImages: true,
      useCDN: true,
    });
    
    if (htmlContent) {
      transcriptFilename = `Processo-${channel.name}.html`;
      transcriptBuffer = Buffer.from(htmlContent, 'utf8');
      attachment = new AttachmentBuilder(transcriptBuffer, { name: transcriptFilename });
      
      // Salvar no Banco de Dados
      try {
        const isCorregedoria = channel.name.includes('corregedoria') || (ticket && ticket.reason && ticket.reason.toLowerCase().includes('corregedoria'));
        const protocolo = `PRT-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`;
        
        await LspdTranscript.create({
          ticketId: channel.id,
          channelName: channel.name,
          citizenId: ownerId || '0',
          citizenName: ticket ? ticket.username : 'Desconhecido',
          closedBy: interaction.user.id,
          closedByName: interaction.user.username,
          modulo: isCorregedoria ? 'corregedoria' : 'atendimento',
          htmlContent: htmlContent,
          protocolo: protocolo
        });
      } catch (dbError) {
        logger.error('Erro ao salvar transcript no banco de dados:', dbError);
      }
    }
  } catch (error) {
    logger.error('Erro ao gerar transcript:', error);
  }

  // 2. Resolver o canal de logs e enviar
  const logChannel = await resolver.resolveChannel(guild, 'adminLogs', '📄・log-gerais', { autoCreate: false });
  if (logChannel && attachment) {
    try {
      await logChannel.send({
        ...componentFactory.createTicketArchiveLogPayload({
          channelName: channel.name,
          channelId: channel.id,
          officerId: interaction.user.id,
          citizenId: ownerId,
          transcriptFilename,
        }),
        content: null,
        embeds: [],
        files: [attachment],
      });
    } catch (logError) {
      logger.error('Erro ao enviar log do transcript:', logError);
    }
  }

  // 3. Enviar DM para o cidadão dono do ticket
  if (ownerId && transcriptBuffer) {
    try {
      const dono = await guild.members.fetch(ownerId).catch(() => null);
      if (dono) {
        const dmAttachment = new AttachmentBuilder(transcriptBuffer, { name: transcriptFilename });
        await dono.send({
          ...componentFactory.createTicketDmCopyPayload({ ownerId, channelName: channel.name, transcriptFilename }),
          files: [dmAttachment],
        });
      }
    } catch (dmError) {
      logger.info(`Não foi possível enviar DM para o utilizador ${ownerId} (DMs fechadas).`);
    }
  }

  // 4. Executar limpeza e deleção
  setTimeout(async () => {
    try {
      // Remover canal de voz associado se existir
      const ticketName = channel.name.split('-')[1];
      const nameVoiceChannel = `📞・ rádio-${ticketName}`;
      const legacyVoiceChannel = `📞 rádio-${ticketName}`;
      const canalVoz = guild.channels.cache.find(
        c => [nameVoiceChannel, legacyVoiceChannel].includes(c.name) && c.type === ChannelType.GuildVoice
      );
      if (canalVoz) {
        await canalVoz.delete().catch(() => null);
      }

      // Remover o canal de texto
      await channel.delete().catch(() => null);

      if (!ticket?._id) {
        await ticketsService.closeTicket(channel, interaction.user.id);
      }
    } catch (cleanError) {
      logger.error('Erro na limpeza final do ticket:', cleanError);
    } finally {
      closingTickets.delete(closingKey);
    }
  }, 5000);
  } catch (error) {
    closingTickets.delete(closingKey);
    logger.error('Erro ao encerrar ticket:', error);
    await interaction.followUp({
      content: `${emojiHelper.get('stop')} Não foi possível encerrar este atendimento agora.`,
      ...EPHEMERAL_REPLY,
    }).catch(() => null);
  }
}

/**
 * Handle: ticket_abrir e ticket_abrir_* (Buttons)
 * Abre o ticket baseado no departamento (se aplicável).
 */
async function handleOpenTicketByButton(interaction) {
  let departmentKey = 'suporte'; // Padrão/Suporte Geral
  if (interaction.customId.includes('_')) {
    const parts = interaction.customId.split('_');
    const key = parts[parts.length - 1]; // e.g. 'suporte', 'denuncia', 'corregedoria'
    if (ticketsService.nomesDepartamentos[key]) {
      departmentKey = key;
    }
  }

  return openTicketForDepartment(interaction, departmentKey);
}

module.exports = {
  handleSelectType,
  handleClaim,
  handleHold,
  handleAddMemberButton,
  handleAddMemberModal,
  handlePing,
  handleRegistrationUpdateSelect,
  handleRegistrationNameModal,
  handleRegistrationPatenteModal,
  handleRegistrationBadgeModal,
  handleRegistrationOutroModal,
  handleRadioCall,
  handleCorregedoriaStart,
  handleCorregedoriaRankSelect,
  handleCorregedoriaOfficerSelect,
  handleCorregedoriaManualButton,
  handleCorregedoriaCaseModal,
  handleCorregedoriaManualModal,
  handleCorregedoriaVote,
  handleCorregedoriaDurationVote,
  handleCorregedoriaApplyButton,
  handleCorregedoriaApplyModal,
  handleClose,
  handleOpenTicketByButton,
};
