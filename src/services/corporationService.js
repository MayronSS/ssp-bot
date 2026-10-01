const Corporation = require('../database/models/Corporation');
const corporationsConfig = require('../config/corporations');
const logger = require('../utils/logger');

// Cache em memória (guildId → Map<slug, corpDoc>)
const cache = new Map();
const CACHE_TTL_MS = 10000;
const cacheTimestamps = new Map();

// ═══════════════════════════════════════
// CACHE
// ═══════════════════════════════════════

/**
 * Invalida o cache de uma guild.
 */
function invalidateCache(guildId) {
  cache.delete(guildId);
  cacheTimestamps.delete(guildId);
}

/**
 * Carrega todas as corporações de uma guild para o cache.
 */
async function loadCache(guildId) {
  const now = Date.now();
  if (cache.has(guildId) && now - (cacheTimestamps.get(guildId) || 0) < CACHE_TTL_MS) {
    return cache.get(guildId);
  }

  try {
    const docs = await Corporation.find({ guildId, active: true }).lean();
    const map = new Map();
    for (const doc of docs) {
      map.set(doc.slug, doc);
    }
    cache.set(guildId, map);
    cacheTimestamps.set(guildId, now);
    return map;
  } catch (error) {
    logger.error(`[CorporationService] Erro ao carregar cache para guild ${guildId}:`, error);
    return new Map();
  }
}

// ═══════════════════════════════════════
// AUTO-SEED (startup)
// ═══════════════════════════════════════

/**
 * Sincroniza as corporações do config estático com o MongoDB.
 * Chamado no evento ready (startup do bot).
 * - Cria corporações que não existem
 * - Atualiza nome/cor/emoji/ranks se mudaram no config
 * - NÃO sobrescreve roleIds/channelIds já salvos
 */
async function syncCorporations(guildId) {
  logger.info('[CorporationService] Sincronizando corporações...');

  // 1. Corporações primárias
  for (const corp of corporationsConfig.corporations) {
    await upsertCorporation(guildId, {
      slug: corp.slug,
      name: corp.name,
      shortName: corp.shortName,
      color: corp.color,
      emoji: corp.emoji,
      type: 'primary',
      inheritsFrom: null,
      ranks: corp.ranks.map(r => ({
        name: r.name,
        shortName: r.shortName,
        level: r.level,
        emoji: r.emoji,
      })),
      // Incluir subdivisões (sem roleIds, preenchidos pelo setup)
      subdivisions: corporationsConfig.tags
        .filter(t => t.inheritsFrom === corp.slug)
        .map(t => ({
          slug: t.slug,
          name: t.name,
          shortName: t.shortName,
          color: t.color,
          emoji: t.emoji,
        })),
    });
  }

  // 2. Tags de batalhão
  for (const tag of corporationsConfig.tags) {
    const resolvedRanks = corporationsConfig.getResolvedRanks(tag.slug);

    await upsertCorporation(guildId, {
      slug: tag.slug,
      name: tag.name,
      shortName: tag.shortName,
      color: tag.color,
      emoji: tag.emoji,
      type: 'tag',
      inheritsFrom: tag.inheritsFrom,
      ranks: resolvedRanks.map(r => ({
        name: r.name,
        shortName: r.shortName,
        level: r.level,
        emoji: r.emoji,
      })),
      exclusiveRanks: (tag.exclusiveRanks || []).map(r => ({
        name: r.name,
        roleName: r.roleName,
      })),
    });
  }

  // 3. Migration de dados existentes (marca registros antigos)
  await runDataMigration();

  invalidateCache(guildId);
  logger.success(`[CorporationService] ${corporationsConfig.corporations.length} corporações + ${corporationsConfig.tags.length} tags sincronizadas`);
}

/**
 * Upsert de uma corporação no MongoDB.
 * Preserva roleIds e channelIds existentes.
 */
