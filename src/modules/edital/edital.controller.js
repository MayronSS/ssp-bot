const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
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
const corporationService = require('../../services/corporationService');

const rascunhosEdital = new Map();

// Perguntas do edital (sem referências a códigos 10/10-20 na pergunta 7).
const perguntasLSPD = [
  { id: 'p1', label: '1 - Conte um pouco da sua história.', placeholder: 'História do seu personagem na cidade...' },
  { id: 'p2', label: '2 - Por que você deseja ingressar na SSP?', placeholder: 'Explique suas motivações e o que você pode agregar à corporação...' },
  { id: 'p3', label: '3 - Você possui experiência policial anterior?', placeholder: 'Cite outras cidades ou corporações, patentes e funções exercidas...' },
  { id: 'p4', label: '4 - O que é o Uso Progressivo da Força?', placeholder: 'Explique com suas palavras e dê um exemplo de aplicação...' },
  { id: 'p5', label: '5 - Como você reagiria se visse um colega cometendo corrupção?', placeholder: 'Descreva qual seria sua atitude imediata e posterior...' },
  { id: 'p6', label: '6 - Durante uma perseguição, qual é a sua principal prioridade?', placeholder: 'Ex: Preservação à vida, capturar o suspeito, danos materiais...' },
  { id: 'p7', label: '7 - Cite 3 códigos Q que você conhece.', placeholder: 'Ex: QAP, QRV, QTH (Coloque o significado de cada um)...' },
  { id: 'p8', label: '8 - Como você entende a hierarquia e disciplina?', placeholder: 'Explique a importância da hierarquia e como ela funciona numa corporação policial...' },
  { id: 'p9', label: '9 - Qual a sua disponibilidade de horários?', placeholder: 'Ex: Segunda a Sexta das 19h às 23h, Finais de semana livre...' }
];

const perguntasEditalFull = [
  { id: 'citizen', label: 'Citizen ID (Na cidade: /citizen)', placeholder: 'Ex: 1530' },
  { id: 'nome', label: 'Nome e Sobrenome (RP)', placeholder: 'Ex: John Doe' },
  { id: 'idade', label: 'Sua idade da vida real (VR):', placeholder: 'Ex: 21' },
  ...perguntasLSPD
];

// Helper: criar o canal do edital na categoria informada
async function createEditalChannel(guild, user, categoryId, corpSlug) {
  const cleanUsername = user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
  const channelName = `📝・edital-${cleanUsername}`;
  
  // Resolve a categoria
  let category = guild.channels.cache.get(categoryId) || await guild.channels.fetch(categoryId).catch(() => null);
  
  // Resolve o cargo de suporte/staff/comando
  let staffRole = null;
  const corpStaffRoleId = await corporationService.getRole(guild.id, corpSlug, 'staff');
  if (corpStaffRoleId) {
    staffRole = guild.roles.cache.get(corpStaffRoleId) || await guild.roles.fetch(corpStaffRoleId).catch(() => null);
  }
  if (!staffRole) {
    staffRole = await resolver.resolveRole(guild, 'ticketStaff', 'Staff', ['Suporte', 'Comando']);
  }
  
  const permissionOverwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
      ],
    },
  ];
  
  if (staffRole) {
    permissionOverwrites.push({
      id: staffRole.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
      ],
    });
  }
  
  const commandRole = await resolver.resolveRole(guild, 'comandoAdmin', 'Comando', ['Alto Comando', 'Diretoria']);
  if (commandRole) {
    permissionOverwrites.push({
      id: commandRole.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
      ],
    });
  }
  
  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: category ? category.id : null,
    permissionOverwrites,
    topic: `Canal de preenchimento de edital de ${user.username}`,
  });
  
  return channel;
}

// Helper: gera a barra de progresso visual
function gerarProgressBar(atual, total) {
  const preenchido = Math.round((atual / total) * 10);
  const vazio = 10 - preenchido;
  return '▓'.repeat(preenchido) + '░'.repeat(vazio) + ` (${atual}/${total})`;
}

