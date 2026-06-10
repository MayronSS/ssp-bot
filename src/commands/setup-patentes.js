const { SlashCommandBuilder } = require('discord.js');
const { canSetupPanels } = require('../services/permissionService');
const logService = require('../services/logService');
const { createErrorEmbed, createSuccessEmbed } = require('../utils/createEmbed');
const logger = require('../utils/logger');
const { EPHEMERAL_REPLY } = require('../utils/interactionOptions');
const corporationService = require('../services/corporationService');
const corporationsConfig = require('../config/corporations');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-patentes')
    .setDescription('Cria ou corrige as patentes de todas as corporações e cargos do sistema no Discord'),

  async execute(interaction) {
    if (!await canSetupPanels(interaction.member)) {
      return interaction.reply({
        embeds: [createErrorEmbed('Sem Permissão', 'Você não possui autorização para executar este comando.')],
        ...EPHEMERAL_REPLY,
      });
    }

    await interaction.deferReply(EPHEMERAL_REPLY);

    try {
      await interaction.guild.roles.fetch();
    } catch (fetchErr) {
      logger.error('Erro ao buscar cargos do Discord:', fetchErr);
    }

    const created = [];
    const updated = [];
    const skipped = [];
    const errors = [];
    const guild = interaction.guild;
    const guildId = guild.id;

    // Coletar todos os cargos criados para ordenar no final
    const roleOrder = []; // { role, priority } — priority menor = posição mais alta no Discord

    let priority = 0;

    try {
      // ════════════════════════════════════════
      // 0. SEPARADOR: SISTEMA
      // ════════════════════════════════════════
      const systemSep = corporationsConfig.separatorRoles.find(s => s.block === 'shared');
      if (systemSep) {
        const sepResult = await ensureSeparatorRole(guild, systemSep.name, systemSep.color);
        pushResult(sepResult, systemSep.name, created, updated, skipped, errors);
        if (sepResult.role) roleOrder.push({ role: sepResult.role, priority: priority++ });
      }

      // ════════════════════════════════════════
      // 1. CARGOS COMPARTILHADOS (globais)
      // ════════════════════════════════════════
      const globalRoleIds = {};
      for (const shared of corporationsConfig.sharedRoles) {
        const result = await ensureRole(guild, shared.name, shared.color, { hoist: false, mentionable: false });
        pushResult(result, shared.name, created, updated, skipped, errors);
        if (result.role) {
          roleOrder.push({ role: result.role, priority: priority++ });
          if (shared.key) {
            globalRoleIds[shared.key] = result.role.id;
          }
        }
      }

      // ════════════════════════════════════════
      // 2. CORPORAÇÕES PRIMÁRIAS (PMESP, PCESP)
      // ════════════════════════════════════════
      for (const corpConfig of corporationsConfig.corporations) {
        // Separador visual da corporação
        const corpSep = corporationsConfig.separatorRoles.find(s => s.block === corpConfig.slug);
        if (corpSep) {
          const sepResult = await ensureSeparatorRole(guild, corpSep.name, corpSep.color);
          pushResult(sepResult, corpSep.name, created, updated, skipped, errors);
          if (sepResult.role) roleOrder.push({ role: sepResult.role, priority: priority++ });
        }

        const corpDoc = await corporationService.getBySlug(guildId, corpConfig.slug);
        if (!corpDoc) continue;

        const roleIds = { ...(corpDoc.roles || {}) };
        if (globalRoleIds.cidadao) {
          roleIds.cidadao = globalRoleIds.cidadao;
        }
        const ranksWithIds = [...(corpDoc.ranks || [])];

        // --- Cargo geral (ex: 🛡️ ┃ PMESP) ---
        const geralResult = await ensureRole(guild, corpConfig.systemRoles.geral, corpConfig.color, { hoist: true, mentionable: true });
        pushResult(geralResult, corpConfig.systemRoles.geral, created, updated, skipped, errors);
        if (geralResult.role) {
          roleIds.geral = geralResult.role.id;
          roleOrder.push({ role: geralResult.role, priority: priority++ });
        }

        // --- Cargos de sistema (comando, staff) ---
        const topSystemKeys = ['comando', 'staff'];
        const systemRoleColors = {
          comando: '#ffd700',
          staff: '#3498db',
        };
        for (const key of topSystemKeys) {
          if (!corpConfig.systemRoles[key]) continue;
          const roleName = corpConfig.systemRoles[key];
          const color = systemRoleColors[key] || corpConfig.color;
          const result = await ensureRole(guild, roleName, color, { hoist: true, mentionable: true });
          pushResult(result, roleName, created, updated, skipped, errors);
          if (result.role) {
            roleIds[key] = result.role.id;
            roleOrder.push({ role: result.role, priority: priority++ });
          }
        }

        // --- Patentes (MAIS ALTA → MAIS BAIXA) ---
        const ranksHighToLow = [...corpConfig.ranks].sort((a, b) => b.level - a.level);
        for (const rank of ranksHighToLow) {
          const roleEmoji = (rank.emoji && !rank.emoji.includes(':')) ? rank.emoji : '👮';
          const roleName = `${roleEmoji} ┃ ${rank.name}`;
          const result = await ensureRole(guild, roleName, corpConfig.color, { hoist: true, mentionable: true });
          pushResult(result, roleName, created, updated, skipped, errors);

          if (result.role) {
            roleOrder.push({ role: result.role, priority: priority++ });
          }

          const rankIdx = ranksWithIds.findIndex(r => r.name === rank.name);
          if (rankIdx !== -1 && result.role) {
            ranksWithIds[rankIdx] = { ...ranksWithIds[rankIdx], roleId: result.role.id };
          }
        }

        // --- Cargos administrativos (abaixo das patentes) ---
        const bottomSystemKeys = ['administrativo', 'ministrador', 'preAprovado'];
        const bottomColors = {
          administrativo: '#9b59b6',
          ministrador: '#1abc9c',
          preAprovado: '#f39c12',
        };
        for (const key of bottomSystemKeys) {
          if (!corpConfig.systemRoles[key]) continue;
          const roleName = corpConfig.systemRoles[key];
          const color = bottomColors[key] || corpConfig.color;
          const isHoist = key === 'administrativo' || key === 'ministrador';
          const result = await ensureRole(guild, roleName, color, { hoist: isHoist, mentionable: true });
          pushResult(result, roleName, created, updated, skipped, errors);
          if (result.role) {
            roleIds[key] = result.role.id;
            roleOrder.push({ role: result.role, priority: priority++ });
          }
        }

        // --- Separador de ADV ---
        const advSep = corporationsConfig.separatorRoles.find(s => s.block === `adv_${corpConfig.slug}`);
        if (advSep) {
          const sepResult = await ensureSeparatorRole(guild, advSep.name, advSep.color);
          pushResult(sepResult, advSep.name, created, updated, skipped, errors);
          if (sepResult.role) roleOrder.push({ role: sepResult.role, priority: priority++ });
        }

        // --- Cargos de advertência (ABAIXO do separador de ADV) ---
        const advKeys = ['advVerbal', 'adv1', 'adv2', 'adv3'];
        const advColors = { advVerbal: '#f1c40f', adv1: '#e67e22', adv2: '#e74c3c', adv3: '#992d22' };
        for (const key of advKeys) {
          if (!corpConfig.systemRoles[key]) continue;
          const roleName = corpConfig.systemRoles[key];
          const color = advColors[key] || '#e74c3c';
          const result = await ensureRole(guild, roleName, color, { hoist: false, mentionable: true });
          pushResult(result, roleName, created, updated, skipped, errors);
          if (result.role) {
            roleIds[key] = result.role.id;
            roleOrder.push({ role: result.role, priority: priority++ });
          }
        }

        // Salvar no banco
        await corporationService.updateRoles(guildId, corpConfig.slug, roleIds);
        await corporationService.updateRanks(guildId, corpConfig.slug, ranksWithIds);

        const lowestRank = ranksWithIds.find(r => r.level === 0);
        if (lowestRank && lowestRank.roleId) {
          roleIds.recruta = lowestRank.roleId;
          await corporationService.updateRoles(guildId, corpConfig.slug, roleIds);
        }
      }

      // ════════════════════════════════════════
      // 3. TAGS DE BATALHÃO (FT, ROTA, BAEP, BPRV)
      // ════════════════════════════════════════
      const tagsSep = corporationsConfig.separatorRoles.find(s => s.block === 'tags');
      if (tagsSep) {
        const sepResult = await ensureSeparatorRole(guild, tagsSep.name, tagsSep.color);
        pushResult(sepResult, tagsSep.name, created, updated, skipped, errors);
        if (sepResult.role) roleOrder.push({ role: sepResult.role, priority: priority++ });
      }

      for (const tagConfig of corporationsConfig.tags) {
        const tagResult = await ensureRole(guild, tagConfig.tagRole, tagConfig.color, { hoist: true, mentionable: true });
        pushResult(tagResult, tagConfig.tagRole, created, updated, skipped, errors);
        if (tagResult.role) {
          roleOrder.push({ role: tagResult.role, priority: priority++ });
          await corporationService.updateTagRole(guildId, tagConfig.slug, tagResult.role.id);
          await corporationService.updateSubdivisionRole(
            guildId, tagConfig.inheritsFrom, tagConfig.slug, tagResult.role.id
          );
        }

        if (tagConfig.exclusiveRanks) {
          for (const exclusiveRank of tagConfig.exclusiveRanks) {
            const exclResult = await ensureRole(
              guild,
              exclusiveRank.roleName,
              exclusiveRank.color || tagConfig.color,
              { hoist: true, mentionable: true }
            );
            pushResult(exclResult, exclusiveRank.roleName, created, updated, skipped, errors);
            if (exclResult.role) {
              roleOrder.push({ role: exclResult.role, priority: priority++ });
              await corporationService.updateExclusiveRankRole(
                guildId, tagConfig.slug, exclusiveRank.name, exclResult.role.id
              );
            }
          }
        }
      }

      // ════════════════════════════════════════
      // 3.5 CURSOS DE FORMAÇÃO (PMESP)
      // ════════════════════════════════════════
      for (const corpConfig of corporationsConfig.corporations) {
        if (!corpConfig.courses || corpConfig.courses.length === 0) continue;

        const courseSep = corporationsConfig.separatorRoles.find(s => s.block === `courses_${corpConfig.slug}`);
        if (courseSep) {
          const sepResult = await ensureSeparatorRole(guild, courseSep.name, courseSep.color);
          pushResult(sepResult, courseSep.name, created, updated, skipped, errors);
          if (sepResult.role) roleOrder.push({ role: sepResult.role, priority: priority++ });
        }

        for (const course of corpConfig.courses) {
          const result = await ensureRole(guild, course.roleName, course.color, { hoist: false, mentionable: true });
          pushResult(result, course.roleName, created, updated, skipped, errors);
          if (result.role) {
            roleOrder.push({ role: result.role, priority: priority++ });
          }
        }
      }

      // ════════════════════════════════════════
      // 4. ORDENAR CARGOS NO DISCORD
      // ════════════════════════════════════════
      try {
        await reorderRoles(guild, roleOrder);
      } catch (err) {
        logger.warn('Aviso: Não foi possível reordenar cargos:', err);
        errors.push(`Reordenação: ${err.message || err}`);
      }

      // ════════════════════════════════════════
      // 5. COMPATIBILIDADE: Atualizar GuildConfig antigo
      // ════════════════════════════════════════
      try {
        await syncGuildConfigFromCorporations(guild);
      } catch (err) {
        logger.warn('Aviso: Não foi possível sincronizar GuildConfig legado:', err.message);
      }

      corporationService.invalidateCache(guildId);

      // ════════════════════════════════════════
      // 6. RESPOSTA
      // ════════════════════════════════════════
      let summary = '';

      if (created.length > 0) {
        summary += `✅ **Cargos criados (${created.length}):**\n${created.map(name => `• ${name}`).join('\n')}\n\n`;
      }
      if (updated.length > 0) {
        summary += `⚙️ **Cargos corrigidos (${updated.length}):**\n${updated.join('\n')}\n\n`;
      }
      if (skipped.length > 0) {
        summary += `ℹ️ **Já estavam corretos (${skipped.length}):**\n${skipped.map(name => `• ${name}`).join('\n')}\n\n`;
      }
      if (errors.length > 0) {
        summary += `❌ **Erros (${errors.length}):**\n${errors.map(err => `• ${err}`).join('\n')}\n\n`;
      }

      summary += `💾 **IDs salvos no banco de dados para todas as corporações.**`;

      await interaction.editReply({
        embeds: [createSuccessEmbed('Setup de Patentes SSP', summary || 'Nenhum cargo precisou ser criado.')],
      });

      try {
        await logService.logSetupExecuted(interaction.client, {
          userId: interaction.user.id,
          module: 'patentes-ssp',
        });
      } catch (logErr) {
        // ignore
      }
    } catch (error) {
      logger.error('Erro ao executar setup de patentes:', error);
      await interaction.editReply({
        embeds: [createErrorEmbed('Erro no Processo', `Ocorreu um erro crítico: ${error.message}`)],
      });
    }
  },
};

// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════

async function ensureSeparatorRole(guild, name, color) {
  try {
    const exact = guild.roles.cache.find(r => r.name === name);
    if (exact) {
      if (exact.color !== parseInt(color.replace('#', ''), 16)) {
        await exact.edit({ color, permissions: 0n, mentionable: false, hoist: false });
        return { status: 'updated', role: exact, oldName: exact.name };
      }
      return { status: 'skipped', role: exact };
    }

    // Procurar versão antiga do separador
    const coreMatch = name.match(/[⚙️🛡️⚡⚠️]\s*(.+?)\s*─/u);
    const coreText = coreMatch ? coreMatch[1].trim().toUpperCase() : null;
    const existing = coreText ? guild.roles.cache.find(r => {
      return r.name.includes('─') && r.name.toUpperCase().includes(coreText);
    }) : null;

    if (existing) {
      const oldName = existing.name;
      await existing.edit({
        name,
        color,
        permissions: 0n,
        mentionable: false,
        hoist: false,
        reason: 'Setup automático — separador visual atualizado.',
      });
      return { status: 'updated', role: existing, oldName };
    }

    const role = await guild.roles.create({
      name,
      color,
      permissions: 0n,
      mentionable: false,
      hoist: false,
      reason: 'Setup automático — separador visual criado.',
    });
    return { status: 'created', role };
  } catch (error) {
    logger.error(`Erro ao processar separador "${name}":`, error);
    return { status: 'error', error: error.message };
  }
}

