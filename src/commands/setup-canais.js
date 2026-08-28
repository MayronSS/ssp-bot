const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { canSetupPanels } = require('../services/permissionService');
const logService = require('../services/logService');
const { createErrorEmbed, createSuccessEmbed } = require('../utils/createEmbed');
const logger = require('../utils/logger');
const { EPHEMERAL_REPLY } = require('../utils/interactionOptions');
const corporationService = require('../services/corporationService');
const corporationsConfig = require('../config/corporations');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-canais')
    .setDescription('Cria as categorias e canais do padrão SSP, configura as permissões e atualiza o banco de dados'),

  async execute(interaction) {
    if (!await canSetupPanels(interaction.member)) {
      return interaction.reply({
        embeds: [createErrorEmbed('Sem Permissão', 'Você não possui autorização para executar este comando.')],
        ...EPHEMERAL_REPLY,
      });
    }

    await interaction.deferReply(EPHEMERAL_REPLY);

    try {
      await interaction.guild.channels.fetch();
    } catch (err) {
      logger.error('Erro ao dar fetch nos canais do Discord:', err);
    }

    const created = [];
    const skipped = [];
    const errors = [];
    const guild = interaction.guild;
    const guildId = guild.id;

    try {
      // ════════════════════════════════════════
      // Obter cargos para configurar permissões
      // ════════════════════════════════════════
      const GuildConfig = require('../database/models/GuildConfig');
      const config = await GuildConfig.findOne({ guildId });
      const rolesConfig = config?.roles || {};

      const everyoneRole = guild.roles.everyone;
      const cidadaoRoleId = rolesConfig.cidadao;
      const cidadaoRole = cidadaoRoleId ? guild.roles.cache.get(cidadaoRoleId) : guild.roles.cache.find(r => ['👤 ┃ Cidadão', 'Cidadão'].includes(r.name));

      const pmespDoc = await corporationService.getBySlug(guildId, 'pmesp');
      const pcespDoc = await corporationService.getBySlug(guildId, 'pcesp');
      const pmespGeral = pmespDoc?.roles?.geral;
      const pcespGeral = pcespDoc?.roles?.geral;
      const pmespComando = pmespDoc?.roles?.comando;
      const pcespComando = pcespDoc?.roles?.comando;
      const pmespStaff = pmespDoc?.roles?.staff;
      const pcespStaff = pcespDoc?.roles?.staff;
      const pmespAdmin = pmespDoc?.roles?.administrativo;
      const pcespAdmin = pcespDoc?.roles?.administrativo;

      const policeRoleIds = [pmespGeral, pcespGeral, rolesConfig.policial, rolesConfig.lspdGeral].filter(Boolean);
      const staffRoleIds = [
        pmespComando, pcespComando, pmespStaff, pcespStaff, pmespAdmin, pcespAdmin,
        rolesConfig.comandoAdmin, rolesConfig.ticketStaff, rolesConfig.administrativo
      ].filter(Boolean);

      const roles = {
        everyoneRole,
        cidadaoRole,
        policeRoleIds,
        staffRoleIds,
        pmespComando, pcespComando, pmespStaff, pcespStaff, pmespAdmin, pcespAdmin
      };

      // ════════════════════════════════════════
      // 1. CANAIS COMPARTILHADOS (SSP Unificado)
      // ════════════════════════════════════════
      const sharedChannelIds = {};

      for (const [groupKey, group] of Object.entries(corporationsConfig.sharedChannelTemplate)) {
        try {
          const categoryName = group.category;
          const categoryOverwrites = getCategoryOverwrites(groupKey, roles);

          let categoryObj = guild.channels.cache.find(
            c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === categoryName.toLowerCase()
          );

          if (categoryObj) {
            skipped.push(`📁 ${categoryObj.name}`);
            await categoryObj.permissionOverwrites.set(categoryOverwrites).catch(err => {
              logger.warn(`Erro ao atualizar permissões da categoria ${categoryObj.name}: ${err.message}`);
            });
          } else {
            categoryObj = await guild.channels.create({
              name: categoryName,
              type: ChannelType.GuildCategory,
              reason: 'Setup automático SSP — canais compartilhados',
              permissionOverwrites: categoryOverwrites,
            });
            created.push(`📁 ${categoryObj.name}`);
          }

          if (group.categoryKey) {
            sharedChannelIds[group.categoryKey] = categoryObj.id;
          }

          for (const chan of group.channels) {
            try {
              let channelObj = guild.channels.cache.find(
                c => c.type === ChannelType.GuildText &&
                     c.name.toLowerCase() === chan.name.toLowerCase() &&
                     c.parentId === categoryObj.id
              );

              let channelOverwrites = null;
              if (chan.key === 'editalAvaliacaoPmesp' || chan.key === 'editalAvaliacaoPcesp') {
                channelOverwrites = [
                  {
                    id: everyoneRole.id,
                    deny: [PermissionFlagsBits.ViewChannel],
                  },
                ];
                if (cidadaoRole) {
                  channelOverwrites.push({
                    id: cidadaoRole.id,
                    deny: [PermissionFlagsBits.ViewChannel],
                  });
                }
                for (const rId of policeRoleIds) {
                  channelOverwrites.push({
                    id: rId,
                    deny: [PermissionFlagsBits.ViewChannel],
                  });
                }
                for (const rId of staffRoleIds) {
                  channelOverwrites.push({
                    id: rId,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                  });
                }
              } else if (chan.key === 'avaliacaoPanel') {
                // Cabo ou superior (level >= 2) e staff/comando/admin
                const evaluatorRoleIds = [];
                if (pmespDoc?.ranks) {
                  for (const rank of pmespDoc.ranks) {
                    const configRank = corporationsConfig.corporations.find(c => c.slug === 'pmesp')?.ranks.find(r => r.name === rank.name);
                    if (configRank && configRank.level >= 2 && rank.roleId) {
                      evaluatorRoleIds.push(rank.roleId);
                    }
                  }
                }
                if (pcespDoc?.ranks) {
                  for (const rank of pcespDoc.ranks) {
                    const configRank = corporationsConfig.corporations.find(c => c.slug === 'pcesp')?.ranks.find(r => r.name === rank.name);
                    if (configRank && configRank.level >= 2 && rank.roleId) {
                      evaluatorRoleIds.push(rank.roleId);
                    }
                  }
                }

                channelOverwrites = [
                  {
                    id: everyoneRole.id,
                    deny: [PermissionFlagsBits.ViewChannel],
                  },
                ];
                if (cidadaoRole) {
                  channelOverwrites.push({
                    id: cidadaoRole.id,
                    deny: [PermissionFlagsBits.ViewChannel],
                  });
                }
                for (const rId of policeRoleIds) {
                  channelOverwrites.push({
                    id: rId,
                    deny: [PermissionFlagsBits.ViewChannel],
                  });
                }
                for (const rId of evaluatorRoleIds) {
                  channelOverwrites.push({
                    id: rId,
                    allow: [PermissionFlagsBits.ViewChannel],
                    deny: [PermissionFlagsBits.SendMessages],
                  });
                }
                for (const rId of staffRoleIds) {
                  channelOverwrites.push({
                    id: rId,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                  });
                }
              } else if (chan.key === 'academiaPanel') {
                // Apenas ministrador e staff/comando
                const ministradorRoleIds = [
                  pmespDoc?.roles?.ministrador,
                  pcespDoc?.roles?.ministrador
                ].filter(Boolean);

                channelOverwrites = [
                  {
                    id: everyoneRole.id,
                    deny: [PermissionFlagsBits.ViewChannel],
                  },
                ];
                if (cidadaoRole) {
                  channelOverwrites.push({
                    id: cidadaoRole.id,
                    deny: [PermissionFlagsBits.ViewChannel],
                  });
                }
                for (const rId of policeRoleIds) {
                  channelOverwrites.push({
                    id: rId,
                    deny: [PermissionFlagsBits.ViewChannel],
                  });
                }
                for (const rId of ministradorRoleIds) {
                  channelOverwrites.push({
                    id: rId,
                    allow: [PermissionFlagsBits.ViewChannel],
                    deny: [PermissionFlagsBits.SendMessages],
                  });
                }
                for (const rId of staffRoleIds) {
                  channelOverwrites.push({
                    id: rId,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                  });
                }
              } else if (chan.key === 'academiaAvisos') {
                // Todo policial vê, mas apenas ministrador e staff enviam
                const ministradorRoleIds = [
                  pmespDoc?.roles?.ministrador,
                  pcespDoc?.roles?.ministrador
                ].filter(Boolean);

                channelOverwrites = [
                  {
                    id: everyoneRole.id,
                    deny: [PermissionFlagsBits.ViewChannel],
                  },
                ];
                if (cidadaoRole) {
                  channelOverwrites.push({
                    id: cidadaoRole.id,
                    deny: [PermissionFlagsBits.ViewChannel],
                  });
                }
                for (const rId of policeRoleIds) {
                  channelOverwrites.push({
                    id: rId,
                    allow: [PermissionFlagsBits.ViewChannel],
                    deny: [PermissionFlagsBits.SendMessages],
                  });
                }
                for (const rId of ministradorRoleIds) {
                  channelOverwrites.push({
                    id: rId,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                  });
                }
                for (const rId of staffRoleIds) {
                  channelOverwrites.push({
                    id: rId,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                  });
                }
              } else if (chan.key === 'editalPanel') {
                // Some para quem já está na polícia
                channelOverwrites = [
                  {
                    id: everyoneRole.id,
                    allow: [PermissionFlagsBits.ViewChannel],
                    deny: [PermissionFlagsBits.SendMessages],
                  },
                ];
                for (const rId of policeRoleIds) {
                  channelOverwrites.push({
                    id: rId,
                    deny: [PermissionFlagsBits.ViewChannel],
                  });
                }
                for (const rId of staffRoleIds) {
                  channelOverwrites.push({
                    id: rId,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                  });
                }
              } else if (chan.key === 'warningPanel') {
                // Apenas staff/comando/admin
                channelOverwrites = [
                  {
                    id: everyoneRole.id,
                    deny: [PermissionFlagsBits.ViewChannel],
                  },
                ];
                if (cidadaoRole) {
                  channelOverwrites.push({
                    id: cidadaoRole.id,
                    deny: [PermissionFlagsBits.ViewChannel],
                  });
                }
                for (const rId of policeRoleIds) {
                  channelOverwrites.push({
                    id: rId,
                    deny: [PermissionFlagsBits.ViewChannel],
                  });
                }
                for (const rId of staffRoleIds) {
                  channelOverwrites.push({
                    id: rId,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                  });
                }
              }

              if (channelObj) {
                skipped.push(`# ${channelObj.name}`);
                if (channelOverwrites) {
                  await channelObj.permissionOverwrites.set(channelOverwrites).catch(err => {
                    logger.warn(`Erro ao definir permissões do canal ${channelObj.name}: ${err.message}`);
                  });
                }
              } else {
                channelObj = await guild.channels.create({
                  name: chan.name,
                  type: ChannelType.GuildText,
                  parent: categoryObj.id,
                  reason: 'Setup automático SSP — canal compartilhado',
                  ...(channelOverwrites ? { permissionOverwrites: channelOverwrites } : {}),
                });
                created.push(`# ${channelObj.name}`);
              }

              if (chan.key) {
                sharedChannelIds[chan.key] = channelObj.id;

                if (chan.key === 'corregedoriaResults') {
                  sharedChannelIds['disciplinaryWarnings'] = channelObj.id;
                }
              }
            } catch (chanErr) {
              logger.error(`Erro ao criar canal ${chan.name}:`, chanErr);
              errors.push(`${chan.name} (${chanErr.message})`);
            }
          }
        } catch (catErr) {
          logger.error(`Erro ao criar categoria ${groupKey}:`, catErr);
          errors.push(`${groupKey} (${catErr.message})`);
        }
      }

      // Salvar canais compartilhados em TODAS as corporações
      for (const corpConfig of corporationsConfig.corporations) {
        await corporationService.updateChannels(guildId, corpConfig.slug, { ...sharedChannelIds });
      }

      // ════════════════════════════════════════
      // COMPATIBILIDADE: Sincronizar GuildConfig
      // ════════════════════════════════════════
      try {
        await syncGuildConfigChannels(guildId);
      } catch (err) {
        logger.warn('Aviso: Não foi possível sincronizar GuildConfig de canais:', err.message);
      }

      corporationService.invalidateCache(guildId);

      // ════════════════════════════════════════
      // RESPOSTA
      // ════════════════════════════════════════
      let summary = '';

      summary += `🏛️ **Padrão SSP Unificado**\n\n`;

      if (created.length > 0) {
        summary += `✅ **Criados (${created.length}):**\n${created.map(s => `• ${s}`).join('\n')}\n\n`;
      }
      if (skipped.length > 0) {
        summary += `ℹ️ **Já existentes (${skipped.length}):**\n${skipped.map(s => `• ${s}`).join('\n')}\n\n`;
      }
      if (errors.length > 0) {
        summary += `❌ **Erros (${errors.length}):**\n${errors.map(s => `• ${s}`).join('\n')}\n\n`;
      }

      summary += `💾 **IDs dos canais salvos no banco de dados.**`;

      await interaction.editReply({
        embeds: [createSuccessEmbed('Setup de Canais SSP', summary)],
      });

      try {
        await logService.logSetupExecuted(interaction.client, {
          userId: interaction.user.id,
          module: 'canais-ssp',
        });
      } catch (logErr) {
        // ignore
      }
    } catch (error) {
      logger.error('Erro geral no setup de canais:', error);
      await interaction.editReply({
        embeds: [createErrorEmbed('Erro no Processo', `Ocorreu um erro crítico: ${error.message}`)],
      });
    }
  },
};

