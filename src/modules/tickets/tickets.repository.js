const Ticket = require('../../database/models/Ticket');

/**
 * Repository de Tickets — camada de persistência (MongoDB).
 */

/**
 * Cria um novo registro de ticket.
 */
async function createTicket({ channelId, userId, username, reason, description }) {
  const ticket = await Ticket.create({
    channelId,
    userId,
    username,
    reason: reason || '',
    description: description || '',
    status: 'open',
    claimedBy: null,
    closedAt: null,
    closedBy: null,
  });
  return ticket;
}

/**
 * Busca um ticket aberto pelo ID do canal.
 */
async function findByChannelId(channelId) {
  return Ticket.findOne({ channelId, status: 'open' }).lean();
}

async function findAnyByChannelId(channelId) {
  return Ticket.findOne({ channelId }).lean();
}

/**
 * Busca um ticket aberto pelo ID do usuário.
 */
async function findOpenByUserId(userId) {
  return Ticket.findOne({ userId, status: 'open' }).lean();
}

/**
 * Fecha um ticket.
 */
async function closeTicket(ticketId, closedBy) {
  return Ticket.findByIdAndUpdate(
    ticketId,
    {
      status: 'closed',
      closedAt: new Date(),
      closedBy,
    },
    { returnDocument: 'after' }
  ).lean();
}

async function closeOpenTicketByChannelId(channelId, closedBy) {
  return Ticket.findOneAndUpdate(
    { channelId, status: 'open' },
    {
      status: 'closed',
      closedAt: new Date(),
      closedBy,
    },
    { returnDocument: 'after' }
  ).lean();
}

/**
 * Registra quem assumiu o ticket.
 */
async function claimTicket(ticketId, claimedBy) {
  return Ticket.findByIdAndUpdate(
    ticketId,
    { claimedBy },
    { returnDocument: 'after' }
  ).lean();
}

/**
 * Busca um ticket por ID.
 */
async function findById(ticketId) {
  return Ticket.findById(ticketId).lean();
}

module.exports = {
  createTicket,
  findByChannelId,
  findAnyByChannelId,
  findOpenByUserId,
  closeTicket,
  closeOpenTicketByChannelId,
  claimTicket,
  findById,
};
