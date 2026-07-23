const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ContainerBuilder,
  FileBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  EmbedBuilder,
  SectionBuilder,
  ThumbnailBuilder,
} = require('discord.js');

/**
 * Helper to add custom logo thumbnail to a container header section.
 */
function addLogoThumbnailToContainer(container, contentText) {
  const embedsConfig = require('../config/embeds');
  const logoUrl = embedsConfig.design.logo;
  if (logoUrl && logoUrl.startsWith('http')) {
    const headerSection = new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(contentText))
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(logoUrl).setDescription('Logo'));
    return container.addSectionComponents(headerSection);
  } else {
    return container.addTextDisplayComponents(new TextDisplayBuilder().setContent(contentText));
  }
}

/**
 * Cria um ActionRow contendo botões de forma simplificada a partir de um array de configurações.
 *
 * @param {Array<Object>} buttons - Array de configurações de botões.
 * @returns {ActionRowBuilder}
 */
function createButtonRow(buttons) {
  const row = new ActionRowBuilder();

  for (const btn of buttons) {
    const button = new ButtonBuilder()
      .setCustomId(btn.customId)
      .setLabel(btn.label)
      .setStyle(btn.style ?? ButtonStyle.Secondary);

    if (btn.emoji) {
      // Se o emoji é um objeto com id (customizado), validar que o id é string numérica válida
      if (typeof btn.emoji === 'object' && btn.emoji.id) {
        if (/^\d+$/.test(btn.emoji.id)) {
          button.setEmoji(btn.emoji);
        }
        // Se id inválido, simplesmente não aplica emoji (fallback silencioso)
      } else if (typeof btn.emoji === 'string') {
        button.setEmoji(btn.emoji);
      }
    }
    if (btn.disabled) button.setDisabled(true);

    row.addComponents(button);
  }

  return row;
}

/**
 * Painel de Bate-Ponto: quatro ações principais do ponto.
 *
 * Observação importante:
 * No Discord, botões não entram dentro de EmbedBuilder. Para o visual solicitado
 * (botões dentro da mesma caixa visual), usamos Components V2 com ContainerBuilder.
 */
function createPontoPanelButtons(corporation) {
  const emojiHelper = require('./emojiHelper');
  const suffix = corporation ? `:${corporation.slug}` : '';

  return createButtonRow([
    {
      customId: `ponto_atualizar${suffix}`,
      label: 'Atualizar',
      emoji: emojiHelper.getRaw('refresh'),
      style: ButtonStyle.Secondary,
    },
    {
      customId: `ponto_ranking${suffix}`,
      label: 'Ranking',
      emoji: emojiHelper.getRaw('trophy'),
      style: ButtonStyle.Secondary,
    },
  ]);
}

/**
 * Cria o painel visual de Bate-Ponto usando Discord Components V2.
 *
 * Esse painel substitui o EmbedBuilder tradicional para permitir que título,
 * descrição, separador e botões fiquem dentro da mesma caixa visual.
 *
 * @returns {ContainerBuilder}
 */
function createPontoPanelContainer(corporation) {
  const emojiHelper = require('./emojiHelper');
  const corpName = corporation ? corporation.shortName : 'SSP';
  const accentColor = corporation ? parseInt(corporation.color.replace('#', ''), 16) : 0x111625;

  const container = new ContainerBuilder()
    .setAccentColor(accentColor);

  addLogoThumbnailToContainer(
    container,
    `${emojiHelper.get('clock')} **Sistema de Bater Ponto — ${corpName}**\n\n` +
    '> O registro de expediente está **vinculado diretamente ao jogo**.\n' +
    '> Entre em serviço na cidade para registrar a entrada e saia para registrar a saída.\n' +
    '> Use **Atualizar** para recarregar o status e **Ranking** para ver o top de horas.'
  );

  return container
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addActionRowComponents(createPontoPanelButtons(corporation));
}

/**
 * Payload pronto para enviar/editar o painel de Bate-Ponto em Components V2.
 *
 * @returns {Object}
 */
function createPontoPanelPayload(corporation) {
  return {
    components: [createPontoPanelContainer(corporation)],
    flags: MessageFlags.IsComponentsV2,
  };
}

function createPontoStatusContainer(ativos = []) {
  const emojiHelper = require('./emojiHelper');

  let body;

  if (ativos.length === 0) {
    body = '*Nenhum oficial em patrulhamento no momento.*';
  } else {
    // Agrupar por corporação
    const groups = {};
    for (const ponto of ativos) {
      const slug = ponto.corporationSlug || 'pmesp';
      if (!groups[slug]) groups[slug] = [];
      groups[slug].push(ponto);
    }

    const corpLabels = {
      pmesp: { emoji: 'shield_pm', name: 'PMESP' },
      pcesp: { emoji: 'shield_pc', name: 'PCESP' },
    };

    const sections = [];
    for (const [slug, pontos] of Object.entries(groups)) {
      const config = corpLabels[slug] || { emoji: 'star_badge', name: slug.toUpperCase() };
      const header = `${emojiHelper.get(config.emoji)} **${config.name}** — ${pontos.length} em serviço`;
      const lines = pontos.map((ponto, index) => {
        const corporationsConfig = require('../config/corporations');
        let battalionTag = '';
        if (ponto.battalionSlug) {
          const tag = corporationsConfig.tags.find(t => t.slug === ponto.battalionSlug);
          if (tag) battalionTag = ` • ${tag.emoji} **${tag.shortName}**`;
        }
        return (
          `**${index + 1}.** ${emojiHelper.get('user')} <@${ponto.userId}>${battalionTag}\n` +
          `> **Em patrulha há:** ${ponto.durationStr}\n` +
          `> **Início:** ${ponto.entradaTimestamp}`
        );
      });
      sections.push(`${header}\n\n${lines.join('\n\n')}`);
    }

    body = sections.join('\n\n─────────────────────\n\n');
  }

  return new ContainerBuilder()
    .setAccentColor(0x111625)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${emojiHelper.get('clipboard')} **Registro de Baixa (Em Serviço)**`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(body)
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${emojiHelper.get('refresh')} **Atualização automática do sistema de ponto**`
      )
    );
}

function createPontoStatusPayload(ativos = []) {
  return {
    components: [createPontoStatusContainer(ativos)],
    flags: MessageFlags.IsComponentsV2,
  };
}

function createPontoLogContainer(data) {
  const emojiHelper = require('./emojiHelper');

  const titleEmoji = data.type === 'entrada'
    ? emojiHelper.get('check')
    : emojiHelper.get('stop');

  const title = data.type === 'entrada' ? 'Ponto Aberto' : 'Ponto Encerrado';
  const status = data.type === 'entrada' ? 'Em serviço' : 'Fora de serviço';

  const corpLabels = {
    pmesp: { emoji: 'shield_pm', name: 'PMESP' },
    pcesp: { emoji: 'shield_pc', name: 'PCESP' },
  };
  const corpConfig = corpLabels[data.corporationSlug] || { emoji: 'star_badge', name: (data.corporationSlug || 'SSP').toUpperCase() };

  const lines = [
    `${emojiHelper.get(corpConfig.emoji)} **Corporação**`,
    `> **${corpConfig.name}**`,
    '',
    `${emojiHelper.get('user')} **Usuário**`,
    `> ${data.userMention} — **${data.displayName}**`,
    `> ID: \`${data.userId}\``,
    '',
    `${emojiHelper.get('clipboard')} **Status**`,
    `> **${status}**`,
    '',
    `${emojiHelper.get('calendar')} **Ponto iniciado**`,
    `> ${data.entradaTimestamp}`,
  ];

  if (data.saidaTimestamp) {
    lines.push('', `${emojiHelper.get('stop')} **Ponto encerrado**`, `> ${data.saidaTimestamp}`);
  }

  lines.push(
    '',
    `${emojiHelper.get('clock')} **Tempo**`,
    `> **${data.durationText}**`,
    '',
    `${emojiHelper.get('idcard')} **Registro**`,
    `> \`${data.registroId}\``
  );

  const container = new ContainerBuilder()
    .setAccentColor(0x111625);

  const headerContent = `${titleEmoji} **${title}**`;

  const embedsConfig = require('../config/embeds');
  const logoUrl = embedsConfig.design.logo;
  if (logoUrl && logoUrl.startsWith('http')) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerContent))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(logoUrl).setDescription('Logo'))
    );
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(headerContent)
    );
  }

  return container
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(lines.join('\n'))
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${emojiHelper.get('refresh')} **SSP • Sistema de Bate-Ponto • Log operacional**`
      )
    );
}

function createCompactPontoLogContainer(data) {
  const emojiHelper = require('./emojiHelper');
  const titleEmoji = data.type === 'entrada'
    ? emojiHelper.get('check')
    : emojiHelper.get('stop');
  const title = data.type === 'entrada' ? 'Ponto Aberto' : 'Ponto Encerrado';
  const timeLine = data.type === 'entrada'
    ? `${emojiHelper.get('clock')} Entrada: ${data.entradaTimestamp}`
    : `${emojiHelper.get('clock')} ${data.entradaTimestamp} - ${data.saidaTimestamp} | **${data.durationText}**`;

  // Corporação e batalhão
  const corpLabels = {
    pmesp: { emoji: 'shield_pm', name: 'PMESP' },
    pcesp: { emoji: 'shield_pc', name: 'PCESP' },
  };
  const corpConfig = corpLabels[data.corporationSlug] || { emoji: 'star_badge', name: (data.corporationSlug || 'SSP').toUpperCase() };
  let corpLine = `${emojiHelper.get(corpConfig.emoji)} **${corpConfig.name}**`;
  if (data.battalionSlug) {
    const corporationsConfig = require('../config/corporations');
    const tag = corporationsConfig.tags.find(t => t.slug === data.battalionSlug);
    if (tag) {
      corpLine += ` • ${tag.emoji} **${tag.shortName}**`;
    }
  }

  const container = new ContainerBuilder()
    .setAccentColor(0x111625);

  const headerContent = `${titleEmoji} **${title}**`;

  const embedsConfig = require('../config/embeds');
  const logoUrl = embedsConfig.design.logo;
  if (logoUrl && logoUrl.startsWith('http')) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerContent))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(logoUrl).setDescription('Logo'))
    );
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(headerContent)
    );
  }

  return container
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent([
        `${emojiHelper.get('user')} ${data.userMention} - **${data.displayName}**`,
        corpLine,
        timeLine,
        `${emojiHelper.get('idcard')} Registro: \`${data.registroId}\``,
        data.actionNote ? `${emojiHelper.get('clipboard')} ${data.actionNote}` : null,
      ].filter(Boolean).join('\n'))
    );
}

function createPontoLogPayload(data) {
  return {
    components: [createCompactPontoLogContainer(data)],
    flags: MessageFlags.IsComponentsV2,
  };
}

function whiteEmoji(key) {
  const rawEmoji = require('./emojiHelper').getRaw(key);
  return typeof rawEmoji === 'object' ? rawEmoji : undefined;
}

function whiteIcon(key) {
  const emoji = whiteEmoji(key);
  return emoji ? `<:${emoji.name}:${emoji.id}>` : '';
}

function withWhiteIcon(key, text) {
  const icon = whiteIcon(key);
  return icon ? `${icon} ${text}` : text;
}

