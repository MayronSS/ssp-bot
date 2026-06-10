const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const resolver = require('../../utils/resolver');
const env = require('../../config/env');
const logger = require('../../utils/logger');
const embedsConfig = require('../../config/embeds');
const { createBaseEmbed } = require('../../utils/createEmbed');
const LspdCandidatura = require('../../database/models/LspdCandidatura');
const componentFactory = require('../../utils/componentFactory');
const emojiHelper = require('../../utils/emojiHelper');
const { EPHEMERAL_REPLY, withEphemeral } = require('../../utils/interactionOptions');
const ticketsService = require('../tickets/tickets.service');

const rascunhosEdital = new Map();

// Perguntas do edital.
const perguntasLSPD = [
  { id: 'p1', label: '1 - Conte um pouco da sua história.', placeholder: 'História do seu personagem na cidade...' },
  { id: 'p2', label: '2 - Por que você deseja ingressar na SSP?', placeholder: 'Explique suas motivações e o que você pode agregar à corporação...' },
  { id: 'p3', label: '3 - Você possui experiência policial anterior?', placeholder: 'Cite outras cidades ou corporações, patentes e funções exercidas...' },
  { id: 'p4', label: '4 - O que é o Uso Progressivo da Força?', placeholder: 'Explique com suas palavras e dê um exemplo de aplicação...' },
  { id: 'p5', label: '5 - Como você reagiria se visse um colega cometendo corrupção?', placeholder: 'Descreva qual seria sua atitude imediata e posterior...' },
  { id: 'p6', label: '6 - Durante uma perseguição, qual é a sua principal prioridade?', placeholder: 'Ex: Preservação à vida, capturar o suspeito, danos materiais...' },
  { id: 'p7', label: '7 - Cite 3 códigos Q ou 10 que você conhece.', placeholder: 'Ex: QAP, QRV, 10-20 (Coloque o significado de cada um)...' },
  { id: 'p8', label: '8 - Como você entende a hierarquia e disciplina?', placeholder: 'Explique a importância da hierarquia e como ela funciona numa corporação policial...' },
  { id: 'p9', label: '9 - Qual a sua disponibilidade de horários?', placeholder: 'Ex: Segunda a Sexta das 19h às 23h, Finais de semana livre...' }
];

async function createPreApprovalTicket(interaction, { candidateId, citizen, nomeRp, recruiter }) {
  const guild = interaction.guild;
  const existingTicket = await ticketsService.hasOpenTicket(candidateId).catch(() => null);
  let channel = existingTicket?.channelId
    ? guild.channels.cache.get(existingTicket.channelId) || await guild.channels.fetch(existingTicket.channelId).catch(() => null)
    : null;
  let ticket = existingTicket || null;
  let staffRole = null;

  if (!channel) {
    const candidateUser = await interaction.client.users.fetch(candidateId).catch(() => null);
    if (!candidateUser) {
      logger.warn(`Não foi possível buscar candidato aprovado ${candidateId} para criar ticket de pré-aprovação.`);
      return { channel: null, ticket: null };
    }

    const created = await ticketsService.createTicketChannel(guild, candidateUser, 'recrutamento', '1508542796146016396');
    channel = created.channel;
    ticket = created.ticket;
    staffRole = created.staffRole;

    const staffMention = staffRole ? `<@&${staffRole.id}>` : '';
    await channel.send(componentFactory.createTicketOpenedPayload({
      userId: candidateId,
      staffMention,
      staffRoleId: staffRole?.id,
      departmentName: ticketsService.nomesDepartamentos.recrutamento,
      departmentKey: 'recrutamento',
    }));
  }

  await channel.send(componentFactory.createEditalPreApprovalTicketPayload({
    candidateId,
    recruiterId: recruiter.id,
    citizen,
    nomeRp,
  }));

  return { channel, ticket };
}

/**
 * Handle: iniciar_edital_lspd (Button)
 * Abre o modal inicial de identificação do candidato.
 */
