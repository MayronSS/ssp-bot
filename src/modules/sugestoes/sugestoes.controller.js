const Suggestion = require('../../database/models/Suggestion');
const componentFactory = require('../../utils/componentFactory');
const emojiHelper = require('../../utils/emojiHelper');
const logger = require('../../utils/logger');
const { EPHEMERAL_REPLY } = require('../../utils/interactionOptions');

/**
 * Converte automaticamente uma mensagem digitada no canal de sugestões em um card de votação com thread.
 * 
 * @param {Message} message - Mensagem enviada pelo usuário
 */
async function handleSugestaoAutoConvert(message) {
  try {
    const content = message.content.trim();
    if (!content) return;

    // Excluir a mensagem original digitada pelo usuário
    await message.delete().catch(() => {});

    // Contar quantas sugestões este usuário já enviou
    const otherSuggestionsCount = await Suggestion.countDocuments({
      guildId: message.guild.id,
      userId: message.author.id,
    });

    // Criar o registro da sugestão no banco
    const suggestion = await Suggestion.create({
      guildId: message.guild.id,
      messageId: 'PENDING_' + Date.now(),
      userId: message.author.id,
      content,
      votesUp: [],
      votesDown: [],
    });

    const avatarUrl = message.author.displayAvatarURL({ extension: 'png', size: 256 }) || null;
    const username = message.member?.displayName || message.author.globalName || message.author.username;

    // Gerar o card de sugestão
    const payload = componentFactory.createSugestaoCardPayload(suggestion, avatarUrl, otherSuggestionsCount, username);

    // Enviar no mesmo canal
    const cardMessage = await message.channel.send(payload);

    // Atualizar messageId real no banco
    suggestion.messageId = cardMessage.id;
    await suggestion.save();

    // Criar a thread pública para debate da sugestão
    await cardMessage.startThread({
      name: `Debate — Sugestão #${String(suggestion._id).slice(-4).toUpperCase()}`,
      autoArchiveDuration: 1440,
      reason: 'Debate de sugestão de melhoria da corporação',
    }).catch((err) => {
      logger.error('Erro ao abrir thread para sugestão:', err);
    });

  } catch (error) {
    logger.error('Erro ao auto-converter mensagem em sugestão:', error);
  }
}

/**
 * Processa os votos (apoiar/recusar) atualizando as porcentagens.
 */
async function handleSugestaoVote(interaction) {
  const [action, suggestionId] = interaction.customId.split(':');
  const isUp = action === 'sugestao_voto_up';
  const userId = interaction.user.id;

  try {
    const suggestion = await Suggestion.findById(suggestionId);
    if (!suggestion) {
      return interaction.reply({
        content: `${emojiHelper.get('stop')} Sugestão não encontrada no banco de dados.`,
        ...EPHEMERAL_REPLY,
      });
    }

    // Gerenciar arrays de voto
    const upIndex = suggestion.votesUp.indexOf(userId);
    const downIndex = suggestion.votesDown.indexOf(userId);

    if (isUp) {
      if (upIndex !== -1) {
        // Retirar voto favorável
        suggestion.votesUp.splice(upIndex, 1);
      } else {
        // Votar a favor e remover contra se existir
        suggestion.votesUp.push(userId);
        if (downIndex !== -1) suggestion.votesDown.splice(downIndex, 1);
      }
    } else {
      if (downIndex !== -1) {
        // Retirar voto contra
        suggestion.votesDown.splice(downIndex, 1);
      } else {
        // Votar contra e remover a favor se existir
        suggestion.votesDown.push(userId);
        if (upIndex !== -1) suggestion.votesUp.splice(upIndex, 1);
      }
    }

    await suggestion.save();

    // Obter quantidade de outras sugestões do autor para atualizar o embed
    const count = await Suggestion.countDocuments({
      guildId: suggestion.guildId,
      userId: suggestion.userId,
    }) - 1;
    const otherSuggestionsCount = Math.max(0, count);

    // Resolver usuário/avatar para atualizar o embed
    const member = await interaction.guild.members.fetch(suggestion.userId).catch(() => null);
    const avatarUrl = member?.user.displayAvatarURL({ extension: 'png', size: 256 }) || null;
    const username = member?.displayName || member?.user.globalName || member?.user.username || 'Oficial';

    // Atualizar mensagem
    const payload = componentFactory.createSugestaoCardPayload(suggestion, avatarUrl, otherSuggestionsCount, username);
    await interaction.update(payload);
  } catch (error) {
    logger.error('Erro ao registrar voto na sugestão:', error);
    await interaction.reply({
      content: `${emojiHelper.get('stop')} Não foi possível computar o seu voto neste momento.`,
      ...EPHEMERAL_REPLY,
    });
  }
}

module.exports = {
  handleSugestaoAutoConvert,
  handleSugestaoVote,
};
