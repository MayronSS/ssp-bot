const { createBaseEmbed } = require('../utils/createEmbed');
const GuildConfig = require('../database/models/GuildConfig');
const Corporation = require('../database/models/Corporation');
const logger = require('../utils/logger');

// Cargo de Comando e Subcomando de Batalhão
const BATTALION_COMMAND_ROLE_ID = process.env.ROLE_CMD_BATALHAO || '1510983478534078464';
const BATTALION_SUB_COMMAND_ROLE_ID = process.env.ROLE_SUB_CMD_BATALHAO || '1528934906833539082';

// IDs de cargos de batalhão (fallback quando o DB não tem roles.geral preenchido)
const FALLBACK_BATTALION_ROLES = {
  ft:    '1510829677357432853',
  rota:  '1510829679844655234',
  baep:  '1510829682419957771',
  bprv:  '1510829684286296224',
  cavpm: '1510862263437885470',
};

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

/**
 * Resolve o emoji de uma patente (customizado do servidor ou fallback unicode).
 */
function resolveRankEmoji(guild, rank) {
  const emojiHelper = require('../utils/emojiHelper');
  const customEmoji = emojiHelper.findCustomRankEmoji(guild, rank);
  if (customEmoji) {
    return customEmoji.animated ? `<a:${customEmoji.name}:${customEmoji.id}>` : `<:${customEmoji.name}:${customEmoji.id}>`;
  }
  return rank.emoji || '👮';
}

/**
 * Formata um membro de forma limpa — apenas menção + badge + batalhão.
 * Usado dentro do agrupamento por patente.
 */
function formatMemberLine(member, isBattalionCmd = false, isBattalionSubCmd = false, battalionLabel = '') {
  const nickname = member.nickname || member.user.displayName || member.user.username;
  const badge = extractBadge(nickname);
  const badgeTag = badge ? ` \`${badge}\`` : '';
  
  let battTag = '';
  if (battalionLabel && isBattalionCmd) {
    battTag = ` ▸ \`${battalionLabel} | Cmd. de Batalhão\``;
  } else if (battalionLabel && isBattalionSubCmd) {
    battTag = ` ▸ \`${battalionLabel} | Sub Cmd. de Batalhão\``;
  } else if (battalionLabel) {
    battTag = ` ▸ \`${battalionLabel}\``;
  }
  
  return `> <@${member.id}>${badgeTag}${battTag}`;
}

/**
 * Agrupa uma lista de membros por patente e formata como seção limpa.
 * Cada patente aparece uma única vez como heading, com membros listados abaixo.
 * 
 * @param {Array} memberList - Array de { member, rank }
 * @param {Object} guild - Guild do Discord (para resolver emojis)
 * @param {Object} [opts] - Opções adicionais
 * @param {boolean} [opts.showBattalion] - Se deve mostrar tag de batalhão
 * @param {string}  [opts.forceBattalionLabel] - Label fixo de batalhão (ex: 'ROTA')
 * @param {string}  [opts.battalionCmdRoleId] - Role ID para highlight de CMD
 * @param {string}  [opts.battalionSubCmdRoleId] - Role ID para highlight de Sub CMD
 * @param {Object}  [opts.battalionRoles] - { ftRole, rotaRole, baepRole, bprvRole, cavpmRole }
 */
