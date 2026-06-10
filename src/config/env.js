require('dotenv').config();

const env = {
  // Bot
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  CLIENT_ID: process.env.CLIENT_ID,
  GUILD_ID: process.env.GUILD_ID,

  // Canais
  CHANNEL_TICKETS_PANEL: process.env.CHANNEL_TICKETS_PANEL,
  CATEGORY_TICKETS: process.env.CATEGORY_TICKETS,
  CATEGORY_CORREGEDORIA: process.env.CATEGORY_CORREGEDORIA,
  CHANNEL_EDITAL_PANEL: process.env.CHANNEL_EDITAL_PANEL,
  CHANNEL_ADMIN_LOGS: process.env.CHANNEL_ADMIN_LOGS,
  CHANNEL_AVALIACAO: process.env.CHANNEL_AVALIACAO,
  CHANNEL_RESULTADOS: process.env.CHANNEL_RESULTADOS,
  CHANNEL_CORREGEDORIA_RESULTS: process.env.CHANNEL_CORREGEDORIA_RESULTS || process.env.CHANNEL_DISCIPLINARY_WARNINGS,
  CHANNEL_PONTO_PANEL: process.env.CHANNEL_PONTO_PANEL,
  CHANNEL_PONTO_LOGS: process.env.CHANNEL_PONTO_LOGS,
  CHANNEL_MEMBER_LOGS: process.env.CHANNEL_MEMBER_LOGS,
  CHANNEL_DISCIPLINARY_WARNINGS: process.env.CHANNEL_DISCIPLINARY_WARNINGS || process.env.CHANNEL_CORREGEDORIA_RESULTS,
  CHANNEL_AUSENCIA_PANEL: process.env.CHANNEL_AUSENCIA_PANEL,
  CHANNEL_AUSENCIA_LOGS: process.env.CHANNEL_AUSENCIA_LOGS,
  CHANNEL_WARNING_PANEL: process.env.CHANNEL_WARNING_PANEL || '1509393954901201047',
  CHANNEL_AVALIACAO_PANEL: process.env.CHANNEL_AVALIACAO_PANEL,
  CHANNEL_AVALIACAO_LOGS: process.env.CHANNEL_AVALIACAO_LOGS,

  // Banco de dados
  MONGO_URI: process.env.MONGO_URI,

  // Cargos
  ROLE_LSPD: process.env.ROLE_LSPD,
  ROLE_COMMAND: process.env.ROLE_COMMAND,
  ROLE_SETUP: process.env.ROLE_SETUP,
  ROLE_TICKET_STAFF: process.env.ROLE_TICKET_STAFF,
  ROLE_POLICIAL: process.env.ROLE_POLICIAL || process.env.ROLE_LSPD,
  ROLE_RECRUTA: process.env.ROLE_RECRUTA,
  ROLE_ADV_VERBAL: process.env.ROLE_ADV_VERBAL,
  ROLE_ADV_1: process.env.ROLE_ADV_1,
  ROLE_ADV_2: process.env.ROLE_ADV_2,
  ROLE_ADV_3: process.env.ROLE_ADV_3,
  ROLE_ADMINISTRATIVO: process.env.ROLE_ADMINISTRATIVO,
  ROLE_PRE_APROVADO: process.env.ROLE_PRE_APROVADO,
  ROLE_CABO: process.env.ROLE_CABO,

  // Corregedoria / Advertências
  ADV_VERBAL_DAYS: process.env.ADV_VERBAL_DAYS,
  ADV_1_DAYS: process.env.ADV_1_DAYS,
  ADV_2_DAYS: process.env.ADV_2_DAYS,
  ADV_3_DAYS: process.env.ADV_3_DAYS,

  // IA / Gemini
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
  TICKET_AI_ENABLED: process.env.TICKET_AI_ENABLED,
  TICKET_AI_MAX_HISTORY: process.env.TICKET_AI_MAX_HISTORY,
  TICKET_AI_COOLDOWN_MS: process.env.TICKET_AI_COOLDOWN_MS,
  TICKET_AI_REPORT_ENABLED: process.env.TICKET_AI_REPORT_ENABLED,

  // API do Bate-Ponto (Discloud TYPE=site requer porta 8080)
  PONTO_API_PORT: process.env.PORT || process.env.PONTO_API_PORT || 8080,
  PONTO_API_KEY: process.env.PONTO_API_KEY || 'lspd_ponto_secret_token_change_me',
  PONTO_API_HOST: process.env.PONTO_API_HOST || '0.0.0.0',
};

// Validação de variáveis obrigatórias
const required = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID', 'MONGO_URI'];
const missing = required.filter((key) => !env[key]);

if (missing.length > 0) {
  console.error(`❌ Variáveis de ambiente obrigatórias não configuradas: ${missing.join(', ')}`);
  console.error('Verifique o arquivo .env e consulte o .env.example para referência.');
  process.exit(1);
}

module.exports = env;