async function ensureRole(guild, name, color, options = {}) {
  const { hoist = false, mentionable = false } = options;
  try {
    const exact = guild.roles.cache.find(r => r.name === name);
    if (exact) {
      const expectedColor = parseInt(color.replace('#', ''), 16);
      if (exact.color !== expectedColor || exact.hoist !== hoist || exact.mentionable !== mentionable) {
        await exact.edit({
          color,
          hoist,
          mentionable,
          reason: 'Setup automático SSP — correção de propriedades.'
        });
        return { status: 'updated', role: exact, oldName: exact.name };
      }
      return { status: 'skipped', role: exact };
    }

    // Extrair o "key" do nome (após ┃)
    const keyMatch = name.match(/┃\s*(.+)$/);
    const key = keyMatch ? keyMatch[1].trim().toLowerCase() : name.toLowerCase();

    // Procurar versão antiga/desalinhada (ex: emoji diferente)
    const existing = guild.roles.cache.find(r => {
      const normalized = r.name.toLowerCase().trim();
      return normalized === key ||
             normalized.endsWith('┃ ' + key) ||
             normalized.endsWith('┃' + key) ||
             normalized.endsWith('│ ' + key) ||
             normalized.endsWith('| ' + key);
    });

    if (existing) {
      const oldName = existing.name;
      await existing.edit({
        name,
        color,
        hoist,
        mentionable,
        reason: 'Setup automático SSP — correção de alinhamento e propriedades.',
      });
      return { status: 'updated', role: existing, oldName };
    }

    const role = await guild.roles.create({
      name,
      color,
      hoist,
      mentionable,
      reason: 'Setup automático SSP — cargo criado.',
    });
    return { status: 'created', role };
  } catch (error) {
    logger.error(`Erro ao processar cargo "${name}":`, error);
    return { status: 'error', error: error.message };
  }
}

