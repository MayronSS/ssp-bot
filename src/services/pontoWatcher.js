/**
 * Serviço de monitoramento automático do bate-ponto.
 * Verifica periodicamente o MongoDB por mudanças nos registros de ponto
 * e atualiza o painel do Discord automaticamente.
 */
const Ponto = require('../database/models/Ponto');
const pontoService = require('../modules/ponto/ponto.service');
const logger = require('../utils/logger');
const env = require('../config/env');

// Intervalo de verificação (30 segundos)
const POLL_INTERVAL_MS = 30 * 1000;

// Estado anterior para detectar mudanças
let lastPontoState = null;
let watcherInterval = null;

/**
 * Gera uma "assinatura" do estado atual dos pontos abertos
 * para comparar com o estado anterior e detectar mudanças.
 */
async function getPontoStateSignature() {
  const abertos = await Ponto.find({ status: 'aberto' })
    .select('_id userId entrada')
    .sort({ entrada: 1 })
    .lean();

  // Também contar o total de pontos fechados recentes (últimos 2 minutos)
  const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000);
  const fechadosRecentes = await Ponto.countDocuments({
    status: 'fechado',
    updatedAt: { $gte: twoMinAgo }
  });

  // A assinatura é: IDs dos abertos + contagem de fechados recentes
  const abertosIds = abertos.map(p => p._id.toString()).join(',');
  return `${abertosIds}|${fechadosRecentes}|${abertos.length}`;
}

/**
 * Atualiza o painel de ponto no Discord.
 */
async function refreshDiscordPanel(guild) {
  try {
    await pontoService.updateConfiguredPontoPanel(guild);
    logger.info('[PontoWatcher] Painel de ponto do Discord atualizado automaticamente.');
  } catch (err) {
    logger.error('[PontoWatcher] Erro ao atualizar painel:', err);
  }
}

/**
 * Função de polling — verifica se houve mudanças no estado do ponto.
 */
async function checkForChanges(client) {
  try {
    const guild = await client.guilds.fetch(env.GUILD_ID).catch(() => null);
    if (!guild) return;

    const currentState = await getPontoStateSignature();

    if (lastPontoState !== null && currentState !== lastPontoState) {
      logger.info('[PontoWatcher] Mudança detectada nos registros de ponto. Atualizando painel...');
      await refreshDiscordPanel(guild);
    }

    lastPontoState = currentState;
  } catch (err) {
    // Silenciar erros de polling para não lotar o log
    if (err.message && !err.message.includes('ECONNREFUSED')) {
      logger.error('[PontoWatcher] Erro no polling:', err);
    }
  }
}

/**
 * Inicia o monitoramento automático do ponto.
 * Deve ser chamado após o bot estar ready e o MongoDB conectado.
 */
function startPontoWatcher(client) {
  if (watcherInterval) {
    clearInterval(watcherInterval);
  }

  // Capturar estado inicial sem atualizar o painel
  checkForChanges(client).then(() => {
    logger.success(`[PontoWatcher] Monitoramento automático iniciado (intervalo: ${POLL_INTERVAL_MS / 1000}s)`);
  });

  watcherInterval = setInterval(() => {
    checkForChanges(client);
  }, POLL_INTERVAL_MS);
}

/**
 * Para o monitoramento (usado em shutdown graceful).
 */
function stopPontoWatcher() {
  if (watcherInterval) {
    clearInterval(watcherInterval);
    watcherInterval = null;
    logger.info('[PontoWatcher] Monitoramento parado.');
  }
}

module.exports = { startPontoWatcher, stopPontoWatcher };
