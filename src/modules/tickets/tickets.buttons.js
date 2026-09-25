const { ButtonStyle } = require('discord.js');
const { createButtonRow } = require('../../utils/createButtons');

/**
 * Botões padronizados do módulo de Tickets.
 * Custom IDs seguem o padrão: tickets:acao
 */

function panelButtons() {
  return createButtonRow([
    {
      customId: 'tickets:open',
      label: 'Abrir Ticket',
      style: ButtonStyle.Primary,
      emoji: '🎫',
    },
  ]);
}

function ticketControlButtons() {
  return createButtonRow([
    {
      customId: 'tickets:claim',
      label: 'Assumir',
      style: ButtonStyle.Success,
      emoji: '👤',
    },
    {
      customId: 'tickets:summary',
      label: 'Resumo',
      style: ButtonStyle.Secondary,
      emoji: '📄',
    },
    {
      customId: 'tickets:close',
      label: 'Fechar Ticket',
      style: ButtonStyle.Danger,
      emoji: '🔒',
    },
  ]);
}

module.exports = {
  panelButtons,
  ticketControlButtons,
};