function uniqueMentionUsers(ids = []) {
  return [...new Set(ids.filter(Boolean).map(String))];
}

function limitText(text, max = 900) {
  const value = String(text || '').trim();
  if (value.length <= max) return value || 'N/A';
  return `${value.slice(0, max - 15)}... [cortado]`;
}

function normalizeDepartmentLabel(name) {
  return String(name || 'Suporte Geral')
    .replace(/\bDenúncia Anónima\b/g, 'Denúncia Anônima')
    .replace(/\bAtualização de Registo\b/g, 'Atualização de Registro');
}

function normalizeText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isComplaintDepartment(name) {
  const normalized = normalizeText(normalizeDepartmentLabel(name));
  const compact = normalized.replace(/[^a-z0-9]/g, '');
  return (
    normalized.includes('denuncia') ||
    compact.includes('denuncia') ||
    compact.includes('denancia') ||
    normalized.includes('corregedoria') ||
    compact.includes('corregedoria') ||
    normalized.includes('assuntos internos') ||
    compact.includes('assuntosinternos')
  );
}

function createTicketDepartmentMenu(corporation) {
  const suffix = corporation ? `:${corporation.slug}` : '';
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`selecionar_tipo_ticket${suffix}`)
      .setPlaceholder('Selecione o departamento...')
      .addOptions(
        {
          label: 'Suporte Geral',
          value: 'suporte',
          description: 'Dúvidas, solicitações e orientação ao cidadão.',
          emoji: whiteEmoji('clipboard'),
        },
        {
          label: 'Denúncia',
          value: 'denuncia',
          description: 'Relate ocorrências, infrações ou envie provas.',
          emoji: whiteEmoji('stop'),
        },
        {
          label: 'Atualização de Registro',
          value: 'perfil',
          description: 'Nome, passaporte ou dados do RP.',
          emoji: whiteEmoji('idcard'),
        }
      )
  );
}

/**
 * Painel de Tickets legado: botões mantidos para compatibilidade.
 */
function createTicketPanelButtons() {
  return createButtonRow([
    {
      customId: 'ticket_abrir',
      label: 'Abrir Ticket',
      emoji: whiteEmoji('clipboard'),
      style: ButtonStyle.Secondary,
    },
    {
      customId: 'ticket_abrir_denuncia',
      label: 'Denúncia',
      emoji: whiteEmoji('stop'),
      style: ButtonStyle.Secondary,
    },
  ]);
}

function createTicketPanelContainer(corporation) {
  const corpName = corporation ? corporation.shortName : 'SSP';
  const accentColor = corporation ? parseInt(corporation.color.replace('#', ''), 16) : 0x111625;

  const container = new ContainerBuilder()
    .setAccentColor(accentColor);

  addLogoThumbnailToContainer(
    container,
    `${withWhiteIcon('clipboard', `**Central de Atendimento ${corpName}**`)}\n\n` +
    '> Abra um atendimento com a division correta da corporacao.\n' +
    '> Selecione abaixo o departamento desejado e aguarde a criacao do canal.'
  );

  return container
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('idcard', '**Departamentos disponiveis**')}\n` +
        '- **Suporte Geral:** duvidas, solicitacoes e orientacao.\n' +
        '- **Denuncia:** relato de ocorrencias, infracoes e envio de provas.\n' +
        '- **Atualizacao de Registro:** correcao de nome, passaporte ou dados do RP.'
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addActionRowComponents(createTicketDepartmentMenu(corporation));
}

/**
 * Painel de Tickets UNIFICADO: seleciona corporação primeiro, depois departamento.
 * Usado quando não há corporação definida (painel único para PMESP + PCESP).
 */
function createUnifiedTicketPanelContainer() {
  const emojiHelper = require('./emojiHelper');
  const pmEmoji = emojiHelper.getRaw('shield_pm');
  const pcEmoji = emojiHelper.getRaw('shield_pc');

  const corpSelectMenu = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('selecionar_corp_ticket')
      .setPlaceholder('Selecione a corporacao para abrir seu ticket...')
      .addOptions(
        {
          label: 'PMESP — Policia Militar',
          value: 'pmesp',
          description: 'Abrir ticket para a Policia Militar do Estado de SP.',
          emoji: pmEmoji,
        },
        {
          label: 'PCESP — Policia Civil',
          value: 'pcesp',
          description: 'Abrir ticket para a Policia Civil do Estado de SP.',
          emoji: pcEmoji,
        }
      )
  );

  const container = new ContainerBuilder()
    .setAccentColor(0x111625);

  addLogoThumbnailToContainer(
    container,
    `${withWhiteIcon('clipboard', '**Central de Atendimento — SSP**')}\n\n` +
    '> Bem-vindo a Central de Atendimento da **Secretaria de Seguranca Publica**.\n' +
    '> Selecione abaixo a **corporacao** para abrir seu ticket.'
  );

  return container
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('idcard', '**Corporacoes disponiveis**')}\n` +
        `- ${emojiHelper.get('shield_pm')} **PMESP** — Policia Militar do Estado de Sao Paulo\n` +
        `- ${emojiHelper.get('shield_pc')} **PCESP** — Policia Civil do Estado de Sao Paulo\n\n` +
        `${withWhiteIcon('clipboard', '**Departamentos por corporacao**')}\n` +
        '- **Suporte Geral:** duvidas, solicitacoes e orientacao.\n' +
        '- **Denuncia:** relato de ocorrencias, infracoes e envio de provas.\n' +
        '- **Atualizacao de Registro:** correcao de nome, passaporte ou dados do RP.'
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addActionRowComponents(corpSelectMenu);
}

function createUnifiedTicketPanelPayload() {
  return {
    components: [createUnifiedTicketPanelContainer()],
    flags: MessageFlags.IsComponentsV2,
  };
}

function createTicketPanelPayload(corporation) {
  return {
    components: [createTicketPanelContainer(corporation)],
    flags: MessageFlags.IsComponentsV2,
  };
}

/**
 * Controles de moderação dentro de um canal de Ticket aberto.
 * Retorna as duas fileiras (ActionRows) padronizadas.
 *
 * @param {string} citizenId - ID do cidadão dono do ticket para a notificação de ping.
 */
function createTicketControlRows(citizenId, options = {}) {
  const { claimedBy, claimedByLabel, held, showCorregedoriaFlow = false } = options;
  const claimLabel = claimedBy
    ? `Assumido por ${claimedByLabel || 'Staff'}`
    : 'Assumir Ticket';

  const row1 = createButtonRow([
    {
      customId: `ticket_ping_${citizenId}`,
      label: 'Notificar Usuário',
      emoji: whiteEmoji('user'),
      style: ButtonStyle.Secondary,
    },
    {
      customId: 'ticket_fechar',
      label: 'Fechar Ticket',
      emoji: whiteEmoji('stop'),
      style: ButtonStyle.Secondary,
    },
    {
      customId: 'ticket_assumir',
      label: claimLabel,
      emoji: whiteEmoji('idcard'),
      style: ButtonStyle.Secondary,
      disabled: Boolean(claimedBy),
    },
  ]);

  const row2 = createButtonRow([
    {
      customId: 'ticket_espera',
      label: held ? 'Retomar Atendimento' : 'Em Espera',
      emoji: whiteEmoji('clock'),
      style: ButtonStyle.Secondary,
    },
    {
      customId: 'ticket_add_member',
      label: 'Adicionar Membro',
      emoji: whiteEmoji('user'),
      style: ButtonStyle.Secondary,
    },
    {
      customId: 'ticket_call',
      label: 'Sala de Rádio',
      emoji: whiteEmoji('refresh'),
      style: ButtonStyle.Secondary,
    },
  ]);

  const rows = [row1, row2];

  if (showCorregedoriaFlow) {
    rows.push(createButtonRow([
      {
        customId: 'ticket_corregedoria_start',
        label: 'Encerrar Denúncia',
        emoji: whiteEmoji('clipboard'),
        style: ButtonStyle.Secondary,
      },
    ]));
  }

  return rows;
}

function createTicketOpenedContainer(data) {
  const {
    userId,
    staffMention,
    departmentName = 'Suporte Geral',
    departmentKey = '',
    claimedBy,
    claimedByLabel,
    held = false,
    corporationSlug = 'pmesp',
  } = data;

  const corpLabel = String(corporationSlug || 'pmesp').toUpperCase();

  const title = held
    ? withWhiteIcon('clock', `**Atendimento em Espera — ${corpLabel}**`)
    : withWhiteIcon('clipboard', `**Atendimento Iniciado — ${corpLabel}**`);
  const statusLine = held
    ? '> **Status:** atendimento em espera. Aguarde a retomada da equipe.'
    : claimedBy
      ? `> **Status:** atendimento assumido por <@${claimedBy}>.`
      : `> **Status:** aguardando um oficial da ${corpLabel} assumir o atendimento.`;

  const header = new TextDisplayBuilder()
    .setContent(
      `${title}\n\n` +
      `Olá <@${userId}>! Bem-vindo ao seu ticket.\n` +
      `> **Corporação:** ${corpLabel}\n` +
      `> **Departamento:** ${departmentName}\n` +
      `${staffMention ? `> **Equipe acionada:** ${staffMention}\n` : ''}` +
      `${statusLine}`
    );

  const controlRows = createTicketControlRows(userId, {
    claimedBy,
    claimedByLabel,
    held,
    showCorregedoriaFlow: isComplaintDepartment(departmentName) || isComplaintDepartment(departmentKey),
  });

  const container = new ContainerBuilder()
    .setAccentColor(0x111625)
    .addTextDisplayComponents(header)
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addActionRowComponents(...controlRows)
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('user', `**Olá! <@${userId}>, seja bem-vindo ao suporte!**`)}\n` +
        '- Nossa equipe está à disposição para ajudar.\n' +
        '- Descreva o motivo do contato com detalhes e envie prints se necessário.\n' +
        '- Evite marcar a equipe repetidamente; o botão de notificação já resolve isso.'
      )
    );

  return container;
}

function createTicketOpenedPayload(data) {
  const roleIds = data.staffRoleId ? [data.staffRoleId] : [];

  return {
    components: [createTicketOpenedContainer(data)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: {
      users: [data.userId],
      roles: roleIds,
    },
  };
}

function createRegistrationUpdateGuidePayload({ userId, staffRoleId }) {
  const roleIds = staffRoleId ? [staffRoleId] : [];

  const menu = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`registro_update_select:${userId}`)
      .setPlaceholder('Selecione o dado que deseja atualizar')
      .addOptions(
        {
          label: 'Nome e Sobrenome',
          value: 'nome',
          description: 'Use [123] - Nome Sobrenome.',
          emoji: whiteEmoji('user'),
        },
        {
          label: 'Patente',
          value: 'patente',
          description: 'Informe a patente desejada para revisao.',
          emoji: whiteEmoji('idcard'),
        },
        {
          label: 'Badge',
          value: 'badge',
          description: 'Informe badge, nome e sobrenome.',
          emoji: whiteEmoji('clipboard'),
        },
        {
          label: 'Outra coisa',
          value: 'outro',
          description: 'Descreva outro ajuste de registro.',
          emoji: whiteEmoji('refresh'),
        }
      )
  );

  return {
    components: [
      new ContainerBuilder()
        .setAccentColor(0x111625)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `${withWhiteIcon('idcard', '**Atualizacao de Registro**')}\n\n` +
            `Ola <@${userId}>. Escolha abaixo o que deseja atualizar na sua credencial.\n` +
            '> **Nome e sobrenome:** informe no padrao `[123] - Nome Sobrenome`; a badge deve ter 3 numeros.\n' +
            '> **Badge:** informe badge, nome e sobrenome em campos separados; o bot monta o apelido final.\n' +
            '> **Patente:** a solicitacao sera enviada para um responsavel validar.'
          )
        )
        .addSeparatorComponents(
          new SeparatorBuilder()
            .setDivider(true)
            .setSpacing(SeparatorSpacingSize.Small)
        )
        .addActionRowComponents(menu),
    ],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: {
      users: [userId],
      roles: roleIds,
    },
  };
}

function createTicketNoticePayload({ icon = 'clipboard', title, lines = [] }) {
  return {
    components: [
      new ContainerBuilder()
        .setAccentColor(0x111625)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `${withWhiteIcon(icon, `**${title}**`)}\n\n${lines.join('\n')}`
          )
        ),
    ],
    flags: MessageFlags.IsComponentsV2,
  };
}

function createRegistrationResponsibleRequestPayload({
  mention = '',
  ownerId,
  typeLabel = 'Atualizacao de registro',
  details = 'Nao informado',
  roleIds = [],
}) {
  const container = new ContainerBuilder()
    .setAccentColor(0x2b4c7e)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('clipboard', '**Solicitacao de atualizacao de registro**')}\n\n` +
        `> **Policial:** <@${ownerId}>\n` +
        `> **Tipo:** ${limitText(typeLabel, 80)}\n` +
        `> **Detalhes:** ${limitText(details || 'Nao informado', 900)}`
      )
    );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: {
      users: ownerId ? [ownerId] : [],
      roles: roleIds,
      repliedUser: false,
    },
  };
}