function formatGroupedSection(memberList, guild, opts = {}) {
  if (!memberList || memberList.length === 0) return '';

  // Agrupar por rank name + level
  const groups = new Map();
  for (const item of memberList) {
    const key = `${item.rank.level}::${item.rank.name}`;
    if (!groups.has(key)) {
      groups.set(key, { rank: item.rank, members: [] });
    }
    groups.get(key).members.push(item.member);
  }

  // Ordenar grupos por level decrescente
  const sortedGroups = [...groups.values()].sort((a, b) => b.rank.level - a.rank.level);

  // Ordenar membros dentro de cada grupo por badge numérica (crescente)
  for (const group of sortedGroups) {
    group.members.sort((a, b) => {
      const nickA = a.nickname || a.user.displayName || a.user.username;
      const nickB = b.nickname || b.user.displayName || b.user.username;
      const badgeA = parseInt(extractBadge(nickA)) || 99999;
      const badgeB = parseInt(extractBadge(nickB)) || 99999;
      return badgeA - badgeB;
    });
  }

  const lines = [];
  for (const group of sortedGroups) {
    const rankHeading = group.rank.roleId ? `<@&${group.rank.roleId}>` : `**${group.rank.name}**`;
    lines.push(rankHeading);
    
    for (const member of group.members) {
      let battLabel = '';
      if (opts.forceBattalionLabel) {
        battLabel = opts.forceBattalionLabel;
      } else if (opts.showBattalion && opts.battalionRoles) {
        battLabel = getMemberBattalionLabel(
          member,
          opts.battalionRoles.ftRole,
          opts.battalionRoles.rotaRole,
          opts.battalionRoles.baepRole,
          opts.battalionRoles.bprvRole,
          opts.battalionRoles.cavpmRole
        );
      }
      
      const isCmd = opts.battalionCmdRoleId ? member.roles.cache.has(opts.battalionCmdRoleId) : false;
      const isSubCmd = opts.battalionSubCmdRoleId ? member.roles.cache.has(opts.battalionSubCmdRoleId) : false;
      lines.push(formatMemberLine(member, isCmd, isSubCmd, battLabel));
    }
    lines.push(''); // Espaço entre grupos
  }

  return lines.join('\n').trim();
}