async function upsertCorporation(guildId, data) {
  try {
    const existing = await Corporation.findOne({ guildId, slug: data.slug });

    if (existing) {
      // Atualizar campos de identidade (não sobrescrever IDs do Discord)
      existing.name = data.name;
      existing.shortName = data.shortName;
      existing.color = data.color;
      existing.emoji = data.emoji;
      existing.type = data.type;
      existing.inheritsFrom = data.inheritsFrom;

      // Atualizar ranks preservando roleIds existentes
      const updatedRanks = data.ranks.map(newRank => {
        const existingRank = existing.ranks.find(r => r.name === newRank.name);
        return {
          ...newRank,
          roleId: existingRank ? existingRank.roleId : null,
        };
      });
      existing.ranks = updatedRanks;

      // Atualizar subdivisões preservando roleIds existentes
      if (data.subdivisions) {
        const updatedSubs = data.subdivisions.map(newSub => {
          const existingSub = existing.subdivisions.find(s => s.slug === newSub.slug);
          return {
            ...newSub,
            roleId: existingSub ? existingSub.roleId : null,
          };
        });
        existing.subdivisions = updatedSubs;
      }

      // Atualizar patentes exclusivas preservando roleIds
      if (data.exclusiveRanks) {
        const updatedExcl = data.exclusiveRanks.map(newExcl => {
          const existingExcl = existing.exclusiveRanks.find(e => e.name === newExcl.name);
          return {
            ...newExcl,
            roleId: existingExcl ? existingExcl.roleId : null,
          };
        });
        existing.exclusiveRanks = updatedExcl;
      }

      await existing.save();
    } else {
      // Criar nova
      await Corporation.create({
        guildId,
        ...data,
      });
      logger.info(`[CorporationService] Corporação criada: ${data.shortName} (${data.slug})`);
    }
  } catch (error) {
    // Ignorar erro de duplicata (race condition)
    if (error.code === 11000) {
      logger.warn(`[CorporationService] Corporação ${data.slug} já existe, ignorando duplicata`);
    } else {
      logger.error(`[CorporationService] Erro ao upsert corporação ${data.slug}:`, error);
    }
  }
}

/**
 * Migration automática: marca registros antigos sem corporationSlug como 'pmesp'.
 */
async function runDataMigration() {
  const mongoose = require('mongoose');
  const collections = ['pontos', 'tickets', 'lspdcandidaturas', 'lspdausencias', 'disciplinarywarnings', 'corrgedoriacases'];

  for (const collName of collections) {
    try {
      const collection = mongoose.connection.collection(collName);
      const result = await collection.updateMany(
        { corporationSlug: { $exists: false } },
        { $set: { corporationSlug: 'pmesp' } }
      );
      if (result.modifiedCount > 0) {
        logger.info(`[Migration] ${collName}: ${result.modifiedCount} registros atualizados com corporationSlug='pmesp'`);
      }
    } catch (error) {
      // Coleção pode não existir ainda, ignorar
    }
  }
}

// ═══════════════════════════════════════
// FUNÇÕES DE BUSCA
// ═══════════════════════════════════════

/**
 * Busca uma corporação pelo slug.
 */
async function getBySlug(guildId, slug) {
  const map = await loadCache(guildId);
  return map.get(slug) || null;
}

/**
 * Identifica a corporação a partir de um channelId.
 * Verifica em quais canais da corporação o channelId está configurado.
 */
async function getByChannel(guildId, channelId) {
  if (!channelId) return null;
  const map = await loadCache(guildId);

  for (const [, corp] of map) {
    if (corp.type !== 'primary') continue;
    const channels = corp.channels || {};
    for (const val of Object.values(channels)) {
      if (val === channelId) return corp;
    }
  }
  return null;
}

/**
 * Identifica a corporação primária de um membro pelo cargo geral.
 * Retorna a primeira corporação cujo cargo 'geral' o membro possui.
 */