function createTicketClosedPayload({ closedBy }) {
  const responsible = closedBy ? `<@${closedBy}>` : 'Painel Web';

  return createTicketNoticePayload({
    icon: 'stop',
    title: 'Atendimento Finalizado',
    lines: [
      '> **Status:** atendimento encerrado.',
      '> **Ação:** canal será arquivado e purgado em 5 segundos.',
      `> **Responsável:** ${responsible}`,
    ],
  });
}

function createTicketRadioPayload({ channel, alreadyOpen = false }) {
  return createTicketNoticePayload({
    icon: 'refresh',
    title: 'Frequência de Rádio Ativa',
    lines: [
      alreadyOpen
        ? '> **Status:** frequência de rádio já estava aberta.'
        : '> **Status:** frequência de rádio vinculada ao atendimento criada.',
      `> **Canal:** ${channel}`,
    ],
  });
}

function createTicketArchiveLogPayload({ channelName, channelId, officerId, citizenId, transcriptFilename }) {
  const ticketLabel = channelName ? `#${channelName}` : 'ticket encerrado';
  const container = new ContainerBuilder()
    .setAccentColor(0x111625)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('clipboard', '**Arquivo de Protocolo Digital**')}\n\n` +
          `Status: atendimento encerrado e transcript gerado.\n` +
          `Ticket: ${ticketLabel}\n` +
          `Oficial responsável: ${officerId ? `<@${officerId}>` : 'Painel Web'}\n` +
          `Cidadão solicitante: ${citizenId ? `<@${citizenId}>` : 'Não identificado'}\n` +
          `ID do canal: ${channelId || 'N/A'}\n` +
          `Arquivo: cópia completa do processo em HTML Transcript anexada.`
      )
    );

  if (transcriptFilename) {
    container
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addFileComponents(new FileBuilder().setURL(`attachment://${transcriptFilename}`));
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: {
      users: uniqueMentionUsers([officerId, citizenId]),
    },
  };
}

function createTicketDmCopyPayload({ ownerId, channelName, transcriptFilename }) {
  const ticketLabel = channelName ? `#${channelName}` : 'ticket encerrado';
  const container = new ContainerBuilder()
    .setAccentColor(0x111625)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('clipboard', '**Cópia de Atendimento Disponível**')}\n\n` +
          `${ownerId ? `Olá <@${ownerId}>.` : 'Olá.'}\n` +
          `Status: atendimento encerrado e transcript gerado.\n` +
          `Ticket: ${ticketLabel}\n` +
          `Arquivo: cópia completa do processo em HTML Transcript anexada.\n` +
          `Mensagem: obrigado por cooperar com a SSP.`
      )
    );

  if (transcriptFilename) {
    container
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addFileComponents(new FileBuilder().setURL(`attachment://${transcriptFilename}`));
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: {
      users: uniqueMentionUsers(ownerId ? [ownerId] : []),
    },
  };
}

function createTicketAiReportPayload(data) {
  const {
    targetMention,
    allowedMentions = { users: [], roles: [], repliedUser: false },
    citizenLabel = 'N/A',
    departmentName = 'Suporte Geral',
    complainantName = 'N/A',
    officerLabel = 'N/A',
    timeLabel = 'N/A',
    narrative = 'Não detalhado na triagem automática.',
    evidenceLines = [],
    attentionLines = [],
  } = data;
  const departmentLabel = normalizeDepartmentLabel(departmentName);

  const evidenceText = evidenceLines.length
    ? evidenceLines.map((line) => `> ${limitText(line, 260)}`).join('\n')
    : '> Nenhuma mídia ou anexo identificado.';

  const attentionText = attentionLines.length
    ? attentionLines.map((line) => `> ${limitText(line, 220)}`).join('\n')
    : '> Validar relato e provas antes de qualquer medida administrativa.';

  const container = new ContainerBuilder()
    .setAccentColor(0x111625)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('clipboard', '**Triagem automática concluída**')}\n\n` +
        `${targetMention || '**Equipe responsável**'}\n` +
        `> **Departamento:** ${departmentLabel}\n` +
        `> **Cidadão no Discord:** ${citizenLabel}`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('idcard', '**Dados coletados**')}\n` +
        `> **Denunciante:** ${limitText(complainantName, 120)}\n` +
        `> **Oficial denunciado:** ${limitText(officerLabel, 120)}\n` +
        `> **Horário aproximado:** ${limitText(timeLabel, 80)}`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('user', '**Relato do usuário**')}\n> ${limitText(narrative, 900)}`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('clipboard', '**Mídias e anexos**')}\n${evidenceText}`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('clock', '**Atenção do responsável**')}\n${attentionText}`
      )
    );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions,
  };
}

const CORREGEDORIA_VOTE_OPTIONS = [
  { value: 'verbal', label: 'Verbal' },
  { value: 'adv1', label: 'ADV 1' },
  { value: 'adv2', label: 'ADV 2' },
  { value: 'adv3', label: 'ADV 3' },
  { value: 'arquivar', label: 'Arquivar' },
];
const CORREGEDORIA_DURATION_OPTIONS = [
  { value: 'd7', label: '7 dias' },
  { value: 'd15', label: '15 dias' },
  { value: 'd30', label: '30 dias' },
  { value: 'd60', label: '60 dias' },
  { value: 'permanent', label: 'Permanente' },
];

function formatDateTime(value) {
  if (!value) return 'N/A';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return `<t:${Math.floor(date.getTime() / 1000)}:f>`;
}

function createCorregedoriaCasePayload(data) {
  const {
    caseNumber = 'COR-N/A',
    status = 'voting',
    accusedMention = 'Não informado',
    accusedLabel = 'Não informado',
    accusedRpId = 'Não informado',
    rankLabel = 'Não informado',
    reporterLabel = 'Não informado',
    ticketChannelMention = 'Canal não informado',
    createdByMention = 'Não informado',
    summary = 'Sem resumo informado.',
    transcriptFilename = '',
    voteCounts = {},
    todayVoteCounts = {},
    durationVoteCounts = {},
    todayDurationVoteCounts = {},
    caseVoteTotal = 0,
    todayVoteTotal = 0,
    durationVoteTotal = 0,
    todayDurationVoteTotal = 0,
    winningLabel = 'Sem votos',
    winningDurationLabel = 'Sem votos',
    selectedPenaltyLabel = '',
    durationDays = null,
    durationPermanent = false,
    expiresAt = null,
    appliedByMention = '',
  } = data;

  const statusLabel = status === 'applied'
    ? `Advertência aplicada: ${selectedPenaltyLabel || winningLabel}`
    : status === 'archived'
      ? 'Caso arquivado sem advertência aplicada'
      : `Votacao aberta | tipo: ${winningLabel} | duracao: ${winningDurationLabel}`;

  const voteLines = CORREGEDORIA_VOTE_OPTIONS.map((option) => (
    `> **${option.label}:** ${Number(voteCounts[option.value] || 0)} voto(s)`
  ));
  const durationVoteLines = CORREGEDORIA_DURATION_OPTIONS.map((option) => (
    `> **${option.label}:** ${Number(durationVoteCounts[option.value] || 0)} voto(s)`
  ));
  const todayVoteLines = CORREGEDORIA_VOTE_OPTIONS.map((option) => (
    `> **Hoje - ${option.label}:** ${Number(todayVoteCounts[option.value] || 0)} voto(s)`
  ));
  const todayDurationVoteLines = CORREGEDORIA_DURATION_OPTIONS.map((option) => (
    `> **Hoje - ${option.label}:** ${Number(todayDurationVoteCounts[option.value] || 0)} voto(s)`
  ));

  const resultLines = [
    `> **Status:** ${statusLabel}`,
    durationPermanent ? '> **Duracao:** Permanente' : durationDays ? `> **Duracao:** ${durationDays} dia(s)` : null,
    expiresAt ? `> **Expira em:** ${formatDateTime(expiresAt)}` : null,
    appliedByMention ? `> **Aplicado por:** ${appliedByMention}` : null,
  ].filter(Boolean);

  const container = new ContainerBuilder()
    .setAccentColor(status === 'voting' ? 0x2b4c7e : status === 'applied' ? 0x2f6f3e : 0x6f2f2f);

  const headerContent = `${withWhiteIcon('clipboard', `**Caso de Corregedoria ${caseNumber}**`)}\n\n` +
    `${resultLines.join('\n')}`;

  addLogoThumbnailToContainer(container, headerContent)
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('user', '**Oficial denunciado**')}\n` +
        `> **Discord:** ${accusedMention} (${limitText(accusedLabel, 80)})\n` +
        `> **Badge/Nome:** ${limitText(accusedRpId, 80)}\n` +
        `> **Patente/Cargo:** ${rankLabel}`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('idcard', '**Origem da denúncia**')}\n` +
        `> **Denunciante:** ${limitText(reporterLabel, 120)}\n` +
        `> **Ticket:** ${ticketChannelMention}\n` +
        `> **Encaminhado por:** ${createdByMention}\n` +
        `> **Transcript:** ${transcriptFilename || 'Não anexado'}`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('clipboard', '**Resumo administrativo**')}\n> ${limitText(summary, 900)}`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('clock', '**Votacao - tipo de advertencia**')}\n${voteLines.join('\n')}`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('calendar', '**Votacao - duracao**')}\n${durationVoteLines.join('\n')}`
      )
    );

  container
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('calendar', '**Resumo de votos do dia**')}\n` +
        `> **Total tipo:** ${Number(caseVoteTotal || 0)} voto(s)\n` +
        `> **Hoje tipo:** ${Number(todayVoteTotal || 0)} voto(s)\n` +
        `${todayVoteLines.join('\n')}\n` +
        `> **Total duracao:** ${Number(durationVoteTotal || 0)} voto(s)\n` +
        `> **Hoje duracao:** ${Number(todayDurationVoteTotal || 0)} voto(s)\n` +
        `${todayDurationVoteLines.join('\n')}`
      )
    );

  if (status === 'voting') {
    container
      .addSeparatorComponents(
        new SeparatorBuilder()
          .setDivider(true)
          .setSpacing(SeparatorSpacingSize.Small)
      )
      .addActionRowComponents(createButtonRow(CORREGEDORIA_VOTE_OPTIONS.map((option) => ({
        customId: `corr_vote_${option.value}`,
        label: `${option.label} (${Number(voteCounts[option.value] || 0)})`,
        emoji: whiteEmoji(option.value === 'arquivar' ? 'stop' : 'idcard'),
        style: option.value === 'arquivar' ? ButtonStyle.Secondary : ButtonStyle.Secondary,
      }))))
      .addActionRowComponents(createButtonRow(CORREGEDORIA_DURATION_OPTIONS.map((option) => ({
        customId: `corr_duration_${option.value}`,
        label: `${option.label} (${Number(durationVoteCounts[option.value] || 0)})`,
        emoji: whiteEmoji(option.value === 'permanent' ? 'stop' : 'clock'),
        style: ButtonStyle.Secondary,
      }))))
      .addActionRowComponents(createButtonRow([
        {
          customId: 'corr_apply_result',
          label: 'Aplicar Resultado',
          emoji: whiteEmoji('check'),
          style: ButtonStyle.Secondary,
        },
      ]));
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: {
      users: uniqueMentionUsers([data.accusedUserId, data.createdById, data.appliedById]),
      roles: uniqueMentionUsers([data.rankRoleId]),
      repliedUser: false,
    },
  };
}

/**
 * Painel de Recrutamento/Edital: Iniciar Candidatura e Ver Requisitos.
 */
function createEditalPanelButtons(corporation) {
  const suffix = corporation ? `:${corporation.slug}` : '';
  return createButtonRow([
    {
      customId: `edital_iniciar${suffix}`,
      label: 'Iniciar Candidatura',
      emoji: whiteEmoji('clipboard'),
      style: ButtonStyle.Secondary,
    },
    {
      customId: `edital_requisitos${suffix}`,
      label: 'Ver Requisitos',
      emoji: whiteEmoji('idcard'),
      style: ButtonStyle.Secondary,
    },
  ]);
}

function createEditalPanelContainer(corporation) {
  const corpName = corporation ? corporation.shortName : 'SSP';
  const accentColor = corporation ? parseInt(corporation.color.replace('#', ''), 16) : 0x111625;

  const container = new ContainerBuilder()
    .setAccentColor(accentColor);

  addLogoThumbnailToContainer(
    container,
    `${withWhiteIcon('clipboard', `**Processo Seletivo ${corpName}**`)}\n\n` +
    '> A Academia está recebendo novas candidaturas.\n' +
    '> Inicie sua inscrição, preencha as etapas e envie para análise da equipe.'
  );

  return container
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('idcard', '**Antes de começar**')}\n` +
        '- Tenha seus dados de RP em mãos.\n' +
        '- Para obter seu Citizen ID, esteja na cidade e digite `/citizen`.\n' +
        '- Responda com atenção, clareza e postura profissional.\n' +
        '- Candidaturas incompletas ou superficiais podem ser recusadas.'
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addActionRowComponents(createEditalPanelButtons(corporation));
}