// Helper: obtém a resposta salva para uma pergunta do draft
function getRespostaSalva(draft, questionId) {
  if (questionId === 'citizen') return draft.citizen || null;
  if (questionId === 'nome') return draft.nome || null;
  if (questionId === 'idade') return draft.idade || null;
  return draft.respostas[questionId] || null;
}

// Helper: retorna o nome completo da corporação baseado no slug
function getNomeCorpo(slug) {
  const nomes = {
    'pmesp': 'Polícia Militar do Estado de São Paulo (PMESP)',
    'pcesp': 'Polícia Civil do Estado de São Paulo (PCESP)',
  };
  return nomes[slug] || slug?.toUpperCase() || 'SSP';
}

// Helper: envia mensagem de boas-vindas com termos de aceite
async function enviarBoasVindas(channel, draft) {
  const nomeCorpo = getNomeCorpo(draft.corporationSlug);

  const embed = new EmbedBuilder()
    .setColor('#1B52F1')
    .setTitle('📝  PROCESSO SELETIVO — SSP')
    .setDescription(
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Bem-vindo(a), <@${draft.discordId}>!\n\n` +
      `Você iniciou sua candidatura para:\n` +
      `> 🏛️ **${nomeCorpo}**\n\n` +
      `Este é o seu canal privado de candidatura. Responda às perguntas que aparecerão abaixo **diretamente no chat**.\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📌 **Instruções:**\n` +
      `> • Responda cada pergunta digitando sua resposta normalmente.\n` +
      `> • Use o botão **⬅️ Voltar** para corrigir respostas anteriores.\n` +
      `> • Use o botão **❌ Desistir** para cancelar a candidatura.\n` +
      `> • Ao final, revise tudo antes de enviar.\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `⚠️ **ATENÇÃO — LEIA COM CUIDADO:**\n\n` +
      `> 🚫 **O uso de Inteligência Artificial (ChatGPT, Gemini, etc.) é PROIBIDO.**\n` +
      `> Respostas geradas por IA serão identificadas e a candidatura será **reprovada automaticamente**.\n\n` +
      `> ✍️ **Queremos respostas elaboradas, completas e com suas próprias palavras.**\n` +
      `> Demonstre conhecimento real, dedicação e interesse genuíno na corporação.\n` +
      `> Respostas curtas, vagas ou genéricas serão consideradas insuficientes.\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `**Ao clicar em "Concordo", você declara que leu e aceita os termos acima.**`
    )
    .setFooter({ text: 'SSP Recruitment • Academia de Polícia' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`edital_concordo:${draft.discordId}`)
      .setLabel('Concordo')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`edital_discordo:${draft.discordId}`)
      .setLabel('Discordo')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({ embeds: [embed], components: [row] });
}

// Helper: envia a pergunta atual para o canal
async function enviarPergunta(channel, draft) {
  const pergunta = perguntasEditalFull[draft.stepIndex];
  const total = perguntasEditalFull.length;
  const atual = draft.stepIndex + 1;
  const progressBar = gerarProgressBar(atual, total);

  // Verifica se já existe resposta salva (voltando)
  const respostaSalva = getRespostaSalva(draft, pergunta.id);
  const respostaInfo = respostaSalva
    ? `\n\n📝 **Resposta anterior:** \`${respostaSalva.substring(0, 100)}${respostaSalva.length > 100 ? '...' : ''}\`\n*Digite uma nova resposta para substituir, ou envie a mesma.*`
    : '';

  const embed = new EmbedBuilder()
    .setColor('#1B52F1')
    .setTitle(`📋  Pergunta ${atual} de ${total}`)
    .setDescription(
      `${progressBar}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `**${pergunta.label}**\n\n` +
      `> 💡 *${pergunta.placeholder}*` +
      respostaInfo +
      `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👉 **Digite sua resposta abaixo:**`
    )
    .setFooter({ text: `Edital SSP • Etapa ${atual}/${total}` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`edital_voltar:${draft.discordId}`)
      .setLabel('Voltar')
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(draft.stepIndex === 0),
    new ButtonBuilder()
      .setCustomId(`edital_desistir:${draft.discordId}`)
      .setLabel('Desistir')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
  );
    
  const msg = await channel.send({ embeds: [embed], components: [row] });
  draft.lastQuestionMsgId = msg.id;
}

// Helper: envia tela de confirmação com resumo das respostas
async function enviarConfirmacao(channel, draft) {
  const identEmbed = new EmbedBuilder()
    .setColor('#1B52F1')
    .setTitle('✅  Revisão Final — Edital SSP')
    .setDescription(
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Revise suas informações com atenção antes de enviar.\n\n` +
      `**📋 Dados de Identificação:**\n` +
      `> **Citizen ID:** \`${draft.citizen}\`\n` +
      `> **Nome RP:** \`${draft.nome}\`\n` +
      `> **Idade VR:** \`${draft.idade}\`\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    );

  // Respostas do edital
  let respostasText = '';
  perguntasLSPD.forEach((p) => {
    const resp = draft.respostas[p.id] || '⚠️ *Deixado em branco*';
    respostasText += `**${p.label}**\n> ${resp.substring(0, 500)}\n\n`;
  });

  const respostasEmbed = new EmbedBuilder()
    .setColor('#111625')
    .setTitle('📝  Respostas do Questionário')
    .setDescription(respostasText.substring(0, 4096))
    .setFooter({ text: 'Confira todas as respostas antes de enviar.' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`edital_confirmar:${draft.discordId}`)
      .setLabel('Enviar Edital')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`edital_editar:${draft.discordId}`)
      .setLabel('Editar Respostas')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`edital_desistir:${draft.discordId}`)
      .setLabel('Desistir')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
  );

  const msg = await channel.send({
    content: `<@${draft.discordId}>`,
    embeds: [identEmbed, respostasEmbed],
    components: [row]
  });
  draft.lastQuestionMsgId = msg.id;
}

// Cria canal de pré-aprovação de ticket (usado na aprovação)
async function createPreApprovalTicket(interaction, { candidateId, citizen, nomeRp, recruiter, corpSlug }) {
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

    const created = await ticketsService.createTicketChannel(guild, candidateUser, 'recrutamento', env.CATEGORY_TICKETS || '1510831160660590652', corpSlug || 'pmesp');
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
 * Inicia o edital criando o canal privado.
 */
async function handleStart(interaction, corpSlug) {
  await interaction.deferReply({ ephemeral: true });
  
  const guild = interaction.guild;
  const user = interaction.user;
  const finalCorpSlug = corpSlug || 'pmesp';
  
  const draft = rascunhosEdital.get(user.id);
  if (draft) {
    const ch = guild.channels.cache.get(draft.channelId) || await guild.channels.fetch(draft.channelId).catch(() => null);
    if (ch) {
      return interaction.editReply({
        content: `${emojiHelper.get('stop')} Você já possui uma candidatura em andamento no canal ${ch}.`,
      });
    } else {
      rascunhosEdital.delete(user.id);
    }
  }
  
  try {
    const channel = await createEditalChannel(guild, user, env.CATEGORY_EDITAL || '1523484704295096450', finalCorpSlug);
    
    const newDraft = {
      channelId: channel.id,
      stepIndex: 0,
      respostas: {},
      corporationSlug: finalCorpSlug,
      discordId: user.id,
      username: user.username,
      nome: '',
      citizen: '',
      idade: '',
      lastQuestionMsgId: null,
      aguardandoAceite: true
    };
    rascunhosEdital.set(user.id, newDraft);
    
    await interaction.editReply({
      content: `${emojiHelper.get('check')} Canal de candidatura criado com sucesso! Prossiga para o preenchimento em ${channel}`,
    });

    // Envia tela de termos/aceite
    await enviarBoasVindas(channel, newDraft);
  } catch (error) {
    logger.error('Erro ao criar canal do edital:', error);
    await interaction.editReply({
      content: `${emojiHelper.get('stop')} Ocorreu um erro ao abrir o seu canal de candidatura. Entre em contato com a administração.`,
    });
  }
}

/**
 * Intercepta mensagens enviadas no canal privado de edital.
 */
async function handleEditalMessage(message) {
  const authorId = message.author.id;
  const draft = rascunhosEdital.get(authorId);
  if (!draft || draft.channelId !== message.channel.id) return false;

  // Se ainda aguardando aceite dos termos, deletar mensagem
  if (draft.aguardandoAceite) {
    await message.delete().catch(() => null);
    return true;
  }

  // Se já respondeu todas, ignorar mensagens (aguardando confirmação)
  if (draft.stepIndex >= perguntasEditalFull.length) {
    await message.delete().catch(() => null);
    return true;
  }

  const currentQuestion = perguntasEditalFull[draft.stepIndex];
  if (!currentQuestion) return false;

  const answerText = message.content.trim();
  if (!answerText) return true; // Ignora mensagens vazias

  // Armazena a resposta
  if (currentQuestion.id === 'citizen') {
    draft.citizen = answerText;
  } else if (currentQuestion.id === 'nome') {
    draft.nome = answerText;
  } else if (currentQuestion.id === 'idade') {
    draft.idade = answerText;
  } else {
    draft.respostas[currentQuestion.id] = answerText;
  }

  // Deleta a mensagem do usuário (sua resposta)
  await message.delete().catch(() => null);

  // Deleta a pergunta anterior do bot
  if (draft.lastQuestionMsgId) {
    const prevMsg = await message.channel.messages.fetch(draft.lastQuestionMsgId).catch(() => null);
    if (prevMsg) await prevMsg.delete().catch(() => null);
  }

  draft.stepIndex++;

  if (draft.stepIndex < perguntasEditalFull.length) {
    await enviarPergunta(message.channel, draft);
  } else {
    // Fim das perguntas: envia tela de confirmação
    await enviarConfirmacao(message.channel, draft);
  }

  return true;
}

/**
 * Volta para a pergunta anterior no edital.
 */
async function handleVoltarEdital(interaction) {
  const candidatoId = interaction.customId.split(':')[1];
  if (interaction.user.id !== candidatoId) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Apenas o candidato pode navegar pelas perguntas!`,
      ephemeral: true
    });
  }

  const draft = rascunhosEdital.get(candidatoId);
  if (!draft) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Candidatura não encontrada.`,
      ephemeral: true
    });
  }

  if (draft.stepIndex <= 0) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Você já está na primeira pergunta!`,
      ephemeral: true
    });
  }

  await interaction.deferUpdate();

  // Deleta a mensagem atual (pergunta ou confirmação)
  if (draft.lastQuestionMsgId) {
    const prevMsg = await interaction.channel.messages.fetch(draft.lastQuestionMsgId).catch(() => null);
    if (prevMsg) await prevMsg.delete().catch(() => null);
  }

  draft.stepIndex--;
  await enviarPergunta(interaction.channel, draft);
}