async function getByMemberRoles(member) {
  if (!member) return null;
  const map = await loadCache(member.guild.id);

  for (const [, corp] of map) {
    if (corp.type !== 'primary') continue;
    if (corp.roles && corp.roles.geral && member.roles.cache.has(corp.roles.geral)) {
      return corp;
    }
  }
  return null;
}

/**
 * Identifica as tags de um membro (FT, ROTA, BAEP, BPRV).
 */
async function getMemberTags(member) {
  if (!member) return [];
  const map = await loadCache(member.guild.id);
  const tags = [];

  for (const [, corp] of map) {
    if (corp.type !== 'tag') continue;
    if (corp.roles && corp.roles.geral && member.roles.cache.has(corp.roles.geral)) {
      tags.push(corp);
    }
  }
  return tags;
}

/**
 * Lista apenas corporações primárias (PMESP, PCESP).
 */
async function listPrimary(guildId) {
  const map = await loadCache(guildId);
  return Array.from(map.values()).filter(c => c.type === 'primary');
}

/**
 * Lista todas as corporações e tags.
 */
async function listAll(guildId) {
  const map = await loadCache(guildId);
  return Array.from(map.values());
}

/**
 * Lista as tags de uma corporação primária.
 */
async function listTags(guildId, parentSlug) {
  const map = await loadCache(guildId);
  return Array.from(map.values()).filter(
    c => c.type === 'tag' && c.inheritsFrom === parentSlug
  );
}

/**
 * Retorna o ID de um canal específico de uma corporação.
 * Para tags, busca os canais da corporação-mãe.
 */
async function getChannel(guildId, slug, channelKey) {
  const map = await loadCache(guildId);
  let corp = map.get(slug);

  // Se for tag, buscar na corp-mãe
  if (corp && corp.type === 'tag' && corp.inheritsFrom) {
    corp = map.get(corp.inheritsFrom);
  }

  if (!corp || !corp.channels) return null;
  return corp.channels[channelKey] || null;
}

/**
 * Retorna o ID de um cargo específico de uma corporação.
 * Para tags, busca os cargos da corporação-mãe (exceto 'geral' que é o cargo-tag).
 */
async function getRole(guildId, slug, roleKey) {
  const map = await loadCache(guildId);
  const corp = map.get(slug);
  if (!corp || !corp.roles) return null;

  // Para tags, o cargo 'geral' é o cargo-tag próprio
  if (roleKey === 'geral') {
    return corp.roles.geral || null;
  }

  // Para outros cargos, tags herdam da corp-mãe
  if (corp.type === 'tag' && corp.inheritsFrom) {
    const parent = map.get(corp.inheritsFrom);
    if (parent && parent.roles) {
      return parent.roles[roleKey] || null;
    }
  }

  return corp.roles[roleKey] || null;
}

/**
 * Retorna as patentes com roleIds de uma corporação (resolvidas do banco).
 */
async function getRanks(guildId, slug) {
  const corp = await getBySlug(guildId, slug);
  if (!corp) return [];
  return corp.ranks || [];
}

/**
 * Retorna o config estático de uma corporação (do corporations.js).
 */
function getStaticConfig(slug) {
  const corp = corporationsConfig.corporations.find(c => c.slug === slug);
  if (corp) return corp;

  const tag = corporationsConfig.tags.find(t => t.slug === slug);
  if (tag) return tag;

  return null;
}

/**
 * Retorna os textos de embed de uma corporação.
 * Para tags, retorna os textos da corporação-mãe.
 */
function getEmbedTexts(slug) {
  const staticConfig = getStaticConfig(slug);
  if (!staticConfig) return null;

  // Se tem embedTexts próprio
  if (staticConfig.embedTexts) return staticConfig.embedTexts;

  // Se é tag, pegar da corp-mãe
  if (staticConfig.inheritsFrom) {
    const parent = corporationsConfig.corporations.find(c => c.slug === staticConfig.inheritsFrom);
    if (parent) return parent.embedTexts;
  }

  return null;
}