/**
 * Painel de Edital UNIFICADO: seleciona corporação primeiro.
 * Usado quando não há corporação definida (painel único para PMESP + PCESP).
 */
function createUnifiedEditalPanelContainer() {
  const emojiHelper = require('./emojiHelper');
  const pmEmoji = emojiHelper.getRaw('shield_pm');
  const pcEmoji = emojiHelper.getRaw('shield_pc');

  const corpSelectMenu = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('selecionar_corp_edital')
      .setPlaceholder('Selecione a corporacao para se candidatar...')
      .addOptions(
        {
          label: 'PMESP — Policia Militar',
          value: 'pmesp',
          description: 'Candidatar-se a Policia Militar do Estado de SP.',
          emoji: pmEmoji,
        },
        {
          label: 'PCESP — Policia Civil',
          value: 'pcesp',
          description: 'Candidatar-se a Policia Civil do Estado de SP.',
          emoji: pcEmoji,
        }
      )
  );

  const container = new ContainerBuilder()
    .setAccentColor(0x111625);

  addLogoThumbnailToContainer(
    container,
    `${withWhiteIcon('clipboard', '**Processo Seletivo — SSP**')}\n\n` +
    '> A Secretaria de Seguranca Publica esta recebendo novas candidaturas.\n' +
    '> Selecione abaixo a **corporacao** na qual deseja ingressar.'
  );

  return container
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('idcard', '**Corporacoes com vagas abertas**')}\n` +
        `- ${emojiHelper.get('shield_pm')} **PMESP** — Policia Militar do Estado de Sao Paulo\n` +
        `- ${emojiHelper.get('shield_pc')} **PCESP** — Policia Civil do Estado de Sao Paulo\n\n` +
        `${withWhiteIcon('clipboard', '**Antes de começar**')}\n` +
        '- Tenha seus dados de RP em mãos.\n' +
        '- Para obter seu Citizen ID, esteja na cidade e digite `/citizen`.\n' +
        '- Responda com atenção, clareza e postura profissional.\n' +
        '- Candidaturas incompletas ou superficiais podem ser recusadas.'
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addActionRowComponents(corpSelectMenu);
}

function createUnifiedEditalPanelPayload() {
  return {
    components: [createUnifiedEditalPanelContainer()],
    flags: MessageFlags.IsComponentsV2,
  };
}

function createEditalPanelPayload(corporation) {
  return {
    components: [createEditalPanelContainer(corporation)],
    flags: MessageFlags.IsComponentsV2,
  };
}

/**
 * Botões de fluxo interativo do Edital (Rascunho).
 *
 * @param {number} respondidasTotal - Total de perguntas respondidas.
 * @param {number} totalPerguntas - Total de perguntas existentes no edital.
 */
function createEditalDraftButtons(respondidasTotal, totalPerguntas) {
  return createButtonRow([
    {
      customId: 'finalizar_envio_lspd',
      label: respondidasTotal < totalPerguntas
        ? `Preencha as ${totalPerguntas} etapas para enviar`
        : 'Finalizar e enviar formulário',
      emoji: respondidasTotal < totalPerguntas ? whiteEmoji('clock') : whiteEmoji('check'),
      style: ButtonStyle.Secondary,
      disabled: respondidasTotal < totalPerguntas,
    },
    {
      customId: 'edital_cancelar',
      label: 'Cancelar',
      emoji: whiteEmoji('stop'),
      style: ButtonStyle.Secondary,
    },
  ]);
}

/**
 * Menu de seleção de perguntas do Edital.
 *
 * @param {Array<Object>} opcoes - Opções do menu.
 */
function createEditalDraftMenu(opcoes) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('selecionar_pergunta_lspd')
      .setPlaceholder('Selecione uma etapa para preencher...')
      .addOptions(opcoes)
  );
}

function createEditalDraftPayload(data) {
  const {
    rascunho,
    perguntas,
    opcoes,
    respondidasTotal,
    totalPerguntas,
    progressBar,
  } = data;

  const respostas = perguntas.map((p) => {
    const jaRespondeu = Boolean(rascunho.respostas[p.id]);
    let respostaPreview = jaRespondeu
      ? rascunho.respostas[p.id].replace(/\s+/g, ' ').trim()
      : 'Aguardando preenchimento...';

    if (respostaPreview.length > 140) {
      respostaPreview = `${respostaPreview.substring(0, 137)}...`;
    }

    const statusIcon = jaRespondeu ? whiteIcon('check') : whiteIcon('clock');
    const statusLabel = `${jaRespondeu ? 'Respondida' : 'Pendente'} | ${p.label}`;
    return `${statusIcon ? `${statusIcon} ` : ''}**${statusLabel}**\n> ${respostaPreview}`;
  }).join('\n\n');

  const container = new ContainerBuilder()
    .setAccentColor(0x111625)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('clipboard', '**Inscrição em Curso**')}\n\n` +
        '> Preencha todas as etapas pelo menu abaixo. O rascunho é atualizado a cada resposta.'
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('clock', '**Progresso:**')} \`[${progressBar}]\` (${respondidasTotal}/${totalPerguntas})\n` +
        `${withWhiteIcon('user', '**Nome RP:**')} \`${rascunho.nome}\`\n` +
        `${withWhiteIcon('idcard', '**Citizen ID:**')} \`${rascunho.citizen}\`\n` +
        `${withWhiteIcon('calendar', '**Idade:**')} \`${rascunho.idade} anos\``
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${withWhiteIcon('clipboard', '**Revisão das respostas**')}\n\n${respostas}`)
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addActionRowComponents(createEditalDraftMenu(opcoes))
    .addActionRowComponents(createEditalDraftButtons(respondidasTotal, totalPerguntas));

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

function createEditalRequirementsPayload() {
  return {
    components: [
      new ContainerBuilder()
        .setAccentColor(0x111625)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `${withWhiteIcon('idcard', '**Requisitos para ingressar na corporação**')}\n\n` +
            '- **Idade RP:** ter 18 anos ou mais.\n' +
            '- **Comunicação:** possuir microfone funcional e Discord/Teamspeak.\n' +
            '- **Conhecimento:** conhecer regras da cidade, códigos operacionais e conduta básica.\n' +
            '- **Ficha limpa:** não possuir antecedentes graves registrados.\n' +
            '- **Postura:** respeitar hierarquia, disciplina e profissionalismo.\n\n' +
            '*Boa sorte na sua candidatura.*'
          )
        ),
    ],
    flags: MessageFlags.IsComponentsV2,
  };
}

function createEditalSubmissionPayload() {
  return {
    components: [
      new ContainerBuilder()
        .setAccentColor(0x111625)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `${withWhiteIcon('check', '**Submissão Confirmada**')}\n\n` +
            'Sua candidatura foi entregue na Central de Recrutamento.\n' +
            'O resultado será publicado no canal correspondente. Mantenha suas comunicações ativas.'
          )
        ),
    ],
    flags: MessageFlags.IsComponentsV2,
  };
}

function createEditalPreApprovalResultPayload({
  candidateId,
  recruiterId,
  citizen = 'N/A',
  nomeRp = 'N/A',
  ticketChannelId = '',
  candidateAvatarUrl = null,
}) {
  const ticketLine = ticketChannelId
    ? `> **Atendimento:** <#${ticketChannelId}>`
    : '> **Atendimento:** aguarde contato da equipe superior.';

  const header = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('check', '**Pré-aprovação no Processo Seletivo**')}\n\n` +
        `Saudações, <@${candidateId}>.\n` +
        'Sua candidatura foi deferida na etapa de edital, mas o ingresso ainda depende da etapa presencial com um superior.\n\n' +
        '> **Status:** pré-aprovado para entrevista/integração.\n' +
        '> **Próximo passo:** compareça à DP e marque um horário com um superior.\n' +
        '> **Tags/cargos:** não foram liberados automaticamente.\n' +
        ticketLine
      )
    );

  if (candidateAvatarUrl) {
    header.setThumbnailAccessory(
      new ThumbnailBuilder()
        .setURL(candidateAvatarUrl)
        .setDescription('Avatar do candidato')
    );
  }

  const container = new ContainerBuilder()
    .setAccentColor(0x2f6f3e)
    .addSectionComponents(header)
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('user', '**Dados do candidato**')}\n` +
        `> **Nome RP:** ${limitText(nomeRp, 80)}\n` +
        `> **Citizen ID:** ${limitText(citizen, 40)}\n` +
        `> **Responsável:** <@${recruiterId}>`
      )
    );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: {
      users: uniqueMentionUsers([candidateId, recruiterId]),
      roles: [],
      repliedUser: false,
    },
  };
}