function getMemberBattalionLabel(member, ftRole, rotaRole, baepRole, bprvRole, cavpmRole) {
  if (ftRole && member.roles.cache.has(ftRole)) return 'FT';
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
    const pcespChannelId = '1510857782025257121';
    
    const mainChannel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
    const pcespChannel = guild.channels.cache.get(pcespChannelId) || await guild.channels.fetch(pcespChannelId).catch(() => null);
    
    if (!mainChannel && !pcespChannel) {
      logger.warn(`Canais de Hierarquia (Geral: ${channelId}, PCESP: ${pcespChannelId}) não configurados ou não encontrados.`);
      return;
    }

    // 1. Limpar mensagens antigas do bot nos canais de hierarquia
    const clearBotMessages = async (chan) => {
      if (!chan) return;
      const messages = await chan.messages.fetch({ limit: 50 }).catch(() => null);
      if (messages) {
        const botMessages = messages.filter(m => m.author.id === guild.client.user.id);
        for (const msg of botMessages.values()) {
          await msg.delete().catch(() => null);
        }
      }
    };

    await clearBotMessages(mainChannel);
    await clearBotMessages(pcespChannel);

    // 2. Carregar todas as corporações do banco
    const allCorps = await Corporation.find({ guildId: guild.id, active: true });
    
    // Mapear cada corp por slug para acesso rápido
    const corpsMap = new Map();
    allCorps.forEach(c => corpsMap.set(c.slug, c));

    // Ordem das corporações para exibição
    const CORP_ORDER = ['pmesp', 'ft', 'rota', 'baep', 'bprv', 'cavpm', 'pcesp'];
    
    // Ordenamos as corporações de acordo com CORP_ORDER (e as não listadas no final)
    const sortedCorps = [...allCorps].sort((a, b) => {
      const idxA = CORP_ORDER.indexOf(a.slug);
      const idxB = CORP_ORDER.indexOf(b.slug);
      if (idxA === -1 && idxB === -1) return a.name.localeCompare(b.name);
      if (idxA === -1) return 1;
      if (idxB === -1) return -1;
      return idxA - idxB;
    });

    const comandoAdminId = config?.roles?.comandoAdmin;

    // 3. Buscar membros do Discord
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

    // Estrutura para armazenar os membros de cada corporação
    const corpMembers = new Map();
    sortedCorps.forEach(c => {
      corpMembers.set(c.slug, { regular: [], comando: [] });
    });

    for (const m of members.values()) {
      if (m.user.bot) continue;

      let classified = false;
      
      // A. Verificar se pertence a algum batalhão (tags/secundárias)
      const tagCorps = sortedCorps.filter(c => c.type === 'tag');
      for (const corp of tagCorps) {
        const hasRole = corp.roles?.geral && m.roles.cache.has(corp.roles.geral);
        if (hasRole) {
          const parentCorp = corp.inheritsFrom ? corpsMap.get(corp.inheritsFrom) : null;
          const rank = resolveRank(m, corp, parentCorp);
          corpMembers.get(corp.slug).regular.push({ member: m, rank });
          classified = true;
          break;
        }
      }

      const hasDualRole = m.roles.cache.has('1510829616149954660');
      if (classified && !hasDualRole) continue;

      // B. Verificar corporações primárias
      const primaryCorps = sortedCorps.filter(c => c.type === 'primary');
      for (const corp of primaryCorps) {
        const hasRole = corp.roles?.geral && m.roles.cache.has(corp.roles.geral);
        if (hasRole) {
          const rank = resolveRank(m, corp);
          
          const commandRoleId = corp.roles?.comando;
          const isCmd = (commandRoleId && m.roles.cache.has(commandRoleId)) ||
                        (comandoAdminId && m.roles.cache.has(comandoAdminId));

          if (isCmd) {
            corpMembers.get(corp.slug).comando.push({ member: m, rank });
          } else {
            corpMembers.get(corp.slug).regular.push({ member: m, rank });
          }
          classified = true;
          break;
        }
      }
    }

    // 4. Construir os embeds
    const embedsToSendMain = [];
    const embedsToSendPcesp = [];

    for (const corp of sortedCorps) {
      const data = corpMembers.get(corp.slug);
      if (!data) continue;

      const totalCount = data.comando.length + data.regular.length;
      if (totalCount === 0) continue; // Não polui com embed de corporação vazia

      const sections = [];

      if (corp.type === 'primary') {
        if (data.comando.length > 0) {
          data.comando.sort((a, b) => b.rank.level - a.rank.level);
          const sectionAC = formatGroupedSection(data.comando, guild, {
            showBattalion: false,
          });
          sections.push(`### Alto Comando\n${sectionAC}`);
        }
        if (data.regular.length > 0) {
          data.regular.sort((a, b) => b.rank.level - a.rank.level);
          const sectionReg = formatGroupedSection(data.regular, guild);
          sections.push(`### Efetivo Geral\n${sectionReg}`);
        }
      } else {
        if (data.regular.length > 0) {
          data.regular.sort((a, b) => b.rank.level - a.rank.level);
          const section = formatGroupedSection(data.regular, guild, {
            forceBattalionLabel: corp.shortName.toUpperCase(),
            battalionCmdRoleId: BATTALION_COMMAND_ROLE_ID,
          });
          sections.push(section);
        }
      }

      if (sections.length > 0) {
        const desc = sections.join('\n\n');
        const embed = createBaseEmbed({
          title: `${corp.emoji || '🛡️'} ${corp.name.toUpperCase()} (${corp.shortName.toUpperCase()})`,
          description: desc,
          color: corp.color || '#1B52F1',
          useDefaultAuthor: false,
          useDefaultFooter: false,
          footer: { text: `Efetivo: ${totalCount} integrantes` },
          timestamp: true,
        });
        
        if (corp.slug === 'pcesp') {
          embedsToSendPcesp.push(embed);
        } else {
          embedsToSendMain.push(embed);
        }
      }
    }

    // 5. Enviar os embeds
    if (mainChannel) {
      if (embedsToSendMain.length > 0) {
        // O Discord limita a 10 embeds por mensagem. Vamos agrupar de 10 em 10 apenas por segurança.
        for (let i = 0; i < embedsToSendMain.length; i += 10) {
          const chunk = embedsToSendMain.slice(i, i + 10);
          await mainChannel.send({ embeds: chunk });
        }
      } else {
        const emptyEmbed = createBaseEmbed({
          title: '📋 HIERARQUIA CORPORATIVA',
          description: '*Nenhum oficial registrado no momento.*',
          colorType: 'dark',
          useDefaultAuthor: false,
          useDefaultFooter: false,
        });
        await mainChannel.send({ embeds: [emptyEmbed] });
      }
    }

    if (pcespChannel) {
      if (embedsToSendPcesp.length > 0) {
        for (let i = 0; i < embedsToSendPcesp.length; i += 10) {
          const chunk = embedsToSendPcesp.slice(i, i + 10);
          await pcespChannel.send({ embeds: chunk });
        }
      } else {
        const emptyEmbed = createBaseEmbed({
          title: '📋 HIERARQUIA PCESP',
          description: '*Nenhum oficial registrado no momento.*',
          colorType: 'dark',
          useDefaultAuthor: false,
          useDefaultFooter: false,
        });
        await pcespChannel.send({ embeds: [emptyEmbed] });
      }
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