/**
 * Resolve um slug para o slug da corporação primária.
 * Ex: 'rota' → 'pmesp', 'pmesp' → 'pmesp'
 */
function resolvePrimarySlug(slug) {
  const corp = corporationsConfig.corporations.find(c => c.slug === slug);
  if (corp) return corp.slug;

  const tag = corporationsConfig.tags.find(t => t.slug === slug);
  if (tag) return tag.inheritsFrom;

  return slug;
}

/**
 * Atualiza os IDs de cargos de uma corporação no banco de dados.
 */
async function updateRoles(guildId, slug, rolesMap) {
  try {
    await Corporation.updateOne(
      { guildId, slug },
      { $set: { roles: rolesMap } }
    );
    invalidateCache(guildId);
  } catch (error) {
    logger.error(`[CorporationService] Erro ao atualizar cargos de ${slug}:`, error);
  }
}

/**
 * Atualiza os roleIds das patentes de uma corporação no banco de dados.
 */
async function updateRanks(guildId, slug, ranksArray) {
  try {
    await Corporation.updateOne(
      { guildId, slug },
      { $set: { ranks: ranksArray } }
    );
    invalidateCache(guildId);
  } catch (error) {
    logger.error(`[CorporationService] Erro ao atualizar patentes de ${slug}:`, error);
  }
}

/**
 * Atualiza os IDs de canais de uma corporação no banco de dados.
 */
async function updateChannels(guildId, slug, channelsMap) {
  try {
    await Corporation.updateOne(
      { guildId, slug },
      { $set: { channels: channelsMap } }
    );
    invalidateCache(guildId);
  } catch (error) {
    logger.error(`[CorporationService] Erro ao atualizar canais de ${slug}:`, error);
  }
}

/**
 * Atualiza o roleId de uma subdivisão.
 */
async function updateSubdivisionRole(guildId, parentSlug, tagSlug, roleId) {
  try {
    await Corporation.updateOne(
      { guildId, slug: parentSlug, 'subdivisions.slug': tagSlug },
      { $set: { 'subdivisions.$.roleId': roleId } }
    );
    invalidateCache(guildId);
  } catch (error) {
    logger.error(`[CorporationService] Erro ao atualizar subdivisão ${tagSlug}:`, error);
  }
}

/**
 * Atualiza o roleId do cargo-tag de uma tag.
 */
async function updateTagRole(guildId, tagSlug, roleId) {
  try {
    await Corporation.updateOne(
      { guildId, slug: tagSlug },
      { $set: { 'roles.geral': roleId } }
    );
    invalidateCache(guildId);
  } catch (error) {
    logger.error(`[CorporationService] Erro ao atualizar cargo-tag ${tagSlug}:`, error);
  }
}

/**
 * Atualiza o roleId de uma patente exclusiva.
 */
async function updateExclusiveRankRole(guildId, tagSlug, rankName, roleId) {
  try {
    await Corporation.updateOne(
      { guildId, slug: tagSlug, 'exclusiveRanks.name': rankName },
      { $set: { 'exclusiveRanks.$.roleId': roleId } }
    );
    invalidateCache(guildId);
  } catch (error) {
    logger.error(`[CorporationService] Erro ao atualizar patente exclusiva ${rankName}:`, error);
  }
}

module.exports = {
  // Lifecycle
  syncCorporations,
  invalidateCache,

  // Busca
  getBySlug,
  getByChannel,
  getByMemberRoles,
  getMemberTags,
  listPrimary,
  listAll,
  listTags,
  getChannel,
  getRole,
  getRanks,

  // Config estático
  getStaticConfig,
  getEmbedTexts,
  resolvePrimarySlug,

  // Updates
  updateRoles,
  updateRanks,
  updateChannels,
  updateSubdivisionRole,
  updateTagRole,
  updateExclusiveRankRole,
};