function createEditalRejectionResultPayload({
  candidateId,
  recruiterId,
  citizen = 'N/A',
  nomeRp = 'N/A',
  candidateAvatarUrl = null,
}) {
  const header = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('stop', '**Indeferido no Processo Seletivo**')}\n\n` +
        `Olá, <@${candidateId}>.\n` +
        'Agradecemos seu interesse em ingressar no departamento, contudo, informamos que seu formulário foi **INDEFERIDO** nesta edição.\n\n' +
        '> **Status:** reprovado.\n' +
        '> **Nota:** Não desanime. Estude os regulamentos e códigos de conduta da corporação e submeta um novo formulário na abertura do próximo edital.'
      )
    );

  if (candidateAvatarUrl) {
    header.setThumbnailAccessory(
      new ThumbnailBuilder()
        .setURL(candidateAvatarUrl)
        .setDescription('Avatar do candidato')
    );
  }

  const container = new ContainerBuilder()
    .setAccentColor(0xD50000)
    .addSectionComponents(header)
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('user', '**Dados do candidato**')}\n` +
        `> **Nome RP:** ${limitText(nomeRp, 80)}\n` +
        `> **Citizen ID:** ${limitText(citizen, 40)}\n` +
        `> **Responsável:** <@${recruiterId}>`
      )
    );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: {
      users: uniqueMentionUsers([candidateId, recruiterId]),
      roles: [],
      repliedUser: false,
    },
  };
}

function createEditalPreApprovalTicketPayload({
  candidateId,
  recruiterId,
  citizen = 'N/A',
  nomeRp = 'N/A',
}) {
  const cleanNome = nomeRp.replace(/_/g, ' ');
  return {
    components: [
      new ContainerBuilder()
        .setAccentColor(0x2b4c7e)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `${withWhiteIcon('clipboard', '**Atendimento de Pré-aprovação**')}\n\n` +
            `O candidato <@${candidateId}> foi pré-aprovado no edital.\n` +
            '> **Próximo passo:** alinhar um horário para comparecer à DP com um superior.\n' +
            '> **Importante:** clique no botão abaixo após a entrevista presencial para liberar cargos e apelido.'
          )
        )
        .addSeparatorComponents(
          new SeparatorBuilder()
            .setDivider(true)
            .setSpacing(SeparatorSpacingSize.Small)
        )
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `${withWhiteIcon('idcard', '**Dados de admissão**')}\n` +
            `> **Nome RP:** ${limitText(cleanNome, 80)}\n` +
            `> **Citizen ID:** ${limitText(citizen, 40)}\n` +
            `> **Aprovado por:** <@${recruiterId}>`
          )
        )
        .addSeparatorComponents(
          new SeparatorBuilder()
            .setDivider(true)
            .setSpacing(SeparatorSpacingSize.Small)
        )
        .addActionRowComponents(createButtonRow([
          {
            customId: `edital_setar_tags_${candidateId}_${citizen}_${cleanNome}`,
            label: 'Atribuir Cargos/Apelido',
            emoji: whiteEmoji('check'),
            style: ButtonStyle.Secondary,
          }
        ])),
    ],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: {
      users: uniqueMentionUsers([candidateId, recruiterId]),
      roles: [],
      repliedUser: false,
    },
  };
}

function createEditalCancelPayload() {
  return {
    components: [
      new ContainerBuilder()
        .setAccentColor(0x111625)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `${withWhiteIcon('stop', '**Inscrição Cancelada**')}\n\n` +
            'A sua candidatura foi cancelada e o rascunho foi removido do sistema.'
          )
        ),
    ],
    flags: MessageFlags.IsComponentsV2,
  };
}

/**
 * Painel de Administração.
 */
function createAdminPanelButtons() {
  return createButtonRow([
    {
      customId: 'config_reload',
      label: 'Recarregar Configuração',
      emoji: '🔄',
      style: ButtonStyle.Secondary,
    },
  ]);
}

module.exports = {
  createButtonRow,
  createPontoPanelButtons,
  createPontoPanelContainer,
  createPontoPanelPayload,
  createPontoStatusContainer,
  createPontoStatusPayload,
  createPontoLogContainer,
  createPontoLogPayload,
  createTicketDepartmentMenu,
  createTicketPanelButtons,
  createTicketPanelContainer,
  createTicketPanelPayload,
  createTicketControlRows,
  createTicketOpenedContainer,
  createTicketOpenedPayload,
  createRegistrationUpdateGuidePayload,
  createRegistrationResponsibleRequestPayload,
  createTicketClosedPayload,
  createTicketRadioPayload,
  createTicketArchiveLogPayload,
  createTicketDmCopyPayload,
  createTicketAiReportPayload,
  createCorregedoriaCasePayload,
  createEditalPanelButtons,
  createEditalPanelContainer,
  createEditalPanelPayload,
  createEditalDraftButtons,
  createEditalDraftMenu,
  createEditalDraftPayload,
  createEditalRequirementsPayload,
  createEditalSubmissionPayload,
  createEditalPreApprovalResultPayload,
  createEditalPreApprovalTicketPayload,
  createEditalCancelPayload,
  createAdminPanelButtons,
};

function createAusenciaPanelButtons(corporation) {
  const suffix = corporation ? `:${corporation.slug}` : '';
  return createButtonRow([
    {
      customId: `ausencia_solicitar${suffix}`,
      label: 'Solicitar Ausência',
      emoji: whiteEmoji('clipboard') || '📝',
      style: ButtonStyle.Secondary,
    },
  ]);
}

function createAusenciaPanelContainer(corporation) {
  const corpName = corporation ? ` — ${corporation.shortName}` : '';
  const accentColor = corporation ? parseInt(corporation.color.replace('#', ''), 16) : 0x111625;

  const container = new ContainerBuilder()
    .setAccentColor(accentColor);

  addLogoThumbnailToContainer(
    container,
    `${withWhiteIcon('clipboard', `**Registro de Ausência / Licença${corpName}**`)}\n\n` +
    '> Caso precise se afastar de suas atividades policiais por um período determinado, registre sua solicitação por meio deste terminal.\n\n' +
    '• *Todas as solicitações de ausência são enviadas para avaliação do Comando.*\n' +
    '• *Justifique adequadamente a sua ausência para evitar indeferimento.*'
  );

  return container
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addActionRowComponents(createAusenciaPanelButtons(corporation));
}

function createAusenciaPanelPayload(corporation) {
  return {
    components: [createAusenciaPanelContainer(corporation)],
    flags: MessageFlags.IsComponentsV2,
  };
}

