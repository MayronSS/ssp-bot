const env = require('./env');

module.exports = {
  ticketsPanel: env.CHANNEL_TICKETS_PANEL,
  ticketsCategory: env.CATEGORY_TICKETS,
  editalCategory: env.CATEGORY_EDITAL,
  editalPanel: env.CHANNEL_EDITAL_PANEL,
  adminLogs: env.CHANNEL_ADMIN_LOGS,
  avaliacao: env.CHANNEL_AVALIACAO,
  avaliacaoPmesp: env.CHANNEL_AVALIACAO_PMESP,
  avaliacaoPcesp: env.CHANNEL_AVALIACAO_PCESP,
  resultados: env.CHANNEL_RESULTADOS,
  resultadosPmesp: env.CHANNEL_RESULTADOS_PMESP,
  resultadosPcesp: env.CHANNEL_RESULTADOS_PCESP,
  corregedoriaResults: env.CHANNEL_CORREGEDORIA_RESULTS,
  disciplinaryWarnings: env.CHANNEL_DISCIPLINARY_WARNINGS,
  ausenciaPanel: env.CHANNEL_AUSENCIA_PANEL,
  ausenciaLogs: env.CHANNEL_AUSENCIA_LOGS,
  warningPanel: env.CHANNEL_WARNING_PANEL,
};
