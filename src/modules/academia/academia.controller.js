const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} = require('discord.js');
const AcademyCourse = require('../../database/models/AcademyCourse');
const AcademyEnrollment = require('../../database/models/AcademyEnrollment');
const corporationService = require('../../services/corporationService');
const { createErrorEmbed, createSuccessEmbed } = require('../../utils/createEmbed');
const { EPHEMERAL_REPLY } = require('../../utils/interactionOptions');
const logger = require('../../utils/logger');
const emojiHelper = require('../../utils/emojiHelper');
const resolver = require('../../utils/resolver');
const permissionService = require('../../services/permissionService');

// Cache de sessões ativas de academia (ministrador → dados)
const sessionsMap = new Map();

// Cache de aulas abertas (aulaId → dados da aula)
const aulasAbertas = new Map();

/**
 * Garante que o curso existe no banco de dados.
 */
async function ensureCourse(courseName, createdBy) {
  let course = await AcademyCourse.findOne({ title: courseName });
  if (!course) {
    course = await AcademyCourse.create({
      title: courseName,
      description: `Curso de formação: ${courseName}`,
      category: 'basico',
      createdBy: createdBy || 'system',
      isActive: true,
    });
  }
  return course;
}

// ═══════════════════════════════════════
// STEP 1: Ministrador clica "Acessar Academia"
// → Verifica cargo de Ministrador
// → Mostra select de curso
// ═══════════════════════════════════════