/**
 * Sincroniza os canais da PMESP para o GuildConfig legado (compatibilidade).
 */
async function syncGuildConfigChannels(guildId) {
  const GuildConfig = require('../database/models/GuildConfig');
  const configService = require('../services/configService');

  const pmespDoc = await corporationService.getBySlug(guildId, 'pmesp');
  if (!pmespDoc || !pmespDoc.channels) return;

  let config = await GuildConfig.findOne({ guildId });
  if (!config) {
    config = new GuildConfig({ guildId });
  }
  if (!config.channels) config.channels = {};

  let changed = false;
  for (const [key, value] of Object.entries(pmespDoc.channels)) {
    if (value && config.channels[key] !== value) {
      config.channels[key] = value;
      changed = true;
    }
  }

  if (changed) {
    await config.save();
    await configService.reloadConfig(guildId);
    logger.info('[Setup-Canais] GuildConfig legado sincronizado com canais SSP');
  }
}

/**
 * Retorna as regras de sobrescrita de permissões de cada categoria.
 */
function getCategoryOverwrites(groupKey, roles) {
  const overwrites = [];

  // Padrão: Negar ver canal para everyone
  overwrites.push({
    id: roles.everyoneRole.id,
    deny: [PermissionFlagsBits.ViewChannel],
  });

  if (roles.cidadaoRole) {
    overwrites.push({
      id: roles.cidadaoRole.id,
      deny: [PermissionFlagsBits.ViewChannel],
    });
  }

  if (groupKey === 'atendimento') {
    // ATENDIMENTO: everyone e cidadão podem ver mas não enviar mensagens
    overwrites.length = 0; // limpa padrão
    overwrites.push({
      id: roles.everyoneRole.id,
      allow: [PermissionFlagsBits.ViewChannel],
      deny: [PermissionFlagsBits.SendMessages],
    });
    if (roles.cidadaoRole) {
      overwrites.push({
        id: roles.cidadaoRole.id,
        allow: [PermissionFlagsBits.ViewChannel],
        deny: [PermissionFlagsBits.SendMessages],
      });
    }
    // Cargos de polícia e staff
    for (const rId of [...roles.policeRoleIds, ...roles.staffRoleIds]) {
      overwrites.push({
        id: rId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
      });
    }
  } else if (groupKey === 'operacional') {
    // OPERACIONAL: apenas policiais e staff veem, mas não escrevem nos canais de painel
    for (const rId of roles.policeRoleIds) {
      overwrites.push({
        id: rId,
        allow: [PermissionFlagsBits.ViewChannel],
        deny: [PermissionFlagsBits.SendMessages],
      });
    }
    for (const rId of roles.staffRoleIds) {
      overwrites.push({
        id: rId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
      });
    }
  } else if (groupKey === 'corregedoria') {
    // CORREGEDORIA: policiais veem mas não escrevem; staff gerencia
    for (const rId of roles.policeRoleIds) {
      overwrites.push({
        id: rId,
        allow: [PermissionFlagsBits.ViewChannel],
        deny: [PermissionFlagsBits.SendMessages],
      });
    }
    for (const rId of roles.staffRoleIds) {
      overwrites.push({
        id: rId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
      });
    }
  } else if (groupKey === 'logs') {
    // LOGS SSP: apenas staff e comando veem
    for (const rId of roles.staffRoleIds) {
      overwrites.push({
        id: rId,
        allow: [PermissionFlagsBits.ViewChannel],
      });
    }
  } else if (groupKey === 'logsPmesp') {
    // LOGS PMESP: apenas PMESP staff e comando veem
    const pmespStaff = [roles.pmespComando, roles.pmespStaff, roles.pmespAdmin].filter(Boolean);
    for (const rId of pmespStaff) {
      overwrites.push({
        id: rId,
        allow: [PermissionFlagsBits.ViewChannel],
      });
    }
  } else if (groupKey === 'logsPcesp') {
    // LOGS PCESP: apenas PCESP staff e comando veem
    const pcespStaff = [roles.pcespComando, roles.pcespStaff, roles.pcespAdmin].filter(Boolean);
    for (const rId of pcespStaff) {
      overwrites.push({
        id: rId,
        allow: [PermissionFlagsBits.ViewChannel],
      });
    }
  }

  return overwrites;
}
