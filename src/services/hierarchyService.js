const { createBaseEmbed } = require('../utils/createEmbed');
const GuildConfig = require('../database/models/GuildConfig');
const Corporation = require('../database/models/Corporation');
const logger = require('../utils/logger');

// Cargo de Comando de Batalhão
const BATTALION_COMMAND_ROLE_ID = '1510983478534078464';

let updateTimeout = null;
let isUpdating = false;
let nextUpdatePending = false;
let pendingGuild = null;

function extractBadge(nickname) {
  const match = nickname.match(/\[(\d+)\]/);
  return match ? match[1] : null;
}

function resolveRank(member, corp, parentCorp) {
  let highestRank = null;
  
  if (corp && corp.ranks && corp.ranks.length > 0) {
    const matching = corp.ranks.filter(r => r.roleId && member.roles.cache.has(r.roleId));
    if (matching.length > 0) {
      matching.sort((a, b) => b.level - a.level);
      highestRank = matching[0];
    }
  }
  
  if (!highestRank && parentCorp && parentCorp.ranks && parentCorp.ranks.length > 0) {
    const matching = parentCorp.ranks.filter(r => r.roleId && member.roles.cache.has(r.roleId));
    if (matching.length > 0) {
      matching.sort((a, b) => b.level - a.level);
      highestRank = matching[0];
    }
  }
  
  return highestRank || { name: 'Oficial', level: -1, emoji: '👮' };
}

function formatMemberEntry(member, rank, isBattalionCmd = false, battalionLabel = '') {
  const nickname = member.nickname || member.user.displayName || member.user.username;
  const badge = extractBadge(nickname);
  const badgeText = badge ? ` \`[${badge}]\`` : ' `[N/A]`';
  const cmdHighlight = isBattalionCmd ? ' 👑' : '';
  
  const emojiHelper = require('../utils/emojiHelper');
  const customEmoji = emojiHelper.findCustomRankEmoji(member.guild, rank);
  let emoji = rank.emoji || '👮';
  if (customEmoji) {
    emoji = customEmoji.animated ? `<a:${customEmoji.name}:${customEmoji.id}>` : `<:${customEmoji.name}:${customEmoji.id}>`;
  }
  
  const battSuffix = battalionLabel ? ` \`[${battalionLabel}]\`` : '';
  
  const rankMention = rank.roleId ? `<@&${rank.roleId}>` : `**${rank.name}**`;
  
  return `│ ${emoji} ${rankMention} ── <@${member.id}>${badgeText}${battSuffix}${cmdHighlight}`;
}

function getMemberBattalionLabel(member, rotaRole, baepRole, bprvRole, cavpmRole) {
  if (rotaRole && member.roles.cache.has(rotaRole)) return 'ROTA';
  if (baepRole && member.roles.cache.has(baepRole)) return 'BAEP';
  if (bprvRole && member.roles.cache.has(bprvRole)) return 'BPRV';
  if (cavpmRole && member.roles.cache.has(cavpmRole)) return 'CAvPM';
  return '';
}

/**
 * Função interna de execução real da atualização.
 */
