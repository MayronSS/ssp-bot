const commandHandler = require('../handlers/commandHandler');
const buttonHandler = require('../handlers/buttonHandler');
const modalHandler = require('../handlers/modalHandler');
const selectMenuHandler = require('../handlers/selectMenuHandler');

/**
 * Evento interactionCreate.
 * Apenas identifica o tipo da interação e encaminha para o handler correto.
 * Nenhuma lógica de negócio fica aqui.
 */
module.exports = {
  name: 'interactionCreate',

  async execute(interaction) {
    if (interaction.isChatInputCommand()) {
      return commandHandler(interaction);
    }

    if (interaction.isButton()) {
      return buttonHandler(interaction);
    }

    if (interaction.isModalSubmit()) {
      return modalHandler(interaction);
    }

    if (
      interaction.isStringSelectMenu() ||
      (typeof interaction.isRoleSelectMenu === 'function' && interaction.isRoleSelectMenu())
    ) {
      return selectMenuHandler(interaction);
    }
  },
};