/**
 * Volta para editar respostas a partir da tela de confirmação.
 */
async function handleEditarEdital(interaction) {
  const candidatoId = interaction.customId.split(':')[1];
  if (interaction.user.id !== candidatoId) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Apenas o candidato pode editar as respostas!`,
      ephemeral: true
    });
  }

  const draft = rascunhosEdital.get(candidatoId);
  if (!draft) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Candidatura não encontrada.`,
      ephemeral: true
    });
  }

  await interaction.deferUpdate();

  // Deleta a mensagem de confirmação
  if (draft.lastQuestionMsgId) {
    const prevMsg = await interaction.channel.messages.fetch(draft.lastQuestionMsgId).catch(() => null);
    if (prevMsg) await prevMsg.delete().catch(() => null);
  }

  // Volta para a última pergunta
  draft.stepIndex = perguntasEditalFull.length - 1;
  await enviarPergunta(interaction.channel, draft);
}

/**
 * Candidato concordou com os termos — inicia as perguntas.
 */
async function handleConcordarEdital(interaction) {
  const candidatoId = interaction.customId.split(':')[1];
  if (interaction.user.id !== candidatoId) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Apenas o candidato pode aceitar os termos!`,
      ephemeral: true
    });
  }

  const draft = rascunhosEdital.get(candidatoId);
  if (!draft) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Candidatura não encontrada.`,
      ephemeral: true
    });
  }

  await interaction.deferUpdate();

  // Apaga a mensagem de termos
  await interaction.message.delete().catch(() => null);

  // Libera o fluxo de perguntas
  draft.aguardandoAceite = false;
  draft.stepIndex = 0;
  await enviarPergunta(interaction.channel, draft);
}