async function handleStart(interaction, corpSlug) {
  interaction._corpSlug = corpSlug || 'pmesp';
  const modal = new ModalBuilder()
    .setCustomId(`modal_registro_lspd:${interaction._corpSlug}`)
    .setTitle('SSP | Identificação Base');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('c_citizen')
        .setLabel('Citizen ID (Na cidade: /citizen)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('Ex: 1530 (entre na cidade e digite /citizen)')
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('c_nome')
        .setLabel('Nome e Sobrenome (RP)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('Ex: John Doe')
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('c_idade')
        .setLabel('Sua idade da vida real:')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('Ex: 21')
    )
  );

  await interaction.showModal(modal);
}

/**
 * Handle: modal_registro_lspd (ModalSubmit)
 * Registra os dados básicos e inicia a renderização do painel de respostas.
 */
async function handleRegisterModal(interaction) {
  const citizen = interaction.fields.getTextInputValue('c_citizen');
  const nome = interaction.fields.getTextInputValue('c_nome');
  const idade = interaction.fields.getTextInputValue('c_idade');
  const discordId = interaction.user.id;

  const [, corpSlug] = interaction.customId.split(':');
  const finalCorpSlug = corpSlug || 'pmesp';

  const dados = {
    citizen,
    nome,
    idade,
    discordId,
    corporationSlug: finalCorpSlug,
    respostas: {},
  };

  rascunhosEdital.set(interaction.user.id, dados);
  await renderizarPainelRespostas(interaction, true);
}

/**
 * Handle: selecionar_pergunta_lspd (StringSelectMenu)
 * Abre o modal para responder a pergunta selecionada.
 */
