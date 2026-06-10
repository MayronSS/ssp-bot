const { ChannelType, PermissionFlagsBits } = require('discord.js');
const resolver = require('../../utils/resolver');
const env = require('../../config/env');
const ticketsRepository = require('./tickets.repository');
const logger = require('../../utils/logger');

/**
 * Service do módulo de Tickets — regras de negócio com Auto-Discovery.
 */

const nomesDepartamentos = {
  'denuncia': 'Denúncia Anônima',
  'suporte': 'Suporte Geral',
  'perfil': 'Atualização de Registro',
  'corregedoria': 'Assuntos Internos',
  'recrutamento': 'Recrutamento | Pre-aprovacao'
};

/**
 * Cria um canal de ticket resolvendo categoria e cargos de forma dinâmica (zero-config).
 */
async function createTicketChannel(guild, user, departmentKey, customCategoryId = null, corpSlug = 'pmesp') {
  const departmentName = nomesDepartamentos[departmentKey] || 'Suporte Geral';
  const departmentEmojis = {
    'suporte': '📋',
    'denuncia': '🛑',
    'perfil': '🪪',
    'corregedoria': '⚖️',
    'recrutamento': '🔰'
  };
  const emojiPrefix = departmentEmojis[departmentKey] || '📄';
  const cleanUsername = user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
  const channelName = `${emojiPrefix}・ticket-${cleanUsername}`;

  // 1. Resolver a categoria do ticket
  let category = null;
  if (customCategoryId) {
    category = guild.channels.cache.get(customCategoryId) || await guild.channels.fetch(customCategoryId).catch(() => null);
  }
  if (!category) {
    const corpCategoryChannelId = await require('../../services/corporationService').getChannel(guild.id, corpSlug, 'ticketsCategory');
    if (corpCategoryChannelId) {
      category = guild.channels.cache.get(corpCategoryChannelId) || await guild.channels.fetch(corpCategoryChannelId).catch(() => null);
    }
  }
  if (!category) {
    category = await resolver.resolveCategory(guild, 'ticketsCategory', '🎫 TICKETS SSP');
  }

  // 2. Resolver o cargo da Staff/Suporte do Ticket
  let staffRole = null;
  const corpStaffRoleId = await require('../../services/corporationService').getRole(guild.id, corpSlug, 'staff');
  if (corpStaffRoleId) {
    staffRole = guild.roles.cache.get(corpStaffRoleId) || await guild.roles.fetch(corpStaffRoleId).catch(() => null);
  }
  if (!staffRole) {
    staffRole = await resolver.resolveRole(guild, 'ticketStaff', 'Staff', ['Suporte', 'Comando']);
  }

  const permissionOverwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
      ],
    },
  ];

  if (staffRole) {
    permissionOverwrites.push({
      id: staffRole.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
      ],
    });
  }

  // Se houver um cargo de Comando configurado
  const commandRole = await resolver.resolveRole(guild, 'comandoAdmin', 'Comando', ['Alto Comando', 'Diretoria']);
  if (commandRole) {
    permissionOverwrites.push({
      id: commandRole.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
      ],
    });
  }

  const channelOptions = {
    name: channelName,
    type: ChannelType.GuildText,
    topic: `Ticket ID: ${user.id} | Departamento: ${departmentName}`,
    permissionOverwrites,
  };

  if (category) {
    channelOptions.parent = category.id;
  }

  const ticketChannel = await guild.channels.create(channelOptions);

  // Registrar no banco de dados (MongoDB)
  const ticket = await ticketsRepository.createTicket({
    corporationSlug: corpSlug,
    channelId: ticketChannel.id,
    userId: user.id,
    username: user.username,
    reason: departmentName,
    description: `Departamento selecionado: ${departmentName}`,
  });

  logger.info(`Ticket criado: ${channelName} (ID: ${ticket._id})`);
  return { channel: ticketChannel, ticket, staffRole };
}

/**
 * Fecha um ticket — atualiza status e agenda deleção do canal.
 */
async function closeTicket(channel, closedByUserId) {
  const ticket = await ticketsRepository.findByChannelId(channel.id);

  if (ticket) {
    await ticketsRepository.closeTicket(ticket._id, closedByUserId);
    logger.info(`Ticket fechado no banco de dados: ${channel.name} por ${closedByUserId}`);
  }

  return ticket;
}

/**
 * Reserva atomicamente o fechamento do ticket.
 * Evita duplicar transcript/log/DM quando mais de um processo recebe o mesmo clique.
 */
async function beginCloseTicket(channel, closedByUserId) {
  const ticket = await ticketsRepository.closeOpenTicketByChannelId(channel.id, closedByUserId);

  if (ticket) {
    logger.info(`Ticket marcado como fechado no banco de dados: ${channel.name} por ${closedByUserId}`);
  }

  return ticket;
}

/**
 * Registra quem assumiu o ticket.
 */
async function claimTicket(channelId, userId) {
  const ticket = await ticketsRepository.findByChannelId(channelId);
  if (!ticket) return null;

  const updatedTicket = await ticketsRepository.claimTicket(ticket._id, userId);
  logger.info(`Ticket assumido no banco de dados: ${channelId} por ${userId}`);
  return updatedTicket || { ...ticket, claimedBy: userId };
}

/**
 * Obtém dados do ticket pelo canal.
 */
async function getTicketByChannel(channelId) {
  return ticketsRepository.findByChannelId(channelId);
}

async function getAnyTicketByChannel(channelId) {
  return ticketsRepository.findAnyByChannelId(channelId);
}

/**
 * Verifica se o usuário já possui um ticket aberto.
 */
async function hasOpenTicket(userId) {
  return ticketsRepository.findOpenByUserId(userId);
}

module.exports = {
  nomesDepartamentos,
  createTicketChannel,
  closeTicket,
  beginCloseTicket,
  claimTicket,
  getTicketByChannel,
  getAnyTicketByChannel,
  hasOpenTicket,
};