/**
 * Candidato discordou dos termos — cancela e exclui o canal.
 */
async function handleDiscordarEdital(interaction) {
  const candidatoId = interaction.customId.split(':')[1];
  if (interaction.user.id !== candidatoId) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Apenas o candidato pode recusar os termos!`,
      ephemeral: true
    });
  }

  rascunhosEdital.delete(candidatoId);

  const embed = new EmbedBuilder()
    .setColor('#D50000')
    .setTitle('❌  Candidatura Cancelada')
    .setDescription('Você não concordou com os termos. Este canal será excluído em 5 segundos.')
    .setFooter({ text: 'SSP Recruitment • Academia de Polícia' });

  await interaction.update({ embeds: [embed], components: [] }).catch(async () => {
    await interaction.reply({ embeds: [embed] }).catch(() => null);
  });

  setTimeout(async () => {
    await interaction.channel.delete().catch(() => null);
  }, 5000);
}

/**
 * Desiste da candidatura e exclui o canal.
 */
async function handleDesistirEdital(interaction) {
  const candidatoId = interaction.customId.split(':')[1];
  if (interaction.user.id !== candidatoId) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Apenas o candidato pode cancelar a candidatura!`,
      ephemeral: true
    });
  }

  rascunhosEdital.delete(candidatoId);

  const embed = new EmbedBuilder()
    .setColor('#D50000')
    .setTitle('❌  Candidatura Cancelada')
    .setDescription('Sua candidatura foi cancelada. Este canal será excluído em 5 segundos.')
    .setFooter({ text: 'SSP Recruitment • Academia de Polícia' });

  await interaction.update({ embeds: [embed], components: [] }).catch(async () => {
    await interaction.reply({ embeds: [embed] }).catch(() => null);
  });

  setTimeout(async () => {
    await interaction.channel.delete().catch(() => null);
  }, 5000);
}