async function handleSelectQuestion(interaction) {
  const perguntaId = interaction.values[0];
  const perguntaObj = perguntasLSPD.find((p) => p.id === perguntaId);
  const rascunho = rascunhosEdital.get(interaction.user.id);

  if (!rascunho) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} O seu formulário expirou ou foi reiniciado. Feche esta mensagem e inicie o edital novamente.`,
      ...EPHEMERAL_REPLY,
    });
  }

  const modalResp = new ModalBuilder()
    .setCustomId(`responder_${perguntaId}`)
    .setTitle('SSP | Formulário');

  const input = new TextInputBuilder()
    .setCustomId('txt_resposta')
    .setLabel(perguntaObj.label.substring(0, 45))
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder(perguntaObj.placeholder)
    .setValue(rascunho.respostas[perguntaId] || '')
    .setRequired(true);

  modalResp.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modalResp);
}

/**
 * Handle: responder_<perguntaId> (ModalSubmit)
 * Salva a resposta dada no rascunho e atualiza o painel de progresso.
 */
async function handleSaveAnswer(interaction) {
  const perguntaId = interaction.customId.split('_')[1];
  const respostaTexto = interaction.fields.getTextInputValue('txt_resposta');

  const rascunho = rascunhosEdital.get(interaction.user.id);
  if (rascunho) {
    rascunho.respostas[perguntaId] = respostaTexto;
    await renderizarPainelRespostas(interaction, false);
  } else {
    await interaction.reply({
      content: `${emojiHelper.get('stop')} Rascunho não encontrado. Inicie novamente.`,
      ...EPHEMERAL_REPLY,
    });
  }
}

/**
 * Handle: finalizar_envio_lspd (Button)
 * Envia a ficha finalizada do candidato para o canal de avaliação da staff.
 */
async function handleSend(interaction) {
  const rascunho = rascunhosEdital.get(interaction.user.id);
  if (!rascunho) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} O seu edital já foi enviado ou a sessão expirou.`,
      ...EPHEMERAL_REPLY,
    });
  }

  const corpSlug = rascunho.corporationSlug || 'pmesp';
  const canalChKey = corpSlug === 'pmesp' ? 'editalAvaliacaoPmesp' : 'editalAvaliacaoPcesp';
  const canalChName = corpSlug === 'pmesp' ? '📄・avaliacao-pmesp' : '📄・avaliacao-pcesp';

  const canalAvaliacao = await resolver.resolveChannel(
    interaction.guild,
    canalChKey,
    canalChName,
    { autoCreate: true }
  );

  if (!canalAvaliacao) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} **Erro Crítico:** Canal de avaliação não encontrado. Avise um Administrador.`,
      ...EPHEMERAL_REPLY,
    });
  }

  const nomeFormatado = rascunho.nome.replace(/_/g, ' ').substring(0, 30);

  const respostasArray = [];
  perguntasLSPD.forEach((p) => {
    const resp = rascunho.respostas[p.id] || '⚠️ Deixado em branco';
    respostasArray.push({
      pergunta: p.label,
      resposta: resp
    });
  });

  // Salvar a candidatura no Banco de Dados
  try {
    await LspdCandidatura.create({
      guildId: interaction.guild.id,
      corporationSlug: corpSlug,
      userId: interaction.user.id,
      username: interaction.user.username,
      nomeSobrenome: rascunho.nome,
      idCidade: rascunho.citizen,
      modulo: 'recrutamento',
      tipo: 'Edital',
      respostas: respostasArray,
      status: 'pendente',
      idade: rascunho.idade,
      discordId: rascunho.discordId || interaction.user.id,
    });
  } catch (dbError) {
    logger.error('Erro ao salvar candidatura no banco:', dbError);
  }

  const payload = componentFactory.createEditalEvaluationPayload({
    candidateId: interaction.user.id,
    citizen: rascunho.citizen,
    nomeRp: nomeFormatado,
    idade: rascunho.idade,
    discordId: rascunho.discordId || interaction.user.id,
    respostas: respostasArray,
    candidateAvatarUrl: interaction.user.displayAvatarURL({ extension: 'png', size: 256 }),
  });

  await canalAvaliacao.send(payload);
  rascunhosEdital.delete(interaction.user.id);

  await interaction.update({
    ...componentFactory.createEditalSubmissionPayload(),
    embeds: [],
    files: [],
  });
}

/**
 * Handle: aprovar_edital_ (Button)
 * Aprova o candidato, envia resultado para o canal de resultados e desabilita botões.
 */
async function handleApprove(interaction) {
  await interaction.deferUpdate().catch(() => null);
  const [, , candidatoId, citizen, nomeRp] = interaction.customId.split('_');
  const recrutador = interaction.user;

  // Atualizar status no banco
  let candidatura = null;
  try {
    candidatura = await LspdCandidatura.findOneAndUpdate(
      { userId: candidatoId, status: 'pendente' },
      { status: 'pre_aprovado', aprovadoPor: recrutador.username },
      { returnDocument: 'after' }
    );
  } catch (dbError) {
    logger.error('Erro ao atualizar status de aprovação de edital no banco:', dbError);
  }

  // Se não atualizou, tenta buscar a mais recente
  if (!candidatura) {
    candidatura = await LspdCandidatura.findOne({ userId: candidatoId });
  }

  const corpSlug = candidatura?.corporationSlug || 'pmesp';
  const canalChKey = corpSlug === 'pmesp' ? 'editalResultadosPmesp' : 'editalResultadosPcesp';
  const canalChName = corpSlug === 'pmesp' ? '📄・resultados-pmesp' : '📄・resultados-pcesp';

  const canalResultados = await resolver.resolveChannel(
    interaction.guild,
    canalChKey,
    canalChName,
    { autoCreate: true }
  );

  // Adicionar o cargo de Pré-Aprovado ao candidato
  try {
    const rolePreAprovado = await resolver.resolveRole(
      interaction.guild,
      'preAprovado',
      '📋 ┃ Pré-Aprovado',
      ['Pré-Aprovado', 'Pre-Aprovado']
    );
    const membroCandidato = await interaction.guild.members.fetch(candidatoId).catch(() => null);
    if (membroCandidato && rolePreAprovado) {
      await membroCandidato.roles.add(rolePreAprovado);
    }
  } catch (roleError) {
    logger.error('Erro ao conceder cargo de Pré-Aprovado ao candidato:', roleError);
  }

  const preApproval = await createPreApprovalTicket(interaction, {
    candidateId: candidatoId,
    citizen: citizen || candidatura?.idCidade,
    nomeRp: nomeRp || candidatura?.nomeSobrenome,
    recruiter: recrutador,
  }).catch((error) => {
    logger.error('Erro ao criar ticket de pre-aprovacao do edital:', error);
    return { channel: null, ticket: null };
  });

  if (preApproval.channel?.id && candidatura) {
    candidatura.ticketChannelId = preApproval.channel.id;
    await candidatura.save().catch((dbError) => logger.error('Erro ao salvar ticketChannelId:', dbError));
  }

  const candidateUser = await interaction.client.users.fetch(candidatoId).catch(() => null);
  const candidateAvatarUrl = candidateUser?.displayAvatarURL?.({ extension: 'png', size: 256 }) || null;

  if (canalResultados) {
    await canalResultados.send({
      content: `||<@${candidatoId}>||`,
      allowedMentions: { users: [candidatoId] }
    }).catch(() => null);

    await canalResultados.send(componentFactory.createEditalPreApprovalResultPayload({
      candidateId: candidatoId,
      recruiterId: recrutador.id,
      citizen: citizen || candidatura?.idCidade,
      nomeRp: nomeRp || candidatura?.nomeSobrenome,
      ticketChannelId: preApproval.channel?.id,
      candidateAvatarUrl,
    }));
  }

  const payload = componentFactory.createEditalEvaluationPayload({
    candidateId: candidatoId,
    citizen: citizen || candidatura?.idCidade,
    nomeRp: nomeRp || candidatura?.nomeSobrenome,
    idade: candidatura?.idade || 'N/A',
    discordId: candidatura?.discordId || candidatoId,
    respostas: candidatura?.respostas || [],
    moderatorName: recrutador.username,
    candidateAvatarUrl,
  }, 'approved');

  await interaction.editReply(payload);
}

/**
 * Handle: reprovar_edital_ (Button)
 * Reprova o candidato, envia resultado para o canal de resultados e desabilita botões.
 */
async function handleReject(interaction) {
  await interaction.deferUpdate().catch(() => null);
  const candidatoId = interaction.customId.split('_')[2];
  const recrutador = interaction.user;

  // Atualizar status no banco
  let candidatura = null;
  try {
    candidatura = await LspdCandidatura.findOneAndUpdate(
      { userId: candidatoId, status: 'pendente' },
      { status: 'reprovado', reprovadoPor: recrutador.username, motivoReprovacao: 'Reprovado via Discord' },
      { returnDocument: 'after' }
    );
  } catch (dbError) {
    logger.error('Erro ao atualizar status de reprovação de edital no banco:', dbError);
  }

  // Se não atualizou, tenta buscar a mais recente
  if (!candidatura) {
    candidatura = await LspdCandidatura.findOne({ userId: candidatoId });
  }

  const corpSlug = candidatura?.corporationSlug || 'pmesp';
  const canalChKey = corpSlug === 'pmesp' ? 'editalResultadosPmesp' : 'editalResultadosPcesp';
  const canalChName = corpSlug === 'pmesp' ? '📄・resultados-pmesp' : '📄・resultados-pcesp';

  const canalResultados = await resolver.resolveChannel(
    interaction.guild,
    canalChKey,
    canalChName,
    { autoCreate: true }
  );

  const candidateUser = await interaction.client.users.fetch(candidatoId).catch(() => null);
  const candidateAvatarUrl = candidateUser?.displayAvatarURL?.({ extension: 'png', size: 256 }) || null;

  const rejCfg = embedsConfig.edital.rejected;
  const embedReprovado = createBaseEmbed({
    color: rejCfg.color,
    author: {
      name: rejCfg.author.name,
      iconURL: rejCfg.author.iconURL
    },
    title: rejCfg.title,
    description: rejCfg.description(candidatoId),
    fields: [{ name: `${emojiHelper.get('user')} Oficial Responsável`, value: `${recrutador}`, inline: true }],
    footer: rejCfg.footer,
    thumbnail: candidateAvatarUrl,
    useDefaultAuthor: false
  });

  if (canalResultados) {
    const { AttachmentBuilder } = require('discord.js');
    const badgeAttachment = new AttachmentBuilder(embedsConfig.assets.lspdBadge, { name: 'lspd_badge.png' });

    await canalResultados.send({
      content: `||<@${candidatoId}>||`,
      embeds: [embedReprovado],
      files: [badgeAttachment]
    });
  }

  const payload = componentFactory.createEditalEvaluationPayload({
    candidateId: candidatoId,
    citizen: candidatura?.idCidade || 'N/A',
    nomeRp: candidatura?.nomeSobrenome || 'N/A',
    idade: candidatura?.idade || 'N/A',
    discordId: candidatura?.discordId || candidatoId,
    respostas: candidatura?.respostas || [],
    moderatorName: recrutador.username,
    candidateAvatarUrl,
  }, 'rejected');

  await interaction.editReply(payload);
}

/**
 * Handle: confirmar_dados_ (Button)
 * Atribui cargo de recruta e formata apelido: [<Badge>] - <Nome RP>.
 */
async function handleClaimBadge(interaction) {
  const dados = interaction.customId.split('_');
  const candidatoId = dados[2];
  const citizen = dados[3];
  const nomeRp = dados.slice(4).join(' ');

  if (interaction.user.id !== candidatoId) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} **Acesso Negado:** Apenas o candidato aprovado pode recolher o próprio distintivo!`,
      ...EPHEMERAL_REPLY,
    });
  }

  await interaction.deferReply(EPHEMERAL_REPLY);

  const preApproval = await createPreApprovalTicket(interaction, {
    candidateId: candidatoId,
    citizen,
    nomeRp,
    recruiter: interaction.user,
  }).catch((error) => {
    logger.error('Erro ao criar ticket pelo botão antigo de distintivo:', error);
    return { channel: null, ticket: null };
  });

  if (preApproval.channel?.id) {
    await LspdCandidatura.findOneAndUpdate(
      { userId: candidatoId },
      { status: 'pre_aprovado', ticketChannelId: preApproval.channel.id },
      { returnDocument: 'after' }
    ).catch((dbError) => logger.error('Erro ao vincular ticket pelo botão antigo de distintivo:', dbError));
  }

  await interaction.message.edit({ components: [] }).catch(() => null);

  return interaction.editReply(
    preApproval.channel
      ? `${emojiHelper.get('check')} Você está pré-aprovado. Agende seu comparecimento à DP neste atendimento: ${preApproval.channel}.`
      : `${emojiHelper.get('stop')} Não consegui criar o atendimento de pré-aprovação. Procure um superior.`
  );
}

