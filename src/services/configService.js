const GuildConfig = require('../database/models/GuildConfig');
const env = require('../config/env');
const embedsConfig = require('../config/embeds');

const cachedConfigs = new Map();

/**
 * Obtém ou carrega a configuração da guilda do banco de dados para a memória cache.
 */
async function getOrLoadConfig(guildId) {
  if (!guildId) return null;
  const now = Date.now();
  if (cachedConfigs.has(guildId)) {
    const entry = cachedConfigs.get(guildId);
    if (now - entry.timestamp < 10000) {
      return entry.config;
    }
  }

  try {
    let config = await GuildConfig.findOne({ guildId });
    if (!config) {
      config = await GuildConfig.create({ guildId });
    }
    const configObj = config.toObject();
    cachedConfigs.set(guildId, { config: configObj, timestamp: now });
    return configObj;
  } catch (error) {
    console.error(`[ConfigService] Erro ao carregar GuildConfig para a guilda ${guildId}:`, error);
    return null;
  }
}

/**
 * Invalida o cache e força o recarregamento das configurações.
 */
async function reloadConfig(guildId) {
  if (!guildId) return;
  cachedConfigs.delete(guildId);
  await getOrLoadConfig(guildId);
}

/**
 * Obtém ID do canal dinâmico com fallback para as variáveis de ambiente.
 */
async function getChannel(guildId, key) {
  const config = await getOrLoadConfig(guildId);
  if (config && config.channels && config.channels[key]) {
    return config.channels[key];
  }

  const fallbackMap = {
    ticketsPanel: env.CHANNEL_TICKETS_PANEL,
    ticketsCategory: env.CATEGORY_TICKETS,
    editalCategory: env.CATEGORY_EDITAL || '1523484704295096450',
    corregedoriaCategory: env.CATEGORY_CORREGEDORIA,
    corregedoriaResults: env.CHANNEL_CORREGEDORIA_RESULTS,
    editalPanel: env.CHANNEL_EDITAL_PANEL,
    editalAvaliacao: env.CHANNEL_AVALIACAO,
    editalResultados: env.CHANNEL_RESULTADOS,
    editalAvaliacaoPmesp: env.CHANNEL_AVALIACAO_PMESP || '1510831165341433917',
    editalAvaliacaoPcesp: env.CHANNEL_AVALIACAO_PCESP || '1510831166889136228',
    editalResultadosPmesp: env.CHANNEL_RESULTADOS_PMESP || '1510831168151490681',
    editalResultadosPcesp: env.CHANNEL_RESULTADOS_PCESP || '1510831169237815421',
    pontoPanel: env.CHANNEL_PONTO_PANEL,
    pontoLogs: env.CHANNEL_PONTO_LOGS,
    copomLogs: env.CHANNEL_PONTO_LOGS, // Copom fallback para logs de ponto
    adminLogs: env.CHANNEL_ADMIN_LOGS,
    memberLogs: env.CHANNEL_MEMBER_LOGS,
    disciplinaryWarnings: env.CHANNEL_DISCIPLINARY_WARNINGS || env.CHANNEL_CORREGEDORIA_RESULTS,
    ausenciaPanel: env.CHANNEL_AUSENCIA_PANEL,
    ausenciaLogs: env.CHANNEL_AUSENCIA_LOGS,
    warningPanel: env.CHANNEL_WARNING_PANEL,
    avaliacaoPanel: env.CHANNEL_AVALIACAO_PANEL,
    avaliacaoLogs: env.CHANNEL_AVALIACAO_LOGS,
  };

  return fallbackMap[key] || null;
}

/**
 * Obtém ID do cargo dinâmico com fallback para as variáveis de ambiente.
 */
async function getRole(guildId, key) {
  const config = await getOrLoadConfig(guildId);
  if (config && config.roles && config.roles[key]) {
    return config.roles[key];
  }

  const fallbackMap = {
    lspdGeral: env.ROLE_LSPD,
    comandoAdmin: env.ROLE_COMMAND,
    ticketStaff: env.ROLE_TICKET_STAFF,
    policial: env.ROLE_POLICIAL,
    setupAuthorized: env.ROLE_SETUP,
    recrutaCadete: env.ROLE_RECRUTA,
    advVerbal: env.ROLE_ADV_VERBAL,
    adv1: env.ROLE_ADV_1,
    adv2: env.ROLE_ADV_2,
    adv3: env.ROLE_ADV_3,
    administrativo: env.ROLE_ADMINISTRATIVO,
    preAprovado: env.ROLE_PRE_APROVADO,
    caboRole: env.ROLE_CABO,
  };

  return fallbackMap[key] || null;
}

/**
 * Verifica se um módulo específico está ativado.
 */
async function isModuleEnabled(guildId, key) {
  const config = await getOrLoadConfig(guildId);
  if (config && config.modules && typeof config.modules[key] === 'boolean') {
    return config.modules[key];
  }
  return true;
}

/**
 * Retorna as configurações de design (cores e logo) atualizadas com valores customizados do banco.
 */
async function getDesign(guildId) {
  const config = await getOrLoadConfig(guildId);
  const design = JSON.parse(JSON.stringify(embedsConfig.design));

  if (config && config.embeds && config.embeds.design) {
    const customDesign = config.embeds.design;
    if (customDesign.colors) {
      for (const [colorKey, colorVal] of Object.entries(customDesign.colors)) {
        if (colorVal) {
          design.colors[colorKey] = colorVal;
        }
      }
    }
    if (customDesign.logo) {
      design.logo = customDesign.logo;
    }
  }

  return design;
}

/**
 * Retorna a configuração de embed de um módulo específico mesclada com a estática.
 */
async function getEmbedConfig(guildId, moduleKey) {
  const config = await getOrLoadConfig(guildId);
  const design = await getDesign(guildId);

  const fallbackModule = embedsConfig[moduleKey] || {};
  const fallbackPanel = fallbackModule.panel || {};

  const panel = {
    color: design.colors?.primary || fallbackPanel.color,
    author: {
      name: fallbackPanel.author?.name || '',
      iconURL: design.logo || fallbackPanel.author?.iconURL || ''
    },
    title: fallbackPanel.title || '',
    description: fallbackPanel.description || '',
    thumbnail: design.logo || fallbackPanel.thumbnail || '',
    image: fallbackPanel.image || '',
    footer: {
      text: fallbackPanel.footer?.text || '',
      iconURL: design.logo || fallbackPanel.footer?.iconURL || ''
    }
  };

  // Se houver config customizada no banco
  if (config && config.embeds && config.embeds[moduleKey] && config.embeds[moduleKey].panel) {
    const customPanel = config.embeds[moduleKey].panel;
    if (customPanel.title) {
      panel.title = customPanel.title;
    }
    if (customPanel.description) {
      panel.description = customPanel.description;
    }
    if (customPanel.banner) {
      panel.image = customPanel.banner;
    }
  }

  return panel;
}

module.exports = {
  getOrLoadConfig,
  reloadConfig,
  getChannel,
  getRole,
  isModuleEnabled,
  getDesign,
  getEmbedConfig,
};
