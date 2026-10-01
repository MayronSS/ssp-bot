const logger = require('../utils/logger');
const { EPHEMERAL_REPLY } = require('../utils/interactionOptions');

/**
 * Handler de comandos slash.
 * Busca o comando na collection do client e executa.
 */
async function commandHandler(interaction) {
  const allowedUserId = process.env.SETUP_ALLOWED_USER_ID || '896063696567152671';
  if (interaction.user.id !== allowedUserId) {
    const { createErrorEmbed } = require('../utils/createEmbed');
    return interaction.reply({
      embeds: [createErrorEmbed('Acesso Negado', 'Você não possui permissão para executar comandos deste bot.')],
      ...EPHEMERAL_REPLY,
    });
  }

  const command = interaction.client.commands.get(interaction.commandName);

  if (!command) {
    logger.warn(`Comando não encontrado: ${interaction.commandName}`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    logger.error(`Erro ao executar comando /${interaction.commandName}:`, error);

    const reply = {
      content: '❌ Ocorreu um erro ao executar este comando.',
      ...EPHEMERAL_REPLY,
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
}

module.exports = commandHandler;