/**
 * Handle: edital_setar_tags_ (Button)
 * Atribui o cargo de recruta e define o apelido [<Passaporte>] - <Nome RP> ao candidato.
 * Apenas utilizável por administradores / oficiais com permissão de gerenciar tickets.
 */
async function handleSetTags(interaction) {
  const dados = interaction.customId.split('_');
  const candidatoId = dados[3];
  const citizen = dados[4];
  const nomeRp = dados.slice(5).join(' ');

  const { canManageTickets } = require('../../services/permissionService');
  if (!await canManageTickets(interaction.member)) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} **Acesso Negado:** Apenas administradores e oficiais autorizados podem atribuir cargos e apelidos.`,
      ...EPHEMERAL_REPLY,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId(`edital_set_tags_modal:${candidatoId}`)
    .setTitle('SSP — Concluir Admissão');

  const badgeInput = new TextInputBuilder()
    .setCustomId('edital_badge_numero')
    .setLabel('Número do Distintivo / Badge (3 números):')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Ex: 153')
    .setRequired(true);

  const nameInput = new TextInputBuilder()
    .setCustomId('edital_nome_sobrenome')
    .setLabel('Nome e Sobrenome RP:')
    .setStyle(TextInputStyle.Short)
    .setValue(nomeRp)
    .setPlaceholder('Ex: John Doe')
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(badgeInput),
    new ActionRowBuilder().addComponents(nameInput)
  );

  await interaction.showModal(modal);
}

async function handleSetTagsModalSubmit(interaction) {
  await interaction.deferReply(EPHEMERAL_REPLY);

  const candidatoId = interaction.customId.split(':')[1];
  const badge = interaction.fields.getTextInputValue('edital_badge_numero').trim();
  const nomeRp = interaction.fields.getTextInputValue('edital_nome_sobrenome').trim();

  // Validar badge
  const cleanBadge = badge.replace(/\D/g, '');
  if (!/^\d{3}$/.test(cleanBadge)) {
    return interaction.editReply({
      content: `${emojiHelper.get('stop')} **Erro:** Informe apenas 3 números para a badge. Exemplo: \`153\`.`,
    });
  }

  const membro = await interaction.guild.members.fetch(candidatoId).catch(() => null);
  if (!membro) {
    return interaction.editReply({
      content: `${emojiHelper.get('stop')} **Erro:** O candidato não está mais no servidor.`,
    });
  }

  // Resolver o cargo Recruta
  const roleRecruta = await resolver.resolveRole(
    interaction.guild,
    'recrutaCadete',
    '🔰 ┃ Recruta',
    ['Recruta', 'Recruta LSPD', 'Cadete']
  );

  // Resolver o cargo LSPD (Acesso geral)
  const roleLspd = await resolver.resolveRole(
    interaction.guild,
    'lspdGeral',
    '🚔 ┃ LSPD',
    ['LSPD', 'LSPD Geral']
  );

  if (!roleRecruta) {
    return interaction.editReply({
      content: `${emojiHelper.get('stop')} **Erro Crítico:** Cargo Recruta não encontrado e não pôde ser criado.`,
    });
  }

  try {
    // Adicionar cargos
    await membro.roles.add(roleRecruta);
    if (roleLspd) {
      await membro.roles.add(roleLspd).catch(err => logger.error('Erro ao adicionar cargo LSPD:', err));
    }

    // Remover cargo de Pré-Aprovado se ele possuir
    const rolePreAprovado = await resolver.resolveRole(
      interaction.guild,
      'preAprovado',
      '📋 ┃ Pré-Aprovado',
      ['Pré-Aprovado', 'Pre-Aprovado']
    );
    if (rolePreAprovado) {
      await membro.roles.remove(rolePreAprovado).catch(() => null);
    }

    let novoApelido = `[${cleanBadge}] - ${nomeRp}`;
    if (novoApelido.length > 32) novoApelido = novoApelido.substring(0, 32);

    let nicknameChanged = true;
    try {
      await membro.setNickname(novoApelido);
    } catch (nickError) {
      logger.warn(`Não foi possível alterar apelido de ${membro.user.tag}: ${nickError.message}`);
      nicknameChanged = false;
    }

    // Desativar o botão original no ticket
    if (interaction.message) {
      const rawRow = interaction.message.components[0];
      const msgAtualizada = new ActionRowBuilder();
      rawRow.components.forEach((btn, index) => {
        const builder = ButtonBuilder.from(btn);
        if (index === 0) {
          builder
            .setDisabled(true)
            .setLabel(`Cargos/Apelido Atribuídos por ${interaction.user.username}`)
            .setStyle(ButtonStyle.Secondary);
        }
        msgAtualizada.addComponents(builder);
      });
      await interaction.message.edit({ components: [msgAtualizada] }).catch(() => null);
    }

    const nickWarning = nicknameChanged ? '' : '\n⚠️ *Nota: O bot não possui permissão/hierarquia suficiente para alterar o apelido deste usuário.*';
    const addedRolesText = roleLspd ? `<@&${roleRecruta.id}> e <@&${roleLspd.id}>` : `<@&${roleRecruta.id}>`;

    await interaction.editReply({
      content: `${emojiHelper.get('check')} **Cargos e apelido atribuídos com sucesso!**\n\n- Cargos: ${addedRolesText}\n- Novo Apelido: \`${novoApelido}\`${nickWarning}`,
    });

    if (interaction.channel) {
      await interaction.channel.send({
        content: `${emojiHelper.get('check')} **Admissão Concluída:** O oficial <@${interaction.user.id}> atribuiu os cargos de ${addedRolesText} e o apelido \`${novoApelido}\` ao recruta <@${candidatoId}>.${nickWarning}`,
      }).catch(() => null);
    }

  } catch (error) {
    logger.error('Erro ao setar tags do edital LSPD:', error);
    await interaction.editReply({
      content: '⚠️ **Erro ao aplicar alterações:** O bot não possui hierarquia suficiente para alterar o apelido/cargos desse membro.',
    });
  }
}