async function handleAccessAcademia(interaction, corpSlug) {
  // Verificar cargo de Ministrador
  if (!await permissionService.canAccessAcademia(interaction.member)) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Você não possui o cargo de **Ministrador de Curso** para acessar este painel.`,
      ...EPHEMERAL_REPLY,
    });
  }

  await interaction.deferReply(EPHEMERAL_REPLY);

  try {
    const corporationsConfig = require('../../config/corporations');

    // Detectar corporação do ministrador
    const corpDoc = await corporationService.getByMemberRoles(interaction.member);
    const detectedSlug = corpDoc ? corpDoc.slug : (corpSlug || 'pmesp');
    const corpConfig = corporationsConfig.corporations.find(c => c.slug === detectedSlug);
    const courses = corpConfig?.courses || [];

    if (courses.length === 0) {
      return interaction.editReply({
        embeds: [createErrorEmbed('Sem Cursos', 'Nenhum curso de formação configurado para sua corporação.')],
      });
    }

    // Criar select de cursos
    const options = courses.map((course, i) => ({
      label: course.roleName.split(' ┃ ')[1] || course.name,
      description: `Ministrar aula de ${course.name}`,
      value: `${i}`,
    }));

    const selectRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`academia_select_curso:${detectedSlug}`)
        .setPlaceholder('Selecione o curso que deseja ministrar')
        .addOptions(options)
    );

    return interaction.editReply({
      content: `${emojiHelper.get('graduation')} **Academia ${corpConfig?.shortName || 'SSP'}**\n\n> Selecione o curso que deseja **ministrar**.\n> Corporação detectada: **${corpDoc?.shortName || 'SSP'}**`,
      components: [selectRow],
    });
  } catch (error) {
    logger.error('Erro ao acessar academia:', error);
    return interaction.editReply({
      embeds: [createErrorEmbed('Erro', `Ocorreu um erro: ${error.message}`)],
    });
  }
}

// ═══════════════════════════════════════
// STEP 2: Ministrador seleciona o curso
// → Mostra modal com horário de INÍCIO
// ═══════════════════════════════════════

async function handleSelectCurso(interaction) {
  const [, corpSlug] = interaction.customId.split(':');
  const courseIndex = parseInt(interaction.values[0]);

  // Guardar na sessão
  sessionsMap.set(interaction.user.id, {
    corpSlug,
    courseIndex,
  });

  const modal = new ModalBuilder()
    .setCustomId('modal_academia_horario')
    .setTitle('Definir Horário da Aula');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('academia_horario_inicio')
        .setLabel('Horário de início da aula (HH:MM)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('Ex: 20:00')
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('academia_observacoes')
        .setLabel('Observações (opcional)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setPlaceholder('Local, requisitos, informações adicionais...')
    )
  );

  await interaction.showModal(modal);
}

// ═══════════════════════════════════════
// STEP 3: Ministrador confirma horário
// → Bot envia anúncio no canal de avisos
// → Membros podem se candidatar
// → SEM encerramento automático (ministrador fecha manualmente)
// → SEM aplicação automática de cargo
// ═══════════════════════════════════════

async function handleHorarioModal(interaction) {
  await interaction.deferReply(EPHEMERAL_REPLY);

  const session = sessionsMap.get(interaction.user.id);
  if (!session) {
    return interaction.editReply({
      embeds: [createErrorEmbed('Sessão Expirada', 'Sua sessão expirou. Clique no botão novamente.')],
    });
  }

  const horarioInicio = interaction.fields.getTextInputValue('academia_horario_inicio');
  const observacoes = interaction.fields.getTextInputValue('academia_observacoes') || '';

  // Validar formato HH:MM
  const timeRegex = /^([01]?\d|2[0-3]):([0-5]\d)$/;
  if (!timeRegex.test(horarioInicio)) {
    sessionsMap.delete(interaction.user.id);
    return interaction.editReply({
      embeds: [createErrorEmbed('Formato Inválido', 'O horário deve estar no formato `HH:MM` (ex: 20:00).')],
    });
  }

  try {
    const corporationsConfig = require('../../config/corporations');
    const corpConfig = corporationsConfig.corporations.find(c => c.slug === session.corpSlug);
    const courses = corpConfig?.courses || [];
    const course = courses[session.courseIndex];

    if (!course) {
      sessionsMap.delete(interaction.user.id);
      return interaction.editReply({
        embeds: [createErrorEmbed('Curso Inválido', 'Curso não encontrado.')],
      });
    }

    // Garantir curso no banco
    const courseDoc = await ensureCourse(course.name, interaction.user.id);

    // Calcular timestamp de início
    const now = new Date();
    const [hours, minutes] = horarioInicio.split(':').map(Number);
    const startTime = new Date(now);
    startTime.setHours(hours, minutes, 0, 0);

    // Se o horário já passou, assume que é amanhã
    if (startTime <= now) {
      startTime.setDate(startTime.getDate() + 1);
    }

    const startTimestamp = Math.floor(startTime.getTime() / 1000);
    const corpDoc = await corporationService.getByMemberRoles(interaction.member);
    const corpLabel = corpDoc?.shortName || corpConfig?.shortName || 'SSP';
    const ministradorDisplay = interaction.member.displayName || interaction.user.username;

    // Construir anúncio com Components V2
    const aulaId = `aula_${Date.now()}`;
    const container = new ContainerBuilder()
      .setAccentColor(0x111625)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `${emojiHelper.get('graduation')} **ACADEMIA ${corpLabel} — AULA ABERTA**\n\n` +
          `> **Curso:** ${course.name}\n` +
          `> **Ministrador:** ${interaction.user}\n` +
          `> **Corporação:** ${corpLabel}\n` +
          `> **Início:** <t:${startTimestamp}:t> (<t:${startTimestamp}:R>)\n` +
          (observacoes ? `> **Observações:** ${observacoes}\n` : '') +
          `\n📢 **Clique no botão abaixo para se candidatar a este curso!**`
        )
      )
      .addSeparatorComponents(
        new SeparatorBuilder()
          .setDivider(true)
          .setSpacing(SeparatorSpacingSize.Small)
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`academia_candidatar:${aulaId}`)
            .setLabel('Candidatar-se')
            .setEmoji(emojiHelper.getRaw('graduation'))
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`academia_lista:${aulaId}`)
            .setLabel('Ver Inscritos')
            .setEmoji(emojiHelper.getRaw('clipboard'))
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`academia_encerrar:${aulaId}`)
            .setLabel('Encerrar Aula')
            .setEmoji(emojiHelper.getRaw('stop'))
            .setStyle(ButtonStyle.Secondary)
        )
      );

    // Resolver canal de avisos da academia
    let avisoChannel = null;
    try {
      avisoChannel = await resolver.resolveChannel(
        interaction.guild,
        null,
        'avisos-academia',
        { autoCreate: true }
      );
    } catch (e) {
      avisoChannel = interaction.channel;
    }

    if (!avisoChannel) avisoChannel = interaction.channel;

    const avisoMsg = await avisoChannel.send({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });

    // Salvar aula na memória
    aulasAbertas.set(aulaId, {
      messageId: avisoMsg.id,
      channelId: avisoChannel.id,
      courseDocId: courseDoc._id,
      courseName: course.name,
      courseRoleName: course.roleName,
      corpSlug: session.corpSlug,
      corpLabel,
      ministradorId: interaction.user.id,
      ministradorDisplay,
      startTimestamp,
      candidatos: new Set(),
      observacoes,
      closed: false,
    });

    sessionsMap.delete(interaction.user.id);

    logger.info(`[Academia] Aula "${course.name}" aberta por ${ministradorDisplay} (${corpLabel})`);

    return interaction.editReply({
      embeds: [createSuccessEmbed(
        'Aula Aberta',
        `A aula de **${course.name}** foi anunciada em ${avisoChannel}!\n\n` +
        `> Início: <t:${startTimestamp}:t> (<t:${startTimestamp}:R>)\n` +
        `> Os membros podem se candidatar clicando no botão do anúncio.\n` +
        `> Quando quiser encerrar, clique no botão **Encerrar Aula** no anúncio.`
      )],
    });
  } catch (error) {
    logger.error('Erro ao abrir aula da academia:', error);
    sessionsMap.delete(interaction.user.id);
    return interaction.editReply({
      embeds: [createErrorEmbed('Erro', `Ocorreu um erro: ${error.message}`)],
    });
  }
}

// ═══════════════════════════════════════
// STEP 4: Membro clica "Candidatar-se"
// ═══════════════════════════════════════

async function handleCandidatar(interaction) {
  const [, aulaId] = interaction.customId.split(':');
  const aula = aulasAbertas.get(aulaId);

  if (!aula || aula.closed) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Esta aula já foi encerrada ou não existe mais.`,
      ...EPHEMERAL_REPLY,
    });
  }

  if (aula.candidatos.has(interaction.user.id)) {
    return interaction.reply({
      content: `ℹ️ Você já está inscrito nesta aula de **${aula.courseName}**.`,
      ...EPHEMERAL_REPLY,
    });
  }

  aula.candidatos.add(interaction.user.id);

  // Registrar candidatura no banco
  try {
    const existing = await AcademyEnrollment.findOne({
      userId: interaction.user.id,
      courseId: aula.courseDocId,
      status: 'enrolled',
    });
    if (!existing) {
      await AcademyEnrollment.create({
        userId: interaction.user.id,
        courseId: aula.courseDocId,
        status: 'enrolled',
        progress: 0,
        startedAt: new Date(),
      });
    }
  } catch (err) {
    logger.warn(`[Academia] Erro ao salvar candidatura: ${err.message}`);
  }

  return interaction.reply({
    content: `${emojiHelper.get('check')} Você se candidatou com sucesso para a aula de **${aula.courseName}**!\n\n> Início: <t:${aula.startTimestamp}:t> (<t:${aula.startTimestamp}:R>)\n> Total de inscritos: **${aula.candidatos.size}**`,
    ...EPHEMERAL_REPLY,
  });
}