/**
 * Reordena os cargos no Discord conforme a ordem definida no roleOrder.
 * priority menor = posição mais ALTA (mais acima na lista).
 */
async function reorderRoles(guild, roleOrder) {
  if (roleOrder.length === 0) return;

  // Descobrir a posição do cargo mais alto do bot para ficar abaixo dele
  const botMember = guild.members.me;
  const botHighestRole = botMember.roles.highest;
  const maxPosition = botHighestRole.position - 1;

  if (maxPosition < 1) {
    logger.warn('Bot não tem posição suficiente para reordenar cargos.');
    return;
  }

  // Filtrar apenas cargos que o bot pode gerenciar (abaixo do cargo mais alto do bot e não gerenciados)
  const manageableRoles = roleOrder.filter(item => 
    item.role && 
    item.role.position < botHighestRole.position && 
    !item.role.managed &&
    item.role.id !== guild.id
  );

  if (manageableRoles.length === 0) {
    logger.warn('Nenhum cargo gerenciável encontrado para reordenação.');
    return;
  }

  // Ordenar por priority (menor primeiro = mais alto)
  manageableRoles.sort((a, b) => a.priority - b.priority);

  // Calcular posições (de cima para baixo, partindo de maxPosition)
  const positions = [];
  for (let i = 0; i < manageableRoles.length; i++) {
    const targetPosition = maxPosition - i;
    if (targetPosition < 1) break;
    positions.push({
      role: manageableRoles[i].role.id,
      position: targetPosition,
    });
  }

  if (positions.length > 0) {
    await guild.roles.setPositions(positions);
    logger.success(`${positions.length} cargos reordenados com sucesso.`);
  }
}