// =================================================================
// 🎨 FUNÇÃO DE RENDERIZAÇÃO DO PAINEL DE DRAFT (PREMIUM)
// =================================================================
async function renderizarPainelRespostas(interaction, isNew) {
  const rascunho = rascunhosEdital.get(interaction.user.id);

  let respondidas = 0;
  const opcoes = perguntasLSPD.map((p) => {
    const jaRespondeu = !!rascunho.respostas[p.id];
    if (jaRespondeu) respondidas++;
    return {
      label: p.label.substring(0, 100),
      value: p.id,
      emoji: jaRespondeu ? emojiHelper.getRaw('check') : emojiHelper.getRaw('clipboard'),
    };
  });

  const respondidasTotal = respondidas;
  const percent = Math.round((respondidasTotal / perguntasLSPD.length) * 10);
  const progressBar = '█'.repeat(percent) + '░'.repeat(10 - percent);

  const payload = componentFactory.createEditalDraftPayload({
    rascunho,
    perguntas: perguntasLSPD,
    opcoes,
    respondidasTotal,
    totalPerguntas: perguntasLSPD.length,
    progressBar,
  });

  if (isNew) {
    await interaction.reply(withEphemeral(payload));
  } else {
    await interaction.update({ ...payload, embeds: [], files: [] });
  }
}

/**
 * Handle: edital_cancelar (Button)
 * Cancela a candidatura em andamento, limpando rascunhos.
 */
async function handleCancel(interaction) {
  const rascunho = rascunhosEdital.get(interaction.user.id);
  if (!rascunho) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Você não possui nenhuma candidatura ativa em andamento.`,
      ...EPHEMERAL_REPLY,
    });
  }

  rascunhosEdital.delete(interaction.user.id);

  await interaction.update({
    ...componentFactory.createEditalCancelPayload(),
    embeds: [],
    files: [],
  });
}

/**
 * Handle: edital_requisitos (Button)
 * Exibe os requisitos operacionais ephemeramente.
 */
async function handleRequirements(interaction, corpSlug) {
  interaction._corpSlug = corpSlug || 'pmesp';
  await interaction.reply(withEphemeral(componentFactory.createEditalRequirementsPayload()));
}

module.exports = {
  handleStart,
  handleRegisterModal,
  handleSelectQuestion,
  handleSaveAnswer,
  handleSend,
  handleApprove,
  handleReject,
  handleClaimBadge,
  handleCancel,
  handleRequirements,
  handleSetTags,
  handleSetTagsModalSubmit,
};