// ═══════════════════════════════════════
// STEP 5: Ver lista de inscritos
// ═══════════════════════════════════════

async function handleListaInscritos(interaction) {
  const [, aulaId] = interaction.customId.split(':');
  const aula = aulasAbertas.get(aulaId);

  if (!aula) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Aula não encontrada.`,
      ...EPHEMERAL_REPLY,
    });
  }

  if (aula.candidatos.size === 0) {
    return interaction.reply({
      content: `📋 **Inscritos em ${aula.courseName}:** Nenhum candidato até o momento.`,
      ...EPHEMERAL_REPLY,
    });
  }

  const lines = Array.from(aula.candidatos).map((id, i) => `**${i + 1}.** <@${id}>`);

  return interaction.reply({
    content: `📋 **Inscritos em ${aula.courseName}** (${aula.candidatos.size}):\n\n${lines.join('\n')}`,
    ...EPHEMERAL_REPLY,
  });
}

// ═══════════════════════════════════════
// STEP 6: Ministrador clica "Encerrar Aula"
// → Encerra a aula manualmente
// → Registra no banco
// → Atualiza mensagem do anúncio
// → NÃO aplica cargo automaticamente
// ═══════════════════════════════════════

async function handleEncerrarAula(interaction) {
  const [, aulaId] = interaction.customId.split(':');
  const aula = aulasAbertas.get(aulaId);

  if (!aula) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Aula não encontrada.`,
      ...EPHEMERAL_REPLY,
    });
  }

  if (aula.closed) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Esta aula já foi encerrada.`,
      ...EPHEMERAL_REPLY,
    });
  }

  // Somente o ministrador pode encerrar
  if (interaction.user.id !== aula.ministradorId) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} Somente o ministrador (**${aula.ministradorDisplay}**) pode encerrar esta aula.`,
      ...EPHEMERAL_REPLY,
    });
  }

  aula.closed = true;
  logger.info(`[Academia] Aula "${aula.courseName}" encerrada por ${aula.ministradorDisplay} (${aula.candidatos.size} inscritos)`);

  await interaction.deferReply(EPHEMERAL_REPLY);

  try {
    const guild = interaction.guild;
    const channel = guild.channels.cache.get(aula.channelId);

    // Atualizar mensagem de anúncio
    if (channel) {
      try {
        const msg = await channel.messages.fetch(aula.messageId).catch(() => null);
        if (msg) {
          const inscritos = Array.from(aula.candidatos).map(id => `> <@${id}>`).join('\n') || '> Nenhum';

          const resultContainer = new ContainerBuilder()
            .setAccentColor(0x111625)
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent(
                `${emojiHelper.get('check')} **ACADEMIA ${aula.corpLabel} — AULA ENCERRADA**\n\n` +
                `> **Curso:** ${aula.courseName}\n` +
                `> **Ministrador:** <@${aula.ministradorId}>\n` +
                `> **Total de inscritos:** ${aula.candidatos.size}\n` +
                `> **Encerrada em:** <t:${Math.floor(Date.now() / 1000)}:f>\n\n` +
                `**Participantes:**\n${inscritos}`
              )
            );

          await msg.edit({
            components: [resultContainer],
            flags: MessageFlags.IsComponentsV2,
          });
        }
      } catch (editErr) {
        logger.warn(`[Academia] Erro ao editar mensagem de aula: ${editErr.message}`);
      }
    }

    // Limpar da memória
    aulasAbertas.delete(aulaId);
    logger.success(`[Academia] Aula "${aula.courseName}" encerrada com sucesso.`);

    return interaction.editReply({
      embeds: [createSuccessEmbed(
        'Aula Encerrada',
        `A aula de **${aula.courseName}** foi encerrada!\n\n` +
        `> **Inscritos:** ${aula.candidatos.size} membro(s)\n` +
        `> As tags dos cursos devem ser aplicadas manualmente aos aprovados.`
      )],
    });
  } catch (error) {
    logger.error(`[Academia] Erro ao encerrar aula:`, error);
    return interaction.editReply({
      embeds: [createErrorEmbed('Erro', `Ocorreu um erro: ${error.message}`)],
    });
  }
}