function createAusenciaEvaluationPayload(data) {
  const checkEmoji = whiteEmoji('check') || '✅';
  const stopEmoji = whiteEmoji('stop') || '❌';

  const body = [
    `**Policial:** <@${data.userId}> — **${data.displayName}**`,
    `> **Citizen ID:** \`${data.passaporte}\``,
    `> **Período:** de \`${data.dataInicio}\` a \`${data.dataFim}\``,
    `> **Duração:** \`${data.duracaoDias} dia(s)\``,
    `> **Motivo:** ${data.motivo}`
  ].join('\n');

  const container = new ContainerBuilder()
    .setAccentColor(0x111625)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('clipboard', '**Solicitação de Ausência / Licença**')}\n\n` +
        `Status: **Aguardando Análise do Comando**\n` +
        `Data do Envio: <t:${Math.floor(Date.now() / 1000)}:f>`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    );

  const logoUrl = require('../config/embeds').design.logo;
  const finalThumbnail = data.avatarURL || (logoUrl && logoUrl.startsWith('http') ? logoUrl : null);

  if (finalThumbnail) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(body))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(finalThumbnail))
    );
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(body)
    );
  }

  container
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addActionRowComponents(
      createButtonRow([
        {
          customId: `ausencia_aprovar_${data.id}`,
          label: 'Aprovar Ausência',
          emoji: checkEmoji,
          style: ButtonStyle.Success,
        },
        {
          customId: `ausencia_reprovar_${data.id}`,
          label: 'Reprovar Ausência',
          emoji: stopEmoji,
          style: ButtonStyle.Danger,
        }
      ])
    );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

function createAusenciaResultPayload(data, status) {
  const isApproved = status === 'aprovado';
  const accentColor = isApproved ? 0x00E676 : 0xD50000;
  const statusLabel = isApproved ? 'Ausência Aprovada' : 'Ausência Reprovada';
  const statusEmoji = isApproved ? 'check' : 'stop';

  const bodyLines = [
    `**Policial:** <@${data.userId}> — **${data.displayName}**`,
    `> **Citizen ID:** \`${data.passaporte}\``,
    `> **Período:** de \`${data.dataInicio}\` a \`${data.dataFim}\``,
    `> **Duração:** \`${data.duracaoDias} dia(s)\``,
    `> **Motivo original:** ${data.motivo}`,
    ''
  ];

  if (isApproved) {
    bodyLines.push(`> **Aprovado por:** <@${data.moderatorId}>`);
  } else {
    bodyLines.push(`> **Reprovado por:** <@${data.moderatorId}>`);
    bodyLines.push(`> **Motivo do Indeferimento:** ${data.motivoReprovacao || 'Não justificado'}`);
  }

  const container = new ContainerBuilder()
    .setAccentColor(accentColor)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon(statusEmoji, `**${statusLabel}**`)}\n\n` +
        `A decisão sobre o seu afastamento foi registrada.`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    );

  const bodyText = bodyLines.join('\n');

  const logoUrl = require('../config/embeds').design.logo;
  const finalThumbnail = data.avatarURL || (logoUrl && logoUrl.startsWith('http') ? logoUrl : null);

  if (finalThumbnail) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(bodyText))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(finalThumbnail))
    );
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(bodyText)
    );
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

function createEditalEvaluationPayload(data, status = 'pending') {
  const checkEmoji = whiteEmoji('check') || '✅';
  const stopEmoji = whiteEmoji('stop') || '❌';

  // Preparar cada resposta individualmente (sem truncar)
  const answerEntries = data.respostas.map((p) => {
    let resp = p.resposta || '⚠️ *Deixado em branco*';
    // Limitar a 1800 chars por resposta para segurança (Discord TextDisplay max = 4096)
    if (resp.length > 1800) resp = resp.substring(0, 1797) + '...';
    return { pergunta: p.pergunta, resposta: resp };
  });

  let statusText = 'Status: **Aguardando Avaliação da Staff**';
  let accentColor = 0x111625;
  if (status === 'approved') {
    statusText = `Status: **Pré-Aprovado por ${data.moderatorName || 'Staff'}**`;
    accentColor = 0x2f6f3e;
  } else if (status === 'rejected') {
    statusText = `Status: **Reprovado por ${data.moderatorName || 'Staff'}**`;
    accentColor = 0x6f2f2f;
  }

  const container = new ContainerBuilder()
    .setAccentColor(accentColor);

  const headerContent = `${withWhiteIcon('clipboard', '**Ficha de Recrutamento — Análise**')}\n\n` +
    `${statusText}\n` +
    `Data do Envio: <t:${Math.floor(Date.now() / 1000)}:f>`;

  if (data.candidateAvatarUrl) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerContent))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(data.candidateAvatarUrl).setDescription('Avatar do candidato'))
    );
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(headerContent)
    );
  }
  container
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Candidato:** <@${data.candidateId}> (Discord ID: \`${data.candidateId}\`)\n` +
        `> **Nome RP:** \`${data.nomeRp || 'N/A'}\`\n` +
        `> **Citizen ID:** \`${data.citizen}\`\n` +
        `> **Idade Real:** \`${data.idade} anos\`\n` +
        `> **ID Discord:** \`${data.discordId}\``
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `📄 **QUESTIONÁRIO TEÓRICO RESPONDIDO:**`
      )
    );

  // Adicionar cada resposta como um TextDisplay individual para evitar truncamento
  for (const entry of answerEntries) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**${entry.pergunta}**\n> ${entry.resposta}`
      )
    );
  }

  container.addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    );

  // Truncar nomeRp no customId para não exceder 100 chars (limite Discord)
  const nomeRpForId = (data.nomeRp || '').substring(0, 30);

  if (status === 'pending') {
    container.addActionRowComponents(
      createButtonRow([
        {
          customId: `aprovar_edital_${data.candidateId}_${data.citizen}_${nomeRpForId}`,
          label: 'APROVAR CANDIDATO',
          emoji: checkEmoji,
          style: ButtonStyle.Secondary,
        },
        {
          customId: `reprovar_edital_${data.candidateId}`,
          label: 'REPROVAR CANDIDATO',
          emoji: stopEmoji,
          style: ButtonStyle.Secondary,
        }
      ])
    );
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

module.exports = {
  createEditalEvaluationPayload,
  createButtonRow,
  createPontoPanelButtons,
  createPontoPanelContainer,
  createPontoPanelPayload,
  createPontoStatusContainer,
  createPontoStatusPayload,
  createPontoLogContainer,
  createPontoLogPayload,
  createTicketDepartmentMenu,
  createTicketPanelButtons,
  createTicketPanelContainer,
  createTicketPanelPayload,
  createUnifiedTicketPanelPayload,
  createTicketControlRows,
  createTicketOpenedContainer,
  createTicketOpenedPayload,
  createRegistrationUpdateGuidePayload,
  createRegistrationResponsibleRequestPayload,
  createTicketClosedPayload,
  createTicketRadioPayload,
  createTicketArchiveLogPayload,
  createTicketDmCopyPayload,
  createTicketAiReportPayload,
  createCorregedoriaCasePayload,
  createEditalPanelButtons,
  createEditalPanelContainer,
  createEditalPanelPayload,
  createUnifiedEditalPanelPayload,
  createEditalDraftButtons,
  createEditalDraftMenu,
  createEditalDraftPayload,
  createEditalRequirementsPayload,
  createEditalSubmissionPayload,
  createEditalPreApprovalResultPayload,
  createEditalRejectionResultPayload,
  createEditalPreApprovalTicketPayload,
  createEditalCancelPayload,
  createAdminPanelButtons,
  createAusenciaPanelPayload,
  createAusenciaEvaluationPayload,
  createAusenciaResultPayload,
  createWarningPanelPayload,
  createWarningRankSelectPayload,
  createWarningOfficerSelectPayload,
  createWarningConfigPayload,
  createDirectWarningLogPayload,
  createDirectWarningDmPayload,
  createAvaliacaoPanelPayload,
  createAvaliacaoRankSelectPayload,
  createAvaliacaoOfficerSelectPayload,
  createAvaliacaoLogPayload,
  createAcademiaPanelPayload,
  createAcademiaCoursesListPayload,
  createSugestoesPanelPayload,
  createSugestaoCardPayload,
  createBlacklistPanelPayload,
  createBlacklistEntryPayload,
  createSolicitacoesPanelPayload,
  createSolicitacaoCardPayload,
  createExoneracoesPanelPayload,
  createExoneracaoCardPayload,
  createTransferenciasPanelPayload,
  createTransferenciaCardPayload,
};

function createAcademiaPanelButtons(corporation) {
  const emojiHelper = require('./emojiHelper');
  const suffix = corporation ? `:${corporation.slug}` : '';
  return createButtonRow([
    {
      customId: `academia_acessar${suffix}`,
      label: 'Acessar Academia',
      emoji: emojiHelper.getRaw('graduation'),
      style: ButtonStyle.Secondary,
    },
    {
      customId: `academia_meus_cursos${suffix}`,
      label: 'Meus Cursos',
      emoji: emojiHelper.getRaw('clipboard'),
      style: ButtonStyle.Secondary,
    },
  ]);
}

function createAcademiaPanelContainer(corporation) {
  const corpName = corporation ? corporation.shortName : 'SSP';
  const accentColor = 0x111625;

  const container = new ContainerBuilder()
    .setAccentColor(accentColor);

  addLogoThumbnailToContainer(
    container,
    `${withWhiteIcon('clipboard', `**Academia ${corpName} — Central de Treinamentos**`)}\n\n` +
    `> A Academia ${corpName} é o centro de capacitação e treinamento da corporação.\n` +
    '> Ministradores podem abrir aulas e os membros se candidatam pelo Discord.\n\n' +
    '• *Clique em **Acessar Academia** para ministrar um curso (Cabo+).*\n' +
    '• *Clique em **Meus Cursos** para ver seus cursos concluídos.*'
  );

  return container
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('idcard', '**Como funciona?**')}\n` +
        '- 📢 O ministrador seleciona o curso e define o horário de término.\n' +
        '- 📋 Um anúncio é enviado e os membros podem se candidatar.\n' +
        '- ⏰ No horário definido, a aula encerra automaticamente.\n' +
        '- ✅ Os participantes recebem o cargo do curso automaticamente.'
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addActionRowComponents(createAcademiaPanelButtons(corporation));
}

function createAcademiaPanelPayload(corporation) {
  return {
    components: [createAcademiaPanelContainer(corporation)],
    flags: MessageFlags.IsComponentsV2,
  };
}

function createAcademiaCoursesListPayload({ corpName, courseLines, courses, enrolledCourses }) {
  const container = new ContainerBuilder()
    .setAccentColor(0x111625)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('clipboard', `**Cursos Disponíveis — ${corpName}**`)}\n\n` +
        courseLines.join('\n\n')
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    );

  // Adicionar botões de matrícula para cursos não matriculados
  const buttons = [];
  courses.forEach((course, i) => {
    if (!enrolledCourses.has(course.name)) {
      buttons.push({
        customId: `academia_matricular_${i}`,
        label: (course.roleName.split(' ┃ ')[1] || course.name).substring(0, 80),
        emoji: '📚',
        style: ButtonStyle.Secondary,
      });
    }
  });

  // Discord limita a 5 botões por ActionRow
  if (buttons.length > 0) {
    for (let i = 0; i < buttons.length; i += 5) {
      const chunk = buttons.slice(i, i + 5);
      container.addActionRowComponents(createButtonRow(chunk));
    }
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `\n✅ *Você já está matriculado em todos os cursos disponíveis!*`
      )
    );
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

function createWarningPanelButtons(corporation) {
  const emojiHelper = require('./emojiHelper');
  const suffix = corporation ? `:${corporation.slug}` : '';
  return createButtonRow([
    {
      customId: `warning_aplicar${suffix}`,
      label: 'Aplicar Advertência',
      emoji: emojiHelper.getRaw('warning'),
      style: ButtonStyle.Secondary,
    },
  ]);
}

function createWarningPanelContainer(corporation) {
  const corpName = corporation ? ` — ${corporation.shortName}` : '';
  const accentColor = 0x111625;

  const container = new ContainerBuilder()
    .setAccentColor(accentColor);

  addLogoThumbnailToContainer(
    container,
    `${withWhiteIcon('stop', `**Central de Advertências e Punições${corpName}**`)}\n\n` +
    '> Painel destinado ao Comando e Corregedoria para aplicação direta de advertências e punições a oficiais.\n\n' +
    '• *Selecione a patente do oficial para filtrar.*\n' +
    '• *Selecione o oficial, em seguida o nível da advertência e a duração.*\n' +
    '• *Justifique adequadamente toda punição aplicada.*'
  );

  return container
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addActionRowComponents(createWarningPanelButtons(corporation));
}

function createWarningPanelPayload(corporation) {
  return {
    components: [createWarningPanelContainer(corporation)],
    flags: MessageFlags.IsComponentsV2,
  };
}

function createWarningRankSelectPayload(options) {
  const rankSelect = new StringSelectMenuBuilder()
    .setCustomId('warning_rank_select')
    .setPlaceholder('Selecione a patente/cargo do oficial')
    .addOptions(options);

  return {
    content: '📋 Selecione a patente/cargo do oficial que deseja advertir:',
    components: [new ActionRowBuilder().addComponents(rankSelect)],
    ephemeral: true,
  };
}

function createWarningOfficerSelectPayload(roleId, options) {
  const officerSelect = new StringSelectMenuBuilder()
    .setCustomId(`warning_officer_select:${roleId}`)
    .setPlaceholder('Selecione o oficial')
    .addOptions(options);

  return {
    content: '👤 Selecione o oficial correspondente para aplicar a punição:',
    components: [new ActionRowBuilder().addComponents(officerSelect)],
    ephemeral: true,
  };
}

function createWarningConfigPayload(userId, level, duration) {
  const levelSelect = new StringSelectMenuBuilder()
    .setCustomId(`warning_level_select:${userId}:${level}:${duration}`)
    .setPlaceholder('Selecione o nível da advertência')
    .addOptions([
      { label: 'Advertência Verbal', value: 'verbal', default: level === 'verbal' },
      { label: 'ADV 1', value: 'adv1', default: level === 'adv1' },
      { label: 'ADV 2', value: 'adv2', default: level === 'adv2' },
      { label: 'ADV 3', value: 'adv3', default: level === 'adv3' }
    ]);

  const durationSelect = new StringSelectMenuBuilder()
    .setCustomId(`warning_duration_select:${userId}:${level}:${duration}`)
    .setPlaceholder('Selecione a duração da advertência')
    .addOptions([
      { label: '7 dias', value: 'd7', default: duration === 'd7' },
      { label: '15 dias', value: 'd15', default: duration === 'd15' },
      { label: '30 dias', value: 'd30', default: duration === 'd30' },
      { label: '60 dias', value: 'd60', default: duration === 'd60' },
      { label: 'Permanente', value: 'permanent', default: duration === 'permanent' }
    ]);

  const proceedBtn = new ButtonBuilder()
    .setCustomId(`warning_proceed_btn:${userId}:${level}:${duration}`)
    .setLabel('Prosseguir para Justificativa')
    .setStyle(ButtonStyle.Success)
    .setEmoji('📝');

  const row1 = new ActionRowBuilder().addComponents(levelSelect);
  const row2 = new ActionRowBuilder().addComponents(durationSelect);
  const row3 = new ActionRowBuilder().addComponents(proceedBtn);

  return {
    content: `⚙️ **Configuração da Punição**\n\nConfigure o nível e a duração para aplicar em <@${userId}>:`,
    components: [row1, row2, row3],
    ephemeral: true,
  };
}

function createDirectWarningLogPayload(data) {
  const accentColor = 0xD50000;
  const container = new ContainerBuilder()
    .setAccentColor(accentColor)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('stop', `**Punição Aplicada Diretamente — ${data.caseNumber}**`)}\n\n` +
        `Uma nova advertência administrativa foi registrada no sistema.`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('user', '**Policial Punido**')}\n` +
        `> **Discord:** <@${data.userId}> (${data.userTag})\n` +
        `> **Nível:** **${data.penaltyLabel}**\n` +
        `> **Duração:** \`${data.durationLabel}\` (expira em: ${data.expiresAt ? `<t:${Math.floor(data.expiresAt.getTime() / 1000)}:f>` : '`Permanente`'})\n` +
        `> **Aplicado por:** <@${data.appliedBy}>`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('clipboard', '**Motivo administrativo**')}\n> ${data.reason}`
      )
    );

  const logoUrl = require('../config/embeds').design.logo;
  const finalThumbnail = data.avatarURL || (logoUrl && logoUrl.startsWith('http') ? logoUrl : null);

  if (finalThumbnail) {
    container.addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    );
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `**Status da Punição:** \`Ativa\`\n` +
            `**Identificador:** \`${data.caseNumber}\``
          )
        )
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(finalThumbnail))
    );
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

