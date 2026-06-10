const { ButtonStyle } = require('discord.js');
const { createBaseEmbed } = require('../../utils/createEmbed');
const settings = require('../../config/settings');
const embedsConfig = require('../../config/embeds');

/**
 * Embeds padronizados do módulo de Tickets.
 */

function panelEmbed() {
  return createBaseEmbed({
    title: embedsConfig.tickets.panel.title,
    description: embedsConfig.tickets.panel.description,
    color: settings.colors.primary,
    timestamp: true,
  });
}

function ticketOpenedEmbed(userId, staffRoleId) {
  return createBaseEmbed({
    title: embedsConfig.tickets.opened.title,
    description: embedsConfig.tickets.opened.description(userId, staffRoleId),
    color: settings.colors.primary,
    timestamp: true,
  });
}

function ticketClosedEmbed(closedByUserId) {
  return createBaseEmbed({
    title: embedsConfig.tickets.closed.title,
    description: `${embedsConfig.tickets.closed.description}\n\n> Fechado por: <@${closedByUserId}>`,
    color: settings.colors.danger,
    timestamp: true,
  });
}

function ticketSummaryEmbed(ticket) {
  const fields = [
    { name: 'Aberto por', value: `<@${ticket.userId}>`, inline: true },
    { name: 'Status', value: `\`${ticket.status}\``, inline: true },
    { name: 'Motivo', value: ticket.reason || 'Não informado', inline: false },
    { name: 'Descrição', value: ticket.description || 'Não informada', inline: false },
  ];

  if (ticket.claimedBy) {
    fields.push({ name: 'Responsável', value: `<@${ticket.claimedBy}>`, inline: true });
  }

  return createBaseEmbed({
    title: embedsConfig.tickets.summary.title,
    color: settings.colors.info,
    fields,
    timestamp: true,
  });
}

module.exports = {
  panelEmbed,
  ticketOpenedEmbed,
  ticketClosedEmbed,
  ticketSummaryEmbed,
};
