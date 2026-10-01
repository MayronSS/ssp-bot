/**
 * Formata duração em minutos para formato legível.
 *
 * @param {number} totalMinutes - Total de minutos
 * @returns {string} Duração formatada (ex: "2h45min")
 */
function formatDuration(totalMinutes) {
  if (totalMinutes < 1) return '0min';

  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);

  if (hours === 0) return `${minutes}min`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h${minutes}min`;
}

/**
 * Calcula a diferença em minutos entre duas datas.
 *
 * @param {Date|string} start - Data de início
 * @param {Date|string} end - Data de fim
 * @returns {number} Diferença em minutos
 */
function calcDurationMinutes(start, end) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return (endDate.getTime() - startDate.getTime()) / (1000 * 60);
}

module.exports = { formatDuration, calcDurationMinutes };