async function performUpdate(guild) {
  try {
    const config = await GuildConfig.findOne({ guildId: guild.id });
    const channelId = config?.channels?.hierarchy || '1510995302856003776';
    
    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      logger.warn(`Canal de Hierarquia não configurado ou não encontrado: ${channelId}`);
      return;
    }

    // 1. Limpar mensagens antigas do bot no canal de hierarquia
    const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    if (messages) {
      const botMessages = messages.filter(m => m.author.id === guild.client.user.id);
      for (const msg of botMessages.values()) {
        await msg.delete().catch(() => null);
      }
    }

    // 2. Carregar todas as corporações do banco
    const allCorps = await Corporation.find({ guildId: guild.id, active: true });
    const pmespCorp = allCorps.find(c => c.slug === 'pmesp');
    const pcespCorp = allCorps.find(c => c.slug === 'pcesp');
    
    const rotaCorp = allCorps.find(c => c.slug === 'rota');
    const baepCorp = allCorps.find(c => c.slug === 'baep');
    const bprvCorp = allCorps.find(c => c.slug === 'bprv');
    const cavpmCorp = allCorps.find(c => c.slug === 'cavpm');

    // Roles importantes
    const comandoAdminId = config?.roles?.comandoAdmin;
    const pmespComandoId = pmespCorp?.roles?.comando;
    const pcespComandoId = pcespCorp?.roles?.comando;

    const isPmespComando = (m) => {
      return (pmespComandoId && m.roles.cache.has(pmespComandoId)) ||
             (comandoAdminId && m.roles.cache.has(comandoAdminId) && pmespCorp?.roles?.geral && m.roles.cache.has(pmespCorp.roles.geral));
    };

    const isPcespComando = (m) => {
      return (pcespComandoId && m.roles.cache.has(pcespComandoId)) ||
             (comandoAdminId && m.roles.cache.has(comandoAdminId) && pcespCorp?.roles?.geral && m.roles.cache.has(pcespCorp.roles.geral));
    };

    // 3. Buscar membros do Discord (evitando rate limit de Opcode 8 usando cache se já estiver carregado)
    let members;
    if (guild.members.cache.size >= Math.min(guild.memberCount, 10)) {
      members = guild.members.cache;
    } else {
      try {
        members = await guild.members.fetch();
      } catch (fetchErr) {
        logger.warn(`Erro ao fazer fetch dos membros via Gateway, usando cache: ${fetchErr.message}`);
        members = guild.members.cache;
      }
    }
    
    const pmespAltoComando = [];
    const pcespAltoComando = [];
    const pmespRegular = [];
    const pcespRegular = [];
    
    const rotaMembers = [];
    const baepMembers = [];
    const bprvMembers = [];
    const cavpmMembers = [];

    const rotaRole = rotaCorp?.roles?.geral;
    const baepRole = baepCorp?.roles?.geral;
    const bprvRole = bprvCorp?.roles?.geral;
    const cavpmRole = cavpmCorp?.roles?.geral;

    for (const m of members.values()) {
      if (m.user.bot) continue;

      const hasPmesp = pmespCorp?.roles?.geral && m.roles.cache.has(pmespCorp.roles.geral);
      const hasPcesp = pcespCorp?.roles?.geral && m.roles.cache.has(pcespCorp.roles.geral);
      
      const hasRota = rotaRole && m.roles.cache.has(rotaRole);
      const hasBaep = baepRole && m.roles.cache.has(baepRole);
      const hasBprv = bprvRole && m.roles.cache.has(bprvRole);
      const hasCavpm = cavpmRole && m.roles.cache.has(cavpmRole);

      if (isPmespComando(m)) {
        const rank = resolveRank(m, pmespCorp);
        pmespAltoComando.push({ member: m, rank });
        continue;
      }

      if (isPcespComando(m)) {
        const rank = resolveRank(m, pcespCorp);
        pcespAltoComando.push({ member: m, rank });
        continue;
      }

      if (hasPcesp) {
        const rank = resolveRank(m, pcespCorp);
        pcespRegular.push({ member: m, rank });
        continue;
      }

      // Se tiver cargo de algum batalhão
      if (hasRota) {
        const rank = resolveRank(m, rotaCorp, pmespCorp);
        rotaMembers.push({ member: m, rank });
        continue;
      }
      if (hasBaep) {
        const rank = resolveRank(m, baepCorp, pmespCorp);
        baepMembers.push({ member: m, rank });
        continue;
      }
      if (hasBprv) {
        const rank = resolveRank(m, bprvCorp, pmespCorp);
        bprvMembers.push({ member: m, rank });
        continue;
      }
      if (hasCavpm) {
        const rank = resolveRank(m, cavpmCorp, pmespCorp);
        cavpmMembers.push({ member: m, rank });
        continue;
      }

      // PMESP Regular
      if (hasPmesp) {
        const rank = resolveRank(m, pmespCorp);
        pmespRegular.push({ member: m, rank });
      }
    }

    // 4. Ordenar os membros por nível de patente (decrescente)
    const sortByRank = (a, b) => b.rank.level - a.rank.level;
    
    pmespAltoComando.sort(sortByRank);
    pcespAltoComando.sort(sortByRank);
    pmespRegular.sort(sortByRank);
    pcespRegular.sort(sortByRank);
    rotaMembers.sort(sortByRank);
    baepMembers.sort(sortByRank);
    bprvMembers.sort(sortByRank);
    cavpmMembers.sort(sortByRank);

    // 5. Construir os embeds de forma organizada, limpa e minimalista
    const embedsToSend = [];

    // EMBED 1: PMESP Geral e Batalhões
    let descPmesp = '';
    
    if (pmespAltoComando.length > 0) {
      descPmesp += '### 🏛️ Alto Comando (PMESP)\n' + pmespAltoComando.map(item => {
        const batt = getMemberBattalionLabel(item.member, rotaRole, baepRole, bprvRole, cavpmRole);
        return formatMemberEntry(item.member, item.rank, false, batt);
      }).join('\n') + '\n\n';
    }
    
    if (pmespRegular.length > 0) {
      if (descPmesp) descPmesp += '──────────────────────────\n\n';
      descPmesp += '### 🛡️ Oficiais PMESP\n' + pmespRegular.map(item => formatMemberEntry(item.member, item.rank)).join('\n') + '\n\n';
    }
    
    if (rotaMembers.length > 0) {
      if (descPmesp) descPmesp += '──────────────────────────\n\n';
      descPmesp += '### 🎯 ROTA\n' + rotaMembers.map(item => {
        const isCmd = item.member.roles.cache.has(BATTALION_COMMAND_ROLE_ID);
        return formatMemberEntry(item.member, item.rank, isCmd, 'ROTA');
      }).join('\n') + '\n\n';
    }
    
    if (baepMembers.length > 0) {
      if (descPmesp) descPmesp += '──────────────────────────\n\n';
      descPmesp += '### 💥 BAEP\n' + baepMembers.map(item => {
        const isCmd = item.member.roles.cache.has(BATTALION_COMMAND_ROLE_ID);
        return formatMemberEntry(item.member, item.rank, isCmd, 'BAEP');
      }).join('\n') + '\n\n';
    }
    
    if (bprvMembers.length > 0) {
      if (descPmesp) descPmesp += '──────────────────────────\n\n';
      descPmesp += '### 🛣️ BPRV\n' + bprvMembers.map(item => {
        const isCmd = item.member.roles.cache.has(BATTALION_COMMAND_ROLE_ID);
        return formatMemberEntry(item.member, item.rank, isCmd, 'BPRV');
      }).join('\n') + '\n\n';
    }
    
    if (cavpmMembers.length > 0) {
      if (descPmesp) descPmesp += '──────────────────────────\n\n';
      descPmesp += '### 🚁 CAvPM\n' + cavpmMembers.map(item => {
        const isCmd = item.member.roles.cache.has(BATTALION_COMMAND_ROLE_ID);
        return formatMemberEntry(item.member, item.rank, isCmd, 'CAvPM');
      }).join('\n');
    }
    
    descPmesp = descPmesp.trim();

    if (descPmesp) {
      const embedPmesp = createBaseEmbed({
        title: '🛡️ POLÍCIA MILITAR (PMESP)',
        description: descPmesp,
        colorType: 'dark',
        useDefaultAuthor: false,
        useDefaultFooter: false,
      });
      embedsToSend.push(embedPmesp);
    }

    // EMBED 2: PCESP Geral
    let descPcesp = '';
    if (pcespAltoComando.length > 0) {
      descPcesp += '### 🏛️ Alto Comando (PCESP)\n' + pcespAltoComando.map(item => formatMemberEntry(item.member, item.rank)).join('\n') + '\n\n';
    }
    
    if (pcespRegular.length > 0) {
      if (descPcesp) descPcesp += '──────────────────────────\n\n';
      descPcesp += '### 🕵️ Oficiais PCESP\n' + pcespRegular.map(item => formatMemberEntry(item.member, item.rank)).join('\n');
    }
    descPcesp = descPcesp.trim();

    if (descPcesp) {
      const embedPcesp = createBaseEmbed({
        title: '🕵️ POLÍCIA CIVIL (PCESP)',
        description: descPcesp,
        colorType: 'dark',
        useDefaultAuthor: false,
        useDefaultFooter: false,
      });
      embedsToSend.push(embedPcesp);
    }

    // Enviar os embeds
    if (embedsToSend.length > 0) {
      await channel.send({ embeds: embedsToSend });
    } else {
      const emptyEmbed = createBaseEmbed({
        title: '📋 HIERARQUIA CORPORATIVA',
        description: '*Nenhum oficial registrado no momento.*',
        colorType: 'dark',
        useDefaultAuthor: false,
        useDefaultFooter: false,
      });
      await channel.send({ embeds: [emptyEmbed] });
    }

    logger.success('Hierarquia atualizada com sucesso no canal!');
  } catch (err) {
    logger.error('Erro ao atualizar canal de hierarquia:', err);
  }
}

/**
 * Atualiza a hierarquia com debouncing de 3 segundos para evitar Gateway Rate Limit.
 */
async function updateHierarchy(guild) {
  pendingGuild = guild;
  
  if (isUpdating) {
    nextUpdatePending = true;
    return;
  }
  
  if (updateTimeout) {
    clearTimeout(updateTimeout);
  }
  
  updateTimeout = setTimeout(async () => {
    isUpdating = true;
    nextUpdatePending = false;
    try {
      if (pendingGuild) {
        await performUpdate(pendingGuild);
      }
    } catch (err) {
      logger.error('Erro na atualização de hierarquia:', err);
    } finally {
      isUpdating = false;
      if (nextUpdatePending) {
        nextUpdatePending = false;
        // Chamar recursivamente para tratar atualizações enfileiradas
        updateHierarchy(guild);
      }
    }
  }, 3000);
}

module.exports = {
  updateHierarchy,
};