/**
 * Envia a ficha finalizada do candidato para o canal de avaliação da staff.
 */
async function handleConfirmarCanal(interaction) {
  const candidatoId = interaction.customId.split(':')[1];
  if (interaction.user.id !== candidatoId) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Apenas o candidato pode confirmar o envio do edital!`,
      ephemeral: true
    });
  }

  const rascunho = rascunhosEdital.get(candidatoId);
  if (!rascunho) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Candidatura expirou ou não encontrada.`,
      ephemeral: true
    });
  }

  await interaction.deferUpdate();

  // Enviar para o canal de avaliação
  const corpSlug = rascunho.corporationSlug || 'pmesp';
  const canalChKey = corpSlug === 'pmesp' ? 'editalAvaliacaoPmesp' : 'editalAvaliacaoPcesp';
  const canalChName = corpSlug === 'pmesp' ? '📄・avaliacao-pmesp' : '📄・avaliacao-pcesp';

  const canalAvaliacaoId = await corporationService.getChannel(interaction.guild.id, corpSlug, canalChKey)
    || await corporationService.getChannel(interaction.guild.id, corpSlug, 'editalAvaliacao')
    || await require('../../services/configService').getChannel(interaction.guild.id, canalChKey);

  let canalAvaliacao = canalAvaliacaoId ? interaction.guild.channels.cache.get(canalAvaliacaoId) : null;
  if (!canalAvaliacao) {
    canalAvaliacao = await resolver.resolveChannel(
      interaction.guild,
      canalChKey,
      canalChName,
      { autoCreate: true }
    );
  }

  if (!canalAvaliacao) {
    return interaction.followUp({
      content: `${emojiHelper.get('stop')} **Erro Crítico:** Canal de avaliação não encontrado. Avise um Administrador.`,
      ephemeral: true
    });
  }

  const nomeFormatado = rascunho.nome.replace(/_/g, ' ').substring(0, 80);

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
      userId: candidatoId,
      username: rascunho.username,
      nomeSobrenome: rascunho.nome,
      idCidade: rascunho.citizen,
      modulo: 'recrutamento',
      tipo: 'Edital',
      respostas: respostasArray,
      status: 'pendente',
      idade: rascunho.idade,
      discordId: rascunho.discordId || candidatoId,
    });
  } catch (dbError) {
    logger.error('Erro ao salvar candidatura no banco:', dbError);
  }

  const payload = componentFactory.createEditalEvaluationPayload({
    candidateId: candidatoId,
    citizen: rascunho.citizen,
    nomeRp: nomeFormatado,
    idade: rascunho.idade,
    discordId: rascunho.discordId || candidatoId,
    respostas: respostasArray,
    candidateAvatarUrl: interaction.user.displayAvatarURL({ extension: 'png', size: 256 }),
  });

  await canalAvaliacao.send(payload);
  rascunhosEdital.delete(candidatoId);

  // Edita a mensagem no canal avisando que foi enviado
  const doneEmbed = new EmbedBuilder()
    .setColor('#4caf50')
    .setTitle('✅ | Edital Enviado!')
    .setDescription(`O seu edital foi submetido com sucesso para a avaliação da Staff. Este canal será excluído em 10 segundos.`);

  await interaction.editReply({ embeds: [doneEmbed], components: [] });

  // Deleta o canal após 10 segundos
  setTimeout(async () => {
    await interaction.channel.delete().catch(() => null);
  }, 10000);
}