function pushResult(result, name, created, updated, skipped, errors) {
  switch (result.status) {
    case 'created':
      created.push(name);
      break;
    case 'updated':
      updated.push(`• **${result.oldName}** ➡️ ${name}`);
      break;
    case 'skipped':
      skipped.push(name);
      break;
    case 'error':
      errors.push(`${name} (${result.error})`);
      break;
  }
}

async function syncGuildConfigFromCorporations(guild) {
  const guildId = guild.id;
  const GuildConfig = require('../database/models/GuildConfig');
  const configService = require('../services/configService');

  const pmespDoc = await corporationService.getBySlug(guildId, 'pmesp');
  if (!pmespDoc || !pmespDoc.roles) return;

  let config = await GuildConfig.findOne({ guildId });
  if (!config) {
    config = new GuildConfig({ guildId });
  }
  if (!config.roles) config.roles = {};

  const mapping = {
    geral: 'lspdGeral',
    comando: 'comandoAdmin',
    staff: 'ticketStaff',
    administrativo: 'administrativo',
    ministrador: 'ministrador',
    preAprovado: 'preAprovado',
    recruta: 'recrutaCadete',
    advVerbal: 'advVerbal',
    adv1: 'adv1',
    adv2: 'adv2',
    adv3: 'adv3',
  };

  let changed = false;
  for (const [corpKey, configKey] of Object.entries(mapping)) {
    if (pmespDoc.roles[corpKey] && config.roles[configKey] !== pmespDoc.roles[corpKey]) {
      config.roles[configKey] = pmespDoc.roles[corpKey];
      changed = true;
    }
  }

  // Sincronizar cargos compartilhados da configuração
  const setupConfig = corporationsConfig.sharedRoles.find(s => s.key === 'setup');
  const cidadaoConfig = corporationsConfig.sharedRoles.find(s => s.key === 'cidadao');

  if (setupConfig) {
    const setupRole = guild.roles.cache.find(r => r.name === setupConfig.name);
    if (setupRole && config.roles.setupAuthorized !== setupRole.id) {
      config.roles.setupAuthorized = setupRole.id;
      changed = true;
    }
  }

  if (cidadaoConfig) {
    const cidadaoRole = guild.roles.cache.find(r => r.name === cidadaoConfig.name);
    if (cidadaoRole && config.roles.cidadao !== cidadaoRole.id) {
      config.roles.cidadao = cidadaoRole.id;
      changed = true;
    }
  }

  if (pmespDoc.roles.geral && config.roles.policial !== pmespDoc.roles.geral) {
    config.roles.policial = pmespDoc.roles.geral;
    changed = true;
  }

  const caboRank = pmespDoc.ranks.find(r => r.name === 'Cabo PM');
  if (caboRank && caboRank.roleId && config.roles.caboRole !== caboRank.roleId) {
    config.roles.caboRole = caboRank.roleId;
    changed = true;
  }

  if (changed) {
    await config.save();
    await configService.reloadConfig(guildId);
    logger.info('[Setup-Patentes] GuildConfig legado sincronizado com corporação PMESP e cargos compartilhados');
  }
}
