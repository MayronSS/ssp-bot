const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

/**
 * Modals padronizados do módulo de Tickets.
 * Custom IDs seguem o padrão: tickets:acao
 */

function openTicketModal() {
  const modal = new ModalBuilder()
    .setCustomId('tickets:open_modal')
    .setTitle('SSP — Abertura de Ticket');

  const reasonInput = new TextInputBuilder()
    .setCustomId('ticket_reason')
    .setLabel('Qual o motivo do atendimento?')
    .setPlaceholder('Ex: Dúvida, Solicitação, Denúncia...')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const descriptionInput = new TextInputBuilder()
    .setCustomId('ticket_description')
    .setLabel('Descreva sua solicitação')
    .setPlaceholder('Explique detalhadamente o que precisa...')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000);

  modal.addComponents(
    new ActionRowBuilder().addComponents(reasonInput),
    new ActionRowBuilder().addComponents(descriptionInput)
  );

  return modal;
}

module.exports = {
  openTicketModal,
};
