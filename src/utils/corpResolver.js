const corporationService = require('../services/corporationService');
const corporationsConfig = require('../config/corporations');
const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');

/**
 * Resolve a corporação de um membro a partir dos seus cargos.
 * 
 * - Se tem 1 cargo de corporação → retorna o slug diretamente.
 * - Se tem 2+ cargos → mostra select menu perguntando qual corporação.
 * - Se não tem nenhum → retorna null (o chamador deve tratar).
 * 
 * @param {import('discord.js').Interaction} interaction
 * @param {string|null} corpSlugFromId - Slug extraído do customId (se houver).
 * @param {string} nextAction - O customId base para continuar após seleção.
 * @returns {Promise<string|null>} O slug da corporação ou null se não resolvido.
 */
async function resolveCorpFromMember(interaction, corpSlugFromId, nextAction) {
  // Se já veio com slug no customId, usa direto
  if (corpSlugFromId) return corpSlugFromId;

  const member = interaction.member;
  if (!member) return null;

  const guildId = interaction.guildId;
  const matchedSlugs = [];

  // Verificar quais corporações primárias o membro possui
  for (const corpConfig of corporationsConfig.corporations) {
    const corp = await corporationService.getBySlug(guildId, corpConfig.slug);
    if (corp && corp.roles && corp.roles.geral && member.roles.cache.has(corp.roles.geral)) {
      matchedSlugs.push(corpConfig.slug);
    }
  }

  if (matchedSlugs.length === 1) {
    return matchedSlugs[0];
  }

  if (matchedSlugs.length === 0) {
    // Sem corporação — avisar o membro com mensagem simples (ephemeral)
    await interaction.reply({
      content: '❌ **Corporação não identificada**\n\n> Você não possui cargo de nenhuma corporação (PMESP ou PCESP).\n> Peça a um superior para atribuir seu cargo de corporação.',
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  // Tem mais de 1 corporação — perguntar com select menu
  const emojiHelper = require('./emojiHelper');
  const corpEmojiMap = {
    pmesp: emojiHelper.getRaw('shield_pm'),
    pcesp: emojiHelper.getRaw('shield_pc'),
  };

  const options = matchedSlugs.map(slug => {
    const config = corporationsConfig.corporations.find(c => c.slug === slug);
    return {
      label: config ? config.shortName : slug.toUpperCase(),
      value: `${nextAction}:${slug}`,
      description: config ? config.name : slug,
      emoji: corpEmojiMap[slug] || emojiHelper.getRaw('star_badge'),
    };
  });

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('corp_select_action')
    .setPlaceholder('Selecione a corporação...')
    .addOptions(options);

  await interaction.reply({
    content: '🏛️ **Selecione a Corporação**\n\n> Você pertence a mais de uma corporação.\n> Escolha abaixo qual deseja utilizar para esta ação.',
    components: [new ActionRowBuilder().addComponents(selectMenu)],
    flags: MessageFlags.Ephemeral,
  });

  return null; // A ação será retomada quando o select for respondido
}

module.exports = { resolveCorpFromMember };
