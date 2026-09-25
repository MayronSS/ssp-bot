const { ChannelType, PermissionFlagsBits } = require('discord.js');
const logger = require('./logger');
const configService = require('../services/configService');

/**
 * Verifica se uma string é um ID/snowflake válido do Discord.
 */
function isValidSnowflake(id) {
  return typeof id === 'string' && /^\d{17,20}$/.test(id);
}

/**
 * Resolve um cargo no servidor.
 * Tenta buscar pelo ID informado. Se não encontrar, busca pelo nome (case-insensitive).
 * Se ainda assim não existir, tenta criar o cargo automaticamente.
 */
async function resolveRole(guild, idOrKey, nameFallback, alternateNames = []) {
  let id = idOrKey;
  if (!isValidSnowflake(idOrKey)) {
    id = await configService.getRole(guild.id, idOrKey);
  }

  if (isValidSnowflake(id)) {
    const role = guild.roles.cache.get(id);
    if (role) return role;
  }

  const searchNames = [nameFallback.toLowerCase(), ...alternateNames.map(n => n.toLowerCase())];
  const foundRole = guild.roles.cache.find(r => searchNames.includes(r.name.toLowerCase()));
  if (foundRole) return foundRole;

  try {
    const newRole = await guild.roles.create({
      name: nameFallback,
      reason: 'Auto-discovery: cargo não configurado ou inexistente, criado automaticamente',
    });
    logger.success(`Cargo auto-criado: "${nameFallback}"`);
    return newRole;
  } catch (error) {
    logger.error(`Erro ao auto-criar cargo "${nameFallback}":`, error);
    return null;
  }
}

/**
 * Resolve uma categoria no servidor.
 * Tenta buscar pelo ID. Se não encontrar, busca pelo nome (case-insensitive).
 * Se não existir, cria a categoria.
 */
async function resolveCategory(guild, idOrKey, nameFallback) {
  let id = idOrKey;
  if (!isValidSnowflake(idOrKey)) {
    id = await configService.getChannel(guild.id, idOrKey);
  }

  if (isValidSnowflake(id)) {
    const cat = guild.channels.cache.get(id);
    if (cat && cat.type === ChannelType.GuildCategory) return cat;
  }

  const foundCat = guild.channels.cache.find(
    c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === nameFallback.toLowerCase()
  );
  if (foundCat) return foundCat;

  try {
    const newCat = await guild.channels.create({
      name: nameFallback,
      type: ChannelType.GuildCategory,
      reason: 'Auto-discovery: categoria não configurada ou inexistente, criada automaticamente',
    });
    logger.success(`Categoria auto-criada: "${nameFallback}"`);
    return newCat;
  } catch (error) {
    logger.error(`Erro ao auto-criar categoria "${nameFallback}":`, error);
    return null;
  }
}

/**
 * Resolve um canal de texto ou voz no servidor.
 * Tenta buscar pelo ID. Se não encontrar, busca pelo nome formatado/normal.
 * Se não existir e autoCreate=true, cria o canal DENTRO da categoria correta.
 * Se autoCreate=false, retorna null sem criar.
 *
 * @param {Guild} guild
 * @param {string} idOrKey - ID do canal ou chave do configService
 * @param {string} nameFallback - Nome para busca/criação
 * @param {Object} [options={}] - Opções adicionais de busca e criação
 * @param {ChannelType} [options.type=ChannelType.GuildText] - Tipo de canal
 * @param {boolean} [options.autoCreate=false] - Se deve criar se não existir (default: false por segurança)
 * @param {Object} [options.channelOptions={}] - Opções extras passadas para channels.create
 */
async function resolveChannel(guild, idOrKey, nameFallback, options = {}) {
  const {
    type = ChannelType.GuildText,
    autoCreate = false,
    channelOptions = {}
  } = options;

  let id = idOrKey;
  if (!isValidSnowflake(idOrKey)) {
    id = await configService.getChannel(guild.id, idOrKey);
  }

  if (isValidSnowflake(id)) {
    const chan = guild.channels.cache.get(id);
    if (chan && chan.type === type) return chan;
  }

  // Discord formata nomes de canais de texto em minúsculo e substitui espaços por traços
  const formattedName = nameFallback.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove acentos
    .replace(/[^a-z0-9-]/g, '-')     // Caracteres especiais viram traço
    .replace(/-+/g, '-')             // Remove múltiplos traços seguidos
    .replace(/^-|-$/g, '');          // Limpa traços no início/fim

  const rawLower = nameFallback.toLowerCase();

  // Busca por: nome exato, nome formatado, ou nome parcial (para suportar 📄・ prefix)
  let foundChan = guild.channels.cache.find(
    c => c.type === type && (
      c.name.toLowerCase() === formattedName ||
      c.name.toLowerCase() === rawLower ||
      c.name === nameFallback ||
      c.name.toLowerCase().endsWith(rawLower) ||
      c.name.toLowerCase().includes(rawLower)
    )
  );
  if (foundChan) return foundChan;

  // Se autoCreate está desabilitado, retorna null sem criar
  if (!autoCreate) return null;

  // Auto-criar: resolver a categoria correta antes de criar o canal
  try {
    const parentCategory = await resolveParentCategory(guild, nameFallback);

    const mergedOptions = {
      name: nameFallback,
      type,
      reason: 'Auto-discovery: canal não configurado ou inexistente, criado automaticamente',
      ...(parentCategory ? { parent: parentCategory.id } : {}),
      ...channelOptions,
    };
    const newChan = await guild.channels.create(mergedOptions);
    logger.success(`Canal auto-criado: "${nameFallback}"${parentCategory ? ` em ${parentCategory.name}` : ''}`);
    return newChan;
  } catch (error) {
    logger.error(`Erro ao auto-criar canal "${nameFallback}":`, error);
    return null;
  }
}

/**
 * Resolve a categoria-pai correta para um canal usando o mapa de corporations.js.
 * Ex: '📄・painel-ponto' → categoria '📄・OPERACIONAL SSP'
 */
async function resolveParentCategory(guild, channelName) {
  try {
    const corporationsConfig = require('../config/corporations');

    // Buscar nos canais compartilhados (todos os canais são SSP unificado)
    for (const group of Object.values(corporationsConfig.sharedChannelTemplate)) {
      for (const chan of group.channels) {
        if (chan.name.toLowerCase() === channelName.toLowerCase() ||
            channelName.toLowerCase().includes(chan.name.replace('📄・', '').toLowerCase())) {
          // Encontrar ou criar a categoria
          let cat = guild.channels.cache.find(
            c => c.type === ChannelType.GuildCategory &&
                 c.name.toLowerCase() === group.category.toLowerCase()
          );
          if (!cat) {
            cat = await guild.channels.create({
              name: group.category,
              type: ChannelType.GuildCategory,
              reason: 'Auto-discovery: categoria criada automaticamente',
            });
            logger.success(`Categoria auto-criada: "${group.category}"`);
          }
          return cat;
        }
      }
    }
  } catch (err) {
    logger.warn('Não foi possível resolver categoria-pai:', err.message);
  }

  return null;
}

module.exports = {
  isValidSnowflake,
  resolveRole,
  resolveCategory,
  resolveChannel,
};

