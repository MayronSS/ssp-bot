const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * Cria um ActionRow com botões a partir de um array de configurações.
 *
 * @param {Array} buttons - Array de objetos com { customId, label, style, emoji, disabled }
 * @returns {ActionRowBuilder}
 */
function createButtonRow(buttons) {
  const row = new ActionRowBuilder();

  for (const btn of buttons) {
    const button = new ButtonBuilder()
      .setCustomId(btn.customId)
      .setLabel(btn.label)
      .setStyle(btn.style || ButtonStyle.Primary);

    if (btn.emoji) button.setEmoji(btn.emoji);
    if (btn.disabled) button.setDisabled(true);

    row.addComponents(button);
  }

  return row;
}

module.exports = { createButtonRow };