function createDirectWarningDmPayload(data) {
  const accentColor = 0xD50000;
  const container = new ContainerBuilder()
    .setAccentColor(accentColor)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('stop', `**DEPARTAMENTO DE POLÍCIA DE LOS SANTOS • NOTIFICAÇÃO DISCIPLINAR**`)}\n\n` +
        `Prezado(a) <@${data.userId}>,\n\n` +
        `Informamos que foi aplicada uma penalidade administrativa diretamente em sua ficha de serviço.`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('idcard', '**Detalhes da advertência**')}\n` +
        `> **Identificador:** \`${data.caseNumber}\`\n` +
        `> **Nível:** **${data.penaltyLabel}**\n` +
        `> **Duração:** \`${data.durationLabel}\` (expira em: ${data.expiresAt ? `<t:${Math.floor(data.expiresAt.getTime() / 1000)}:f>` : '`Permanente`'})\n` +
        `> **Aplicado por:** <@${data.appliedBy}>`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('clipboard', '**Motivo da Punição**')}\n> ${data.reason}`
      )
    );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

function createAvaliacaoPanelButtons(corporation) {
  const emojiHelper = require('./emojiHelper');
  const suffix = corporation ? `:${corporation.slug}` : '';
  return createButtonRow([
    {
      customId: `avaliacao_iniciar${suffix}`,
      label: 'Avaliar Oficial',
      emoji: emojiHelper.getRaw('evaluation'),
      style: ButtonStyle.Secondary,
    },
  ]);
}

function createAvaliacaoPanelContainer(corporation) {
  const corpName = corporation ? ` — ${corporation.shortName}` : '';
  const accentColor = 0x111625;

  const container = new ContainerBuilder()
    .setAccentColor(accentColor);

  addLogoThumbnailToContainer(
    container,
    `${withWhiteIcon('star', `**Central de Avaliação de Oficiais${corpName}**`)}\n\n` +
    '> Espaço destinado a oficiais **Cabo ou superior** da **PMESP** e **PCESP** para registrar feedback e avaliações sobre o desempenho da tropa.\n\n' +
    '• *Clique no botão abaixo para iniciar a avaliação.*\n' +
    '• *O sistema detecta automaticamente sua corporação.*\n' +
    '• *Selecione o oficial, atribua uma nota e descreva o feedback.*'
  );

  return container
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addActionRowComponents(createAvaliacaoPanelButtons(corporation));
}

function createAvaliacaoPanelPayload(corporation) {
  return {
    components: [createAvaliacaoPanelContainer(corporation)],
    flags: MessageFlags.IsComponentsV2,
  };
}

function createAvaliacaoRankSelectPayload(options) {
  const rankSelect = new StringSelectMenuBuilder()
    .setCustomId('avaliacao_rank_select')
    .setPlaceholder('Selecione a patente/cargo do oficial')
    .addOptions(options);

  return {
    content: '📋 Selecione a patente/cargo do oficial que deseja avaliar:',
    components: [new ActionRowBuilder().addComponents(rankSelect)],
    ephemeral: true,
  };
}

function createAvaliacaoOfficerSelectPayload(roleId, options) {
  const officerSelect = new StringSelectMenuBuilder()
    .setCustomId(`avaliacao_officer_select:${roleId}`)
    .setPlaceholder('Selecione o oficial')
    .addOptions(options);

  return {
    content: '👤 Selecione o oficial correspondente para avaliar:',
    components: [new ActionRowBuilder().addComponents(officerSelect)],
    ephemeral: true,
  };
}

function createAvaliacaoLogPayload(data) {
  const container = new ContainerBuilder()
    .setAccentColor(0xFFD700);

  const headerContent = `${withWhiteIcon('star', '**Avaliação de Oficial Registrada**')}\n\n` +
    `Uma nova avaliação de desempenho foi registrada no sistema da SSP.`;

  addLogoThumbnailToContainer(container, headerContent)
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('user', '**Envolvidos**')}\n` +
        `> **Avaliador:** <@${data.evaluatorId}>\n` +
        `> **Oficial Avaliado:** <@${data.targetId}>\n` +
        `> **Nota:** ${'⭐'.repeat(data.rating)} (${data.rating}/5)`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('clipboard', '**Motivo / Feedback**')}\n> ${data.comment}`
      )
    );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

// ==========================================
// MÓDULO DE SUGESTÕES
// ==========================================
function createSugestoesPanelButtons(corporation) {
  const suffix = corporation ? `:${corporation.slug}` : '';
  return createButtonRow([
    {
      customId: `sugestao_enviar${suffix}`,
      label: 'Enviar Sugestão',
      emoji: '💡',
      style: ButtonStyle.Primary,
    },
  ]);
}

function createSugestoesPanelContainer(corporation) {
  const corpName = corporation ? ` — ${corporation.shortName}` : '';
  const accentColor = corporation ? parseInt(corporation.color.replace('#', ''), 16) : 0x111625;
  return new ContainerBuilder()
    .setAccentColor(accentColor)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${withWhiteIcon('clipboard', `**Central de Sugestões${corpName}**`)}\n\n` +
        '> Deseja propor melhorias para a nossa corporação? Deixe sua sugestão clicando no botão abaixo.\n\n' +
        '• *Todas as sugestões enviadas serão abertas para votação dos demais oficiais.*\n' +
        '• *Seja claro e objetivo na sua proposta.*'
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addActionRowComponents(createSugestoesPanelButtons(corporation));
}

function createSugestoesPanelPayload(corporation) {
  return {
    components: [createSugestoesPanelContainer(corporation)],
    flags: MessageFlags.IsComponentsV2,
  };
}

function createSugestaoCardButtons(suggestionId, upVotesCount = 0, downVotesCount = 0) {
  const total = upVotesCount + downVotesCount;
  let upPct = 0;
  let downPct = 0;
  if (total > 0) {
    upPct = (upVotesCount / total) * 100;
    downPct = (downVotesCount / total) * 100;
  }

  return createButtonRow([
    {
      customId: `sugestao_voto_up:${suggestionId}`,
      label: `Concorda - (${upPct.toFixed(2)}%)`,
      emoji: '👍',
      style: ButtonStyle.Success,
    },
    {
      customId: `sugestao_voto_down:${suggestionId}`,
      label: `Discorda - (${downPct.toFixed(2)}%)`,
      emoji: '👎',
      style: ButtonStyle.Danger,
    },
    {
      customId: `sugestao_voto_total:${suggestionId}`,
      label: `Total de votos: ${total}`,
      emoji: '📊',
      style: ButtonStyle.Secondary,
      disabled: true,
    }
  ]);
}

function createSugestaoCardPayload(suggestion, avatarUrl = null, otherSuggestionsCount = 0, username = 'Oficial') {
  const upVotesCount = suggestion.votesUp ? suggestion.votesUp.length : 0;
  const downVotesCount = suggestion.votesDown ? suggestion.votesDown.length : 0;

  const otherCountText = otherSuggestionsCount > 0 
    ? ` e mais ${otherSuggestionsCount} outras sugestões!` 
    : '!';

  const headerText = `**${username}** que enviou essa${otherCountText}`;
  const bodyText = `“${suggestion.content}”`;
  const footerText = `*Porcentagem atualizada automaticamente.*`;

  const container = new ContainerBuilder()
    .setAccentColor(0x3498db);

  const embedContent = `${bodyText}\n\n${footerText}`;

  if (avatarUrl) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${headerText}\n\n${embedContent}`))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl))
    );
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${headerText}\n\n${embedContent}`)
    );
  }

  container.addActionRowComponents(createSugestaoCardButtons(suggestion._id, upVotesCount, downVotesCount));

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

// ==========================================
// MÓDULO DE BLACKLIST
// ==========================================
function createBlacklistPanelButtons(corporation) {
  const suffix = corporation ? `:${corporation.slug}` : '';
  return createButtonRow([
    {
      customId: `blacklist_consultar_btn${suffix}`,
      label: 'Consultar Blacklist',
      emoji: '🔍',
      style: ButtonStyle.Secondary,
    },
    {
      customId: `blacklist_adicionar_btn${suffix}`,
      label: 'Adicionar Registro',
      emoji: '➕',
      style: ButtonStyle.Danger,
    },
  ]);
}

function createBlacklistPanelContainer(corporation) {
  const corpName = corporation ? ` — ${corporation.shortName}` : '';
  const accentColor = corporation ? parseInt(corporation.color.replace('#', ''), 16) : 0x111625;

  const container = new ContainerBuilder()
    .setAccentColor(accentColor);

  addLogoThumbnailToContainer(
    container,
    `${withWhiteIcon('stop', `**Registro de Blacklist${corpName}**`)}\n\n` +
    '> Central de consulta e registro de cidadãos/oficiais na Blacklist (lista negra) da SSP.\n\n' +
    '• *Qualquer oficial pode fazer consultas.*\n' +
    '• *Apenas oficiais superiores autorizados podem registrar novas ocorrências.*'
  );

  return container
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addActionRowComponents(createBlacklistPanelButtons(corporation));
}

function createBlacklistPanelPayload(corporation) {
  return {
    components: [createBlacklistPanelContainer(corporation)],
    flags: MessageFlags.IsComponentsV2,
  };
}

