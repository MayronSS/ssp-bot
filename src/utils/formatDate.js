/**
 * Formata uma data para o padrão brasileiro.
 *
 * @param {Date|string} date - Data a ser formatada
 * @returns {string} Data formatada (dd/mm/aaaa às HH:MM)
 */
function formatDate(date) {
  const d = new Date(date);
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const ano = d.getFullYear();
  const hora = String(d.getHours()).padStart(2, '0');
  const minuto = String(d.getMinutes()).padStart(2, '0');

  return `${dia}/${mes}/${ano} às ${hora}:${minuto}`;
}

/**
 * Retorna o timestamp Discord formatado.
 *
 * @param {Date|string} date - Data
 * @param {string} [style='f'] - Estilo do timestamp (t, T, d, D, f, F, R)
 * @returns {string} Timestamp Discord
 */
function discordTimestamp(date, style = 'f') {
  const timestamp = Math.floor(new Date(date).getTime() / 1000);
  return `<t:${timestamp}:${style}>`;
}

module.exports = { formatDate, discordTimestamp };