// ═══════════════════════════════════════
// STEP EXTRA: "Meus Cursos" — Lista de cursos do membro
// ═══════════════════════════════════════

async function handleMeusCursos(interaction, corpSlug) {
  interaction._corpSlug = corpSlug || 'pmesp';
  await interaction.deferReply(EPHEMERAL_REPLY);

  try {
    const enrollments = await AcademyEnrollment.find({
      userId: interaction.user.id,
    }).populate('courseId');

    if (enrollments.length === 0) {
      return interaction.editReply({
        content: `📋 Você não possui cursos registrados.\n> Fique atento aos anúncios de aulas na academia!`,
      });
    }

    const lines = enrollments.map((e, i) => {
      const courseName = e.courseId?.title || 'Curso desconhecido';
      const statusEmoji = e.status === 'completed' ? '✅' : '📖';
      const statusText = e.status === 'completed' ? 'Concluído' : 'Candidatado';
      return `**${i + 1}.** ${statusEmoji} **${courseName}**\n> Status: ${statusText} | Data: <t:${Math.floor(new Date(e.completedAt || e.createdAt).getTime() / 1000)}:d>`;
    });

    return interaction.editReply({
      content: `📋 **Meus Cursos**\n\n${lines.join('\n\n')}`,
    });
  } catch (error) {
    logger.error('Erro ao listar cursos do usuário:', error);
    return interaction.editReply({
      embeds: [createErrorEmbed('Erro', `Ocorreu um erro: ${error.message}`)],
    });
  }
}

module.exports = {
  handleAccessAcademia,
  handleSelectCurso,
  handleHorarioModal,
  handleCandidatar,
  handleListaInscritos,
  handleEncerrarAula,
  handleMeusCursos,
};