function createBlacklistEntryPayload(entry) {
  const container = new ContainerBuilder()
    .setAccentColor(0x992d22);

  const logoUrl = require('../config/embeds').design.logo;
  const thumbnailURL = entry.avatarURL || (logoUrl && logoUrl.startsWith('http') ? logoUrl : null);

  const bodyText = `${withWhiteIcon('stop', `**Novo Registro em Blacklist**`)}\n\n` +
    `O seguinte cidadão/oficial foi incluído na lista negra da SSP:\n\n` +
    `> **Nome RP:** ${entry.nomeRp}\n` +
    `> **Citizen ID:** \`${entry.passaporte === entry.discordId ? 'Não informado' : entry.passaporte}\`\n` +
    `> **Discord:** ${entry.discordId ? `<@${entry.discordId}>` : 'Não informado'}\n` +
    `> **Registrado por:** ${entry.addedBy}\n` +
    `> **Data:** <t:${Math.floor(entry.createdAt.getTime() / 1000)}:f>\n\n` +
    `**Motivo:**\n> ${entry.motivo}`;

  if (thumbnailURL) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(bodyText))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnailURL))
    );
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(bodyText)
    );
  };

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

// ==========================================
// MÓDULO DE SOLICITAÇÕES INTERNAS
// ==========================================
function createSolicitacoesPanelButtons(corporation) {
  const suffix = corporation ? `:${corporation.slug}` : '';
  return createButtonRow([
    {
      customId: `solicitacao_interna_btn${suffix}`,
      label: 'Nova Solicitação',
      emoji: '🔄',
      style: ButtonStyle.Primary,
    },
  ]);
}

function createSolicitacoesPanelContainer(corporation) {
  const corpName = corporation ? ` — ${corporation.shortName}` : '';
  const accentColor = corporation ? parseInt(corporation.color.replace('#', ''), 16) : 0x111625;

  const container = new ContainerBuilder()
    .setAccentColor(accentColor);

  addLogoThumbnailToContainer(
    container,
    `${withWhiteIcon('refresh', `**Solicitações Internas${corpName}**`)}\n\n` +
    '> Canal exclusivo para Comandantes de Batalhão enviarem solicitações diretamente ao Alto Comando da corporação.\n\n' +
    '• *Suas solicitações serão enviadas para votação/decisão dos responsáveis.*\n' +
    '• *Acompanhe o andamento no painel de respostas.*'
  );

  return container
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addActionRowComponents(createSolicitacoesPanelButtons(corporation));
}

function createSolicitacoesPanelPayload(corporation) {
  return {
    components: [createSolicitacoesPanelContainer(corporation)],
    flags: MessageFlags.IsComponentsV2,
  };
}

function createSolicitacaoCardButtons(requestId) {
  return createButtonRow([
    {
      customId: `solicitacao_interna_aprovar:${requestId}`,
      label: 'Aprovar',
      emoji: '✅',
      style: ButtonStyle.Success,
    },
    {
      customId: `solicitacao_interna_reprovar:${requestId}`,
      label: 'Recusar',
      emoji: '❌',
      style: ButtonStyle.Danger,
    },
  ]);
}

function createSolicitacaoCardPayload(request, avatarUrl = null) {
  const contentText = [
    `${withWhiteIcon('refresh', `**Solicitação Interna • #${String(request._id).slice(-4).toUpperCase()}**`)}`,
    ``,
    `> **Autor:** <@${request.userId}>`,
    `> **Batalhão:** \`${request.batalhao}\``,
    `> **Assunto:** \`${request.assunto}\``,
    `> **Status:** \`${request.status === 'approved' ? 'Aprovado' : request.status === 'rejected' ? 'Recusado' : 'Aguardando Alto Comando'}\``,
    request.resolvedBy ? `> **Resolvido por:** ${request.resolvedBy}` : null,
    request.resolvedAt ? `> **Resolvido em:** <t:${Math.floor(request.resolvedAt.getTime() / 1000)}:f>` : null,
    ``,
    `**Descrição:**`,
    `> ${request.descricao}`,
  ].filter(line => line !== null).join('\n');

  const container = new ContainerBuilder()
    .setAccentColor(request.status === 'approved' ? 0x27ae60 : request.status === 'rejected' ? 0xc0392b : 0xe67e22);

  const logoUrl = require('../config/embeds').design.logo;
  const finalThumbnail = avatarUrl || (logoUrl && logoUrl.startsWith('http') ? logoUrl : null);

  if (finalThumbnail) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(contentText))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(finalThumbnail))
    );
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(contentText)
    );
  }

  if (request.status === 'pending') {
    container
      .addSeparatorComponents(
        new SeparatorBuilder()
          .setDivider(true)
          .setSpacing(SeparatorSpacingSize.Small)
      )
      .addActionRowComponents(createSolicitacaoCardButtons(request._id));
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

// ==========================================
// MÓDULO DE EXONERAÇÕES
// ==========================================
function createExoneracoesPanelButtons(corporation) {
  const suffix = corporation ? `:${corporation.slug}` : '';
  return createButtonRow([
    {
      customId: `exoneracao_registrar_btn${suffix}`,
      label: 'Registrar Exoneração',
      emoji: '📄',
      style: ButtonStyle.Danger,
    },
  ]);
}

function createExoneracoesPanelContainer(corporation) {
  const corpName = corporation ? ` — ${corporation.shortName}` : '';
  const accentColor = corporation ? parseInt(corporation.color.replace('#', ''), 16) : 0x111625;

  const container = new ContainerBuilder()
    .setAccentColor(accentColor);

  addLogoThumbnailToContainer(
    container,
    `${withWhiteIcon('stop', `**Registro de Exonerações${corpName}**`)}\n\n` +
    '> Painel administrativo exclusivo para registrar exonerações de oficiais da corporação.\n\n' +
    '• *Ao registrar a exoneração, o bot removerá automaticamente todos os cargos policiais do oficial.*\n' +
    '• *O log final de exoneração será enviado para o canal público.*'
  );

  return container
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addActionRowComponents(createExoneracoesPanelButtons(corporation));
}

function createExoneracoesPanelPayload(corporation) {
  return {
    components: [createExoneracoesPanelContainer(corporation)],
    flags: MessageFlags.IsComponentsV2,
  };
}

function createExoneracaoCardPayload(exoneracao, avatarUrl = null) {
  const resolvedByMention = exoneracao.resolvedBy ? `<@${exoneracao.resolvedBy}>` : 'Não informado';
  const dateUnix = exoneracao.createdAt ? Math.floor(exoneracao.createdAt.getTime() / 1000) : Math.floor(Date.now() / 1000);
  const bodyText = [
    `${withWhiteIcon('stop', `**Registro Oficial de Exoneração**`)}`,
    ``,
    `> **Policial Exonerado:** <@${exoneracao.userId}>`,
    `> **Citizen ID:** \`${exoneracao.citizenId || 'Não informado'}\``,
    `> **Responsável:** ${resolvedByMention}`,
    `> **Data:** <t:${dateUnix}:f>`,
    ``,
    `**Motivo / Justificativa:**`,
    `> ${exoneracao.motivo}`,
  ].join('\n');

  const container = new ContainerBuilder()
    .setAccentColor(0xc0392b);

  const logoUrl = require('../config/embeds').design.logo;
  const finalThumbnail = avatarUrl || (logoUrl && logoUrl.startsWith('http') ? logoUrl : null);

  if (finalThumbnail) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(bodyText))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(finalThumbnail))
    );
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(bodyText)
    );
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

// ==========================================
// MÓDULO DE TRANSFERÊNCIAS
// ==========================================
function createTransferenciasPanelButtons(corporation) {
  const suffix = corporation ? `:${corporation.slug}` : '';
  return createButtonRow([
    {
      customId: `transferencia_solicitar${suffix}`,
      label: 'Solicitar Transferência',
      emoji: '🔄',
      style: ButtonStyle.Primary,
    },
  ]);
}

function createTransferenciasPanelContainer(corporation) {
  const corpName = corporation ? ` — ${corporation.shortName}` : '';
  const accentColor = corporation ? parseInt(corporation.color.replace('#', ''), 16) : 0x111625;

  const container = new ContainerBuilder()
    .setAccentColor(accentColor);

  addLogoThumbnailToContainer(
    container,
    `${withWhiteIcon('refresh', `**Solicitação de Transferência${corpName}**`)}\n\n` +
    '> Painel para solicitar transferência de batalhão, divisão ou corporação policial de forma oficial.\n\n' +
    '• *Sua solicitação de transferência será votada/avaliada pelo Comando.*\n' +
    '• *Justifique detalhadamente os motivos do seu pedido.*'
  );

  return container
    .addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small)
    )
    .addActionRowComponents(createTransferenciasPanelButtons(corporation));
}

function createTransferenciasPanelPayload(corporation) {
  return {
    components: [createTransferenciasPanelContainer(corporation)],
    flags: MessageFlags.IsComponentsV2,
  };
}

function createTransferenciaCardButtons(transferenciaId) {
  return createButtonRow([
    {
      customId: `transferencia_aprovar:${transferenciaId}`,
      label: 'Aprovar Transferência',
      emoji: '✅',
      style: ButtonStyle.Success,
    },
    {
      customId: `transferencia_reprovar:${transferenciaId}`,
      label: 'Recusar',
      emoji: '❌',
      style: ButtonStyle.Danger,
    },
  ]);
}

function createTransferenciaCardPayload(transferencia, avatarUrl = null) {
  const statusLabel = transferencia.status === 'approved' ? 'Aprovado' : transferencia.status === 'rejected' ? 'Recusado' : 'Aguardando Comando';
  const bodyText = [
    `${withWhiteIcon('refresh', `**Solicitação de Transferência • #${String(transferencia._id).slice(-4).toUpperCase()}**`)}`,
    ``,
    `> **Policial:** <@${transferencia.userId}>`,
    `> **Destino Desejado:** \`${transferencia.destino}\``,
    `> **Status:** \`${statusLabel}\``,
    transferencia.resolvedBy ? `> **Resolvido por:** ${transferencia.resolvedBy}` : null,
    transferencia.resolvedAt ? `> **Resolvido em:** <t:${Math.floor(transferencia.resolvedAt.getTime() / 1000)}:f>` : null,
    ``,
    `**Motivo / Justificativa:**`,
    `> ${transferencia.motivo}`,
  ].filter(line => line !== null).join('\n');

  const container = new ContainerBuilder()
    .setAccentColor(transferencia.status === 'approved' ? 0x27ae60 : transferencia.status === 'rejected' ? 0xc0392b : 0xe67e22);

  const logoUrl = require('../config/embeds').design.logo;
  const finalThumbnail = avatarUrl || (logoUrl && logoUrl.startsWith('http') ? logoUrl : null);

  if (finalThumbnail) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(bodyText))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(finalThumbnail))
    );
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(bodyText)
    );
  }

  if (transferencia.status === 'pending') {
    container
      .addSeparatorComponents(
        new SeparatorBuilder()
          .setDivider(true)
          .setSpacing(SeparatorSpacingSize.Small)
      )
      .addActionRowComponents(createTransferenciaCardButtons(transferencia._id));
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}
