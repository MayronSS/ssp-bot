/**
 * Logger simples com timestamps e prefixos visuais.
 * Substitui console.log espalhados pelo projeto.
 */

function getTimestamp() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

const logger = {
  info(message) {
    console.log(`[${getTimestamp()}] [INFO]  ${message}`);
  },

  warn(message) {
    console.warn(`[${getTimestamp()}] [WARN]  ${message}`);
  },

  error(message, error) {
    console.error(`[${getTimestamp()}] [ERROR] ${message}`);
    if (error && error.stack) {
      console.error(error.stack);
    }
  },

  success(message) {
    console.log(`[${getTimestamp()}] [OK]    ${message}`);
  },

  debug(message) {
    if (process.env.DEBUG === 'true') {
      console.log(`[${getTimestamp()}] [DEBUG] ${message}`);
    }
  },
};

module.exports = logger;
