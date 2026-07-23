const roles = require('./roles');

/**
 * Mapeamento de permissões por módulo.
 * Cada módulo lista quais cargos têm acesso.
 * O array é verificado com OR — basta ter um dos cargos.
 */
module.exports = {
  tickets: [roles.ticketStaff, roles.command],
  edital: [], // Qualquer membro pode interagir com o edital
  setup: [roles.setup, roles.command],
};