/**
 * Cancela a candidatura e exclui o canal.
 */
async function handleCancelarCanal(interaction) {
  const candidatoId = interaction.customId.split(':')[1];
  if (interaction.user.id !== candidatoId) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Apenas o candidato pode cancelar a candidatura!`,
      ephemeral: true
    });
  }

  rascunhosEdital.delete(candidatoId);

  await interaction.reply({ content: 'Edital cancelado. Excluindo canal...' });
  setTimeout(async () => {
    await interaction.channel.delete().catch(() => null);
  }, 3000);
}

/**
 * Aprova o candidato.
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

  if (!candidatura) {
    candidatura = await LspdCandidatura.findOne({ userId: candidatoId });
  }

  const corpSlug = candidatura?.corporationSlug || 'pmesp';
  const canalChKey = corpSlug === 'pmesp' ? 'editalResultadosPmesp' : 'editalResultadosPcesp';
  const canalChName = corpSlug === 'pmesp' ? '📄・resultados-pmesp' : '📄・resultados-pcesp';

  const canalResultadosId = await corporationService.getChannel(interaction.guild.id, corpSlug, canalChKey)
    || await corporationService.getChannel(interaction.guild.id, corpSlug, 'editalResultados')
    || await require('../../services/configService').getChannel(interaction.guild.id, canalChKey);

  let canalResultados = canalResultadosId ? interaction.guild.channels.cache.get(canalResultadosId) : null;
  if (!canalResultados) {
    canalResultados = await resolver.resolveChannel(
      interaction.guild,
      canalChKey,
      canalChName,
      { autoCreate: true }
    );
  }

  // Adicionar o cargo de Pré-Aprovado ao candidato
  try {
    let preAprovadoRoleId = await corporationService.getRole(interaction.guild.id, corpSlug, 'preAprovado');
    if (!preAprovadoRoleId) {
      preAprovadoRoleId = corpSlug === 'pcesp'
        ? (process.env.ROLE_PRE_APROVADO_PCESP || '1510829667043639376')
        : (process.env.ROLE_PRE_APROVADO_PMESP || '1510829636433481734');
    }
    let rolePreAprovado = null;
    if (preAprovadoRoleId) {
      rolePreAprovado = interaction.guild.roles.cache.get(preAprovadoRoleId) || await interaction.guild.roles.fetch(preAprovadoRoleId).catch(() => null);
    }
    if (!rolePreAprovado) {
      rolePreAprovado = await resolver.resolveRole(
        interaction.guild,
        'preAprovado',
        '📋 ┃ Pré-Aprovado',
        ['Pré-Aprovado', 'Pre-Aprovado']
      );
    }

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
    corpSlug,
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
 * Reprova o candidato.
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

  if (!candidatura) {
    candidatura = await LspdCandidatura.findOne({ userId: candidatoId });
  }

  const corpSlug = candidatura?.corporationSlug || 'pmesp';
  const canalChKey = corpSlug === 'pmesp' ? 'editalResultadosPmesp' : 'editalResultadosPcesp';
  const canalChName = corpSlug === 'pmesp' ? '📄・resultados-pmesp' : '📄・resultados-pcesp';

  const canalResultadosId = await corporationService.getChannel(interaction.guild.id, corpSlug, canalChKey)
    || await corporationService.getChannel(interaction.guild.id, corpSlug, 'editalResultados')
    || await require('../../services/configService').getChannel(interaction.guild.id, canalChKey);

  let canalResultados = canalResultadosId ? interaction.guild.channels.cache.get(canalResultadosId) : null;
  if (!canalResultados) {
    canalResultados = await resolver.resolveChannel(
      interaction.guild,
      canalChKey,
      canalChName,
      { autoCreate: true }
    );
  }

  const candidateUser = await interaction.client.users.fetch(candidatoId).catch(() => null);
  const candidateAvatarUrl = candidateUser?.displayAvatarURL?.({ extension: 'png', size: 256 }) || null;

  if (canalResultados) {
    await canalResultados.send({
      content: `||<@${candidatoId}>||`,
      allowedMentions: { users: [candidatoId] }
    }).catch(() => null);

    await canalResultados.send(componentFactory.createEditalRejectionResultPayload({
      candidateId: candidatoId,
      recruiterId: recrutador.id,
      citizen: candidatura?.idCidade || 'N/A',
      nomeRp: candidatura?.nomeSobrenome || 'N/A',
      candidateAvatarUrl,
    }));
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
 * Atribui cargo de recruta e formata apelido.
 */
async function handleClaimBadge(interaction) {
  const dados = interaction.customId.split('_');
  const candidatoId = dados[2];
  const citizen = dados[3];
  const nomeRp = dados.slice(4).join(' ');

  if (interaction.user.id !== candidatoId) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} **Acesso Negado:** Apenas o candidato aprovado pode recolher o próprio distintivo!`,
      ephemeral: true,
    });
  }

  await interaction.deferReply(EPHEMERAL_REPLY);

  const candidatura = await LspdCandidatura.findOne({ userId: candidatoId });
  const corpSlug = candidatura?.corporationSlug || 'pmesp';

  const preApproval = await createPreApprovalTicket(interaction, {
    candidateId: candidatoId,
    citizen,
    nomeRp,
    recruiter: interaction.user,
    corpSlug,
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
 * Exibe os requisitos operacionais ephemeramente.
 */
async function handleRequirements(interaction, corpSlug) {
  interaction._corpSlug = corpSlug || 'pmesp';
  await interaction.reply(withEphemeral(componentFactory.createEditalRequirementsPayload()));
}

/**
 * Atribui o cargo de recruta e define o apelido [<Passaporte>] - <Nome RP> ao candidato.
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
      ephemeral: true,
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

  const candidatura = await LspdCandidatura.findOne({ userId: candidatoId }).sort({ createdAt: -1 });
  const corpSlug = candidatura?.corporationSlug || 'pmesp';

  // Cargos específicos solicitados por corporação
  const pmespAddRoleIds = ['1510829612274548766', '1510829632855740456'];
  const pcespAddRoleIds = ['1510829667043639376', '1510829663126028288'];

  // Buscar cargos da corporação no MongoDB / Config
  const recrutaRoleId = await corporationService.getRole(interaction.guild.id, corpSlug, 'recruta');
  const geralRoleId = await corporationService.getRole(interaction.guild.id, corpSlug, 'geral');

  const defaultAddIds = corpSlug === 'pcesp' ? pcespAddRoleIds : pmespAddRoleIds;
  const targetAddIds = [...new Set([...defaultAddIds, recrutaRoleId, geralRoleId].filter(Boolean))];

  // Buscar instâncias de cargos para adicionar
  const rolesToAdd = [];
  for (const rId of targetAddIds) {
    const roleObj = interaction.guild.roles.cache.get(rId) || await interaction.guild.roles.fetch(rId).catch(() => null);
    if (roleObj) rolesToAdd.push(roleObj);
  }

  if (rolesToAdd.length === 0) {
    // Fallback: tenta resolver cargo Recruta
    const fallbackRecruta = await resolver.resolveRole(
      interaction.guild,
      'recrutaCadete',
      '🔰 ┃ Recruta',
      ['Recruta', 'Recruta LSPD', 'Cadete']
    );
    if (fallbackRecruta) rolesToAdd.push(fallbackRecruta);
  }

  if (rolesToAdd.length === 0) {
    return interaction.editReply({
      content: `${emojiHelper.get('stop')} **Erro Crítico:** Nenhum cargo válido encontrado para atribuição.`,
    });
  }

  // Cargos a remover: Pré-Aprovado e Cidadão (1348015731933057055)
  const preAprovadoRoleId = await corporationService.getRole(interaction.guild.id, corpSlug, 'preAprovado')
    || (corpSlug === 'pcesp' ? (process.env.ROLE_PRE_APROVADO_PCESP || '1510829667043639376') : (process.env.ROLE_PRE_APROVADO_PMESP || '1510829636433481734'));
  const cidadaoRoleId = process.env.ROLE_CIDADAO || '1348015731933057055';

  const targetRemoveIds = [...new Set([preAprovadoRoleId, cidadaoRoleId].filter(id => id && !targetAddIds.includes(id)))];

  try {
    // Adicionar cargos
    for (const roleObj of rolesToAdd) {
      await membro.roles.add(roleObj).catch(err => logger.error(`Erro ao adicionar cargo ${roleObj.id}:`, err));
    }

    // Remover cargos especificados (pré-aprovado e cidadão)
    for (const rId of targetRemoveIds) {
      const roleObj = interaction.guild.roles.cache.get(rId) || await interaction.guild.roles.fetch(rId).catch(() => null);
      if (roleObj && membro.roles.cache.has(roleObj.id)) {
        await membro.roles.remove(roleObj).catch(err => logger.warn(`Não foi possível remover cargo ${rId}: ${err.message}`));
      }
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
    const addedRolesText = rolesToAdd.map(r => `<@&${r.id}>`).join(' e ');

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

module.exports = {
  handleStart,
  handleEditalMessage,
  handleConfirmarCanal,
  handleVoltarEdital,
  handleEditarEdital,
  handleDesistirEdital,
  handleConcordarEdital,
  handleDiscordarEdital,
  handleApprove,
  handleReject,
  handleClaimBadge,
  handleRequirements,
  handleSetTags,
  handleSetTagsModalSubmit,
};
