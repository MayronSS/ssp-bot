const pontoService = require('./ponto.service');
const { EPHEMERAL_REPLY } = require('../../utils/interactionOptions');

/**
 * Injeta o corpSlug na interaction para uso pelos services.
 */
function injectCorpSlug(interaction, corpSlug) {
  interaction._corpSlug = corpSlug || 'pmesp';
}

/**
 * Handle: ponto_bater (Button)
 * Registra ou encerra o turno do policial (Toggle).
 */
async function handleTogglePonto(interaction, corpSlug) {
  injectCorpSlug(interaction, corpSlug);
  await interaction.deferReply(EPHEMERAL_REPLY);
  await pontoService.togglePonto(interaction);
}

/**
 * Handle: ponto_ranking (Button)
 * Exibe o TOP 10 de oficiais com mais tempo acumulado.
 */
async function handleVerRanking(interaction, corpSlug) {
  injectCorpSlug(interaction, corpSlug);
  await interaction.deferReply(EPHEMERAL_REPLY);
  await pontoService.verRanking(interaction);
}

/**
 * Handle: registrar_entrada / ponto_bater (Button)
 */
async function handleEntrada(interaction, corpSlug) {
  injectCorpSlug(interaction, corpSlug);
  await interaction.deferReply(EPHEMERAL_REPLY);
  await pontoService.registrarEntrada(interaction);
}

async function handleSaida(interaction, corpSlug) {
  injectCorpSlug(interaction, corpSlug);
  await interaction.deferReply(EPHEMERAL_REPLY);
  await pontoService.registrarSaida(interaction);
}

async function handleRefresh(interaction, corpSlug) {
  injectCorpSlug(interaction, corpSlug);
  await interaction.deferReply(EPHEMERAL_REPLY);
  await pontoService.atualizarStatus(interaction);
}

module.exports = {
  handleTogglePonto,
  handleVerRanking,
  handleEntrada,
  handleSaida,
  handleRefresh,
};
